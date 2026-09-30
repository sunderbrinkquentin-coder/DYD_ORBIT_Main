/**
 * Schritt 5 (Website-Anbindung): ruft den oeffentlichen, unauthentifizierten
 * Endpunkt POST /api/v1/signup deiner ORBIT-API auf (siehe handleSignup()
 * in orbit-api.ts, Schritt 3). Legt einen neuen 7-Tage-Trial-Tenant an -
 * KEINE Zahlungsdaten, KEIN Stripe-Checkout hier: Plan-Auswahl/Upgrade
 * passiert bewusst erst spaeter, eingeloggt in ORBIT selbst (siehe
 * PlanPicker.tsx dort) - das ist die von dir bestaetigte Architektur
 * ("Paywall auf der Website, Login+Checkout in ORBIT").
 *
 * CORS: die Edge Function setzt "Access-Control-Allow-Origin: *", ein
 * direkter Aufruf von dieser Website aus (Client-Component) funktioniert
 * daher ohne eigenen Server-Proxy.
 *
 * Benoetigte Umgebungsvariable (Next.js, .env.local):
 *   NEXT_PUBLIC_ORBIT_API_BASE=https://<DEIN-PROJECT-REF>.supabase.co/functions/v1/api
 * (dieselbe Basis-URL wie VITE_ORBIT_API_BASE im Bolt-Projekt.)
 */

export interface TrialSignupInput {
  email: string;
  password: string;
  companyName: string;
  /** NEU (Personalisierung): "Ihr Name" - fuer eine persoenliche Anrede in
   *  der Bestaetigungsmail, siehe trialSignupEmailHtml() im Backend. */
  contactName: string;
}

export interface TrialSignupResult {
  tenant_id: string;
  tenant_name: string;
  api_key: string;
  trial_ends_at: string;
  course_limit: number;
}

/**
 * Eigene, kleine Fehlerklasse fuer diese Website (unabhaengig vom
 * ORBIT-Frontend - andere Codebasis, kein Zugriff auf core.ts dort).
 * message ist bewusst die vom Backend gelieferte "detail"-Meldung fuer
 * die erwartbaren Validierungsfaelle (siehe shouldShowDetail unten) -
 * die Signup-Fehlermeldungen im Backend sind extra freundlich/endnutzer-
 * tauglich formuliert (siehe Kommentar bei handleSignup() in orbit-api.ts),
 * anders als die generischen Fehler der authentifizierten Endpunkte.
 */
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

/** Dieselben Regeln wie serverseitig (isValidEmail/password.length in
 *  orbit-api.ts) - hier NUR fuer sofortiges Client-Feedback, ohne Rundreise
 *  zum Server. Die eigentliche, verbindliche Pruefung bleibt serverseitig. */
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
  if (!input.contactName.trim()) {
    return "Bitte Ihren Namen angeben.";
  }
  return null;
}

/** Ruft POST /api/v1/signup auf. apiBase = NEXT_PUBLIC_ORBIT_API_BASE. */
export async function signupTrialTenant(
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
      contact_name: input.contactName.trim(),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const parsed = body ? safeJsonParse(body) : null;
    const detail = parsed && typeof parsed.detail === "string" ? parsed.detail : undefined;
    const code = parsed && typeof parsed.code === "string" ? parsed.code : undefined;

    // Wie in extractDocumentText() (core.ts, ORBIT-Frontend): bei 400/409
    // sind die "detail"-Meldungen bewusst freundlich formuliert und duerfen
    // 1:1 angezeigt werden (siehe handleSignup()-Kommentar im Backend).
    // Bei allem anderen (z.B. 500) NICHT die rohe Meldung zeigen - die
    // kann interne Details enthalten ("Interner Fehler: ...").
    const showDetail = res.status === 400 || res.status === 409;
    console.error(`Signup fehlgeschlagen (HTTP ${res.status})`, body);
    throw new TrialSignupError(
      res.status,
      showDetail && detail ? detail : "Die Registrierung ist fehlgeschlagen. Bitte später erneut versuchen.",
      code
    );
  }

  return res.json() as Promise<TrialSignupResult>;
}