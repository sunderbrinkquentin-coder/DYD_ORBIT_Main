/**
 * NEU (Feedback-/Ticket-System): sendet ein Feedback aus dem ORBIT-Frontend an
 * die Serverfunktion "feedback-ticket" (Supabase Edge Function). Diese legt
 * das Ticket in der Datenbank ab und schickt es per Resend als Mail an DYD.
 *
 * Bewusst eine EIGENE, schlanke Datei (gleiche Architekturentscheidung wie
 * billing.ts/admin.ts): der Aufruf authentifiziert per Bearer-JWT des
 * eingeloggten Kontos — nicht per X-API-Key wie core.ts/orbit.ts.
 *
 * Jedes Ticket ist automatisch mit dem angemeldeten Konto verbunden und mit
 * dem Seitenkontext (Seite, Bereich, URL, Browser) versehen — der Absender
 * tippt nur Art + Anliegen, der Rest kommt aus der laufenden Sitzung.
 */

import { supabase } from "../lib/supabaseClient";

export type FeedbackTicketType = "idee" | "fehler" | "verbesserung";

export interface FeedbackTicketInput {
  ticket_type: FeedbackTicketType;
  message: string;
  /** Freiwillige Kontaktangabe; leer = nur das Konto selbst. */
  contact?: string;
  /** Anzeigename des angemeldeten Kontos (vorausgefuellt). */
  account_name?: string;
  /** Mandanten-/Bildungsstraeger-Name, aus dem gemeldet wurde. */
  tenant_name?: string | null;
  /** Seite, auf der das Feedback entstanden ist (z.B. "Dashboard — Leads"). */
  page: string;
  /** Bereich/Tab innerhalb der Seite (z.B. "Kursformular"). */
  section: string;
  /** Vollstaendige URL zum Zeitpunkt der Meldung. */
  app_url?: string | null;
}

export interface FeedbackTicketResult {
  ok: true;
  ticket_id: string;
  email_sent: boolean;
}

export class FeedbackTicketError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "FeedbackTicketError";
    this.status = status;
    this.code = code;
  }
}

function functionsBaseUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) throw new FeedbackTicketError(0, "Server-Adresse ist nicht konfiguriert.");
  return url.replace(/\/$/, "");
}

function safeJsonParse(text: string): { error?: unknown; code?: unknown } | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Sendet ein Ticket an die Serverfunktion. Wirft FeedbackTicketError bei
 *  Netzwerk-/Server-/Authentifizierungsproblemen; die Fehlermeldung ist
 *  bewusst nutzerfreundlich und enthaelt keine rohen Serverdetails. */
export async function submitFeedbackTicket(input: FeedbackTicketInput): Promise<FeedbackTicketResult> {
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new FeedbackTicketError(401, "Bitte melde dich erneut an.");
  }
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new FeedbackTicketError(401, "Bitte melde dich an, um Feedback zu senden.");
  }

  let res: Response;
  try {
    res = await fetch(`${functionsBaseUrl()}/functions/v1/feedback-ticket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ticket_type: input.ticket_type,
        message: input.message,
        contact: input.contact?.trim() || "",
        account_name: input.account_name?.trim() || "",
        tenant_name: input.tenant_name ?? null,
        page: input.page,
        section: input.section,
        app_url: input.app_url ?? (typeof window !== "undefined" ? window.location.href : null),
      }),
    });
  } catch {
    throw new FeedbackTicketError(0, "Keine Verbindung zum Server - bitte Internet pruefen und erneut versuchen.");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const parsed = body ? safeJsonParse(body) : null;
    // Nur die kurzen, bewusst formulierten Servermeldungen zeigen (z.B.
    // Tageslimit erreicht); alles andere bleibt in der Konsole.
    const serverError = parsed && typeof parsed.error === "string" ? parsed.error : "";
    console.error(`Feedback-Ticket fehlgeschlagen (HTTP ${res.status})`, body);
    if (res.status === 429 && serverError) {
      throw new FeedbackTicketError(429, serverError);
    }
    if (res.status === 401) {
      throw new FeedbackTicketError(401, "Deine Anmeldung ist abgelaufen - bitte neu einloggen.");
    }
    throw new FeedbackTicketError(
      res.status,
      "Das Ticket konnte gerade nicht gesendet werden. Bitte spaeter erneut versuchen - oder direkt an quentin@decideyourdream.de schreiben.",
    );
  }

  let result: FeedbackTicketResult;
  try {
    result = (await res.json()) as FeedbackTicketResult;
  } catch {
    throw new FeedbackTicketError(500, "Ungueltige Serverantwort.");
  }
  if (!result?.ok || !result.ticket_id) {
    throw new FeedbackTicketError(500, "Ungueltige Serverantwort.");
  }
  return result;
}
