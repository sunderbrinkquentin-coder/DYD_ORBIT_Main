/**
 * "7-Tage-Trial": ruft den OEFFENTLICHEN, unauthentifizierten Endpunkt
 * POST /api/v1/signup der ORBIT-API auf (siehe handleSignup() in der
 * Supabase Edge Function "api"). Legt sofort an: (1) einen echten
 * Supabase-Auth-Nutzer (E-Mail+Passwort, sofort aktiv, kein Bestaetigungs-
 * link/E-Mail-Versand - siehe Begruendung "email_confirm: true" in
 * handleSignup), (2) einen Tenant im Status "trial" (7 Tage, TRIAL_DAYS in
 * der Function, Plan fest "demo" mit DEMO_COURSE_LIMIT=10 Kursen), (3) den
 * zugehoerigen API-Key fuer diesen Tenant (in api_keys, Produkt "orbit").
 *
 * AUFLOESUNG des vorherigen 401-Fehlers ("Fehlender Header 'X-API-Key'"):
 * die vorherige Version dieser Datei hat einen FALSCHEN, geratenen Pfad
 * (/api/v1/billing/trial-signup) aufgerufen, den es im Router der Edge
 * Function gar nicht gibt - jede unbekannte Route faellt dort automatisch
 * auf den authentifizierten Katalog-Zweig zurueck, der zuerst IMMER einen
 * X-API-Key prueft (getTenant()), daher der Fehler. Der WIRKLICHE Endpunkt
 * heisst /api/v1/signup und ist bewusst OHNE jede Authentifizierung
 * erreichbar (Router-Sonderfall "NEU (Schritt 3, Signup)", noch vor
 * getTenant() registriert) - beim Signup selbst gibt es ja noch keinen
 * API-Key. Das loest auch die Sicherheitsfrage von vorhin: es muss
 * UEBERHAUPT KEIN Key mehr im Frontend/JS-Bundle liegen, weder oeffentlich
 * noch geheim.
 *
 * Das Backend liest aus dem Request-Body nur email/password/company_name -
 * "plan" (Starter/Growth/Professional) wird aktuell NICHT ausgewertet,
 * jeder Trial startet identisch als Plan "demo". Wir schicken "plan"
 * trotzdem mit (schadet nicht, evtl. spaeter nuetzlich), zeigen den auf der
 * Preiskarte gewaehlten Plan aber nur lokal in der UI an (siehe
 * TrialSignupForm.tsx) - nicht als Zusage, dass der Trial diesen Plan
 * tatsaechlich hat.
 */

import type { BillingPlan } from "./orbitDirectCheckout";

export interface TrialSignupInput {
  email: string;
  password: string;
  companyName: string;
  plan: BillingPlan;
  /** Optional - keine Pflichtangabe, hilft aber beim Nachfassen vor
   *  Trial-Ende. Wird aktuell vom Backend nicht ausgewertet/gespeichert. */
  phone?: string;
}

export interface TrialSignupResult {
  tenant_id: string;
  tenant_name: string;
  /** ORBIT-API-Key dieses neuen Tenants. Wird bewusst NICHT im Formular
   *  angezeigt - der Login im ORBIT-Dashboard laeuft ueber E-Mail+Passwort
   *  (Supabase-Auth), nicht ueber diesen Key; das Dashboard loest ihn nach
   *  dem Login selbst ueber GET /api/v1/tenant/session auf. Steckt hier nur
   *  drin, falls du ihn mal fuer Support/Debugging brauchst. */
  api_key: string;
  trial_ends_at: string;
  course_limit: number;
}

export class TrialSignupError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "TrialSignupError";
    this.status = status;
    this.code = code;
  }
}

function safeJsonParse(text: string): { detail?: unknown; code?: unknown } | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Dieselben Kernregeln wie im Backend (siehe handleSignup: isValidEmail /
 *  password.length / company_name) - nur fuer sofortiges Client-Feedback. */
export function validateTrialSignupInput(input: TrialSignupInput): string | null {
  const email = input.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Bitte eine gültige E-Mail-Adresse angeben.";
  }
  if (input.password.length < 8) {
    return "Das Passwort muss mindestens 8 Zeichen lang sein.";
  }
  if (!input.companyName.trim()) {
    return "Bitte einen Bildungsträger-/Firmennamen angeben.";
  }
  return null;
}

export async function createTrialSignup(
  apiBase: string,
  input: TrialSignupInput
): Promise<TrialSignupResult> {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email.trim(),
      password: input.password,
      company_name: input.companyName.trim(),
      plan: input.plan,
      phone: input.phone?.trim() || undefined,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Trial-Signup fehlgeschlagen (HTTP ${res.status})`, body);
    const parsed = body ? safeJsonParse(body) : null;
    const detail = parsed && typeof parsed.detail === "string" ? parsed.detail : undefined;
    const code = parsed && typeof parsed.code === "string" ? parsed.code : undefined;

    // Backend liefert bei 400 (ungueltige Eingabe, z.B. Passwort zu kurz)
    // und 409 (E-Mail bereits registriert, code "email_already_registered")
    // einen konkreten, fuer Endnutzer verstaendlichen "detail"-Text.
    const showDetail = res.status === 400 || res.status === 409;
    throw new TrialSignupError(
      res.status,
      showDetail && detail ? detail : "Der Trial konnte nicht gestartet werden. Bitte später erneut versuchen.",
      code
    );
  }

  return res.json() as Promise<TrialSignupResult>;
}