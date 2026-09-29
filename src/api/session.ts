/**
 * NEU (Schritt 7, Auth-Flow): löst die Supabase-Auth-Sitzung (JWT aus dem
 * E-Mail+Passwort-Login) gegen den zugehörigen Tenant + API-Key auf — siehe
 * GET /api/v1/tenant/session in orbit-api.ts. Bewusst eine eigene,
 * schlanke Fetch-Funktion statt der requestJson()-Helfer aus core.ts/
 * orbit.ts: diese hier authentifiziert per "Authorization: Bearer <JWT>",
 * nicht per "X-API-Key" — es gibt an dieser Stelle ja noch keinen API-Key,
 * den wollen wir gerade erst herausfinden.
 */

import { ApiClientError } from "./core";

export interface TenantSessionResponse {
  tenant_id: string;
  tenant_name: string;
  api_key: string;
  /** null = Legacy-Tenant ohne Self-Service-Plan (siehe tenants-Tabelle) — nie gesperrt. */
  plan: string | null;
  status: string | null;
  trial_ends_at: string | null;
  course_limit: number | null;
}

function safeJsonParse(text: string): { detail?: unknown; code?: unknown } | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Ruft GET /api/v1/tenant/session auf. accessToken = supabase.auth.getSession()-Ergebnis. */
export async function fetchTenantSession(
  apiBase: string,
  accessToken: string
): Promise<TenantSessionResponse> {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/v1/tenant/session`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const parsed = body ? safeJsonParse(body) : null;
    const detail = parsed && typeof parsed.detail === "string" ? parsed.detail : body;
    const code = parsed && typeof parsed.code === "string" ? parsed.code : undefined;
    throw new ApiClientError(
      res.status,
      detail || `Sitzung konnte nicht aufgelöst werden: HTTP ${res.status}`,
      code
    );
  }

  return res.json() as Promise<TenantSessionResponse>;
}