/**
 * NEU (30.09.2026, Admin-Modus): schlanke Fetch-Helfer fuer die drei neuen,
 * per Supabase-Auth-JWT (nicht X-API-Key) authentifizierten Backend-Routen
 * unter /api/v1/admin/* — siehe requireAdminUser() im Backend. Bewusst nach
 * demselben Muster wie session.ts (eigene ApiRequestError-Klasse statt
 * core.ts' requestJson()-Helfer, weil auch hier per Bearer-JWT statt
 * X-API-Key authentifiziert wird).
 *
 * Ein "Admin" ist EIN Account (deiner), der in der Backend-Tabelle
 * "admin_users" eingetragen ist (siehe Migrations-SQL) — dieser Account
 * gehört KEINEM Tenant, kann sich stattdessen aber jedes bestehende
 * Tenant-Dashboard "leihen" (Impersonation), z.B. um vorab Kurse
 * einzupflegen oder Support zu leisten, ohne das Passwort des Kunden zu
 * kennen.
 */
import { ApiRequestError } from "./apiError";
import type { TenantSessionResponse } from "./session";

function safeJsonParse(text: string): { detail?: unknown; code?: unknown } | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function parseErrorAndThrow(res: Response, fallback: string): Promise<never> {
  const body = await res.text().catch(() => "");
  const parsed = body ? safeJsonParse(body) : null;
  const detail = parsed && typeof parsed.detail === "string" ? parsed.detail : body;
  const code = parsed && typeof parsed.code === "string" ? parsed.code : undefined;
  throw new ApiRequestError(res.status, detail || fallback, code);
}

export interface AdminSessionResponse {
  is_admin: true;
  email: string;
}

/** Prüft, ob der eingeloggte Supabase-Auth-Nutzer ein Admin-Konto ist. Wirft
 *  (ApiRequestError, meist status 403) wenn NICHT — das ist der normale Fall
 *  für jeden echten Bildungsträger-Kunden, siehe App.tsx/resolveSession(),
 *  wo dieser Fehler bewusst abgefangen und einfach als "kein Admin, normal
 *  als Tenant weiter" behandelt wird. */
export async function fetchAdminSession(
  apiBase: string,
  accessToken: string
): Promise<AdminSessionResponse> {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/v1/admin/session`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return parseErrorAndThrow(res, `Admin-Prüfung fehlgeschlagen: HTTP ${res.status}`);
  return res.json() as Promise<AdminSessionResponse>;
}

export interface AdminTenantSummary {
  tenant_id: string;
  tenant_name: string;
  plan: string | null;
  status: string | null;
  trial_ends_at: string | null;
  course_limit: number | null;
}

/** Listet ALLE Tenants für die Tenant-Auswahl im Admin-Modus — nur mit
 *  Admin-Rechten aufrufbar (siehe handleAdminTenantsList() im Backend). */
export async function fetchAdminTenants(
  apiBase: string,
  accessToken: string
): Promise<AdminTenantSummary[]> {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/v1/admin/tenants`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return parseErrorAndThrow(res, `Tenants konnten nicht geladen werden: HTTP ${res.status}`);
  return res.json() as Promise<AdminTenantSummary[]>;
}

/** Löst per Tenant-ID dessen Operator-/Journey-Key auf (exakt dieselbe
 *  Antwortform wie fetchTenantSession() in session.ts) — macht den Admin im
 *  Frontend danach ununterscheidbar von einem echten, eingeloggten Tenant
 *  (siehe App.tsx: derselbe "loggedIn"-Zustand, dieselbe DashboardPage).
 *  Jeder Aufruf wird serverseitig in admin_access_log protokolliert. */
export async function impersonateTenant(
  apiBase: string,
  accessToken: string,
  tenantId: string
): Promise<TenantSessionResponse> {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/v1/admin/impersonate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tenant_id: tenantId }),
  });
  if (!res.ok) return parseErrorAndThrow(res, `Tenant konnte nicht geöffnet werden: HTTP ${res.status}`);
  return res.json() as Promise<TenantSessionResponse>;
}