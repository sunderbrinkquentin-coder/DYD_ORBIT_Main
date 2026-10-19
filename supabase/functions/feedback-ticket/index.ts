// Serverfunktion "feedback-ticket":nimmt ein Feedback-/Ticket-Formular aus dem
// ORBIT-Frontend an, legt es in der Supabase-Tabelle "feedback_tickets" ab und
// sendet es per Resend als E-Mail-Ticket an DYD (quentin@decideyourdream.de).
//
// Sicherheit:
// - Der Resend-API-Key lebt AUSSCHLIESSLICH hier als Secret (RESEND_API_KEY),
//   niemals im Frontend.
// - Eingaben sind hart begrenzt (Laenge, Art, Kontakt), damit niemand das
//   Ticket-Postfach oder das Email-Guthaben zumuellen kann.
// - Resend-Ausfall blockiert das Ticket NICHT: der Eintrag bleibt in der
//   Datenbank, die Mailversand-Ergebnis wird nur protokolliert.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

if (import.meta.main) {
  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }
    return handle(req);
  });
}

const TICKET_TYPES = new Set(["idee", "fehler", "verbesserung"]);
const MAX_MESSAGE_LENGTH = 5000;
const MAX_SHORT_FIELD = 200;
const TICKET_INBOX = "quentin@decideyourdream.de";
// Max. 5 Tickets pro Konto und Tag - das reicht fuer echtes Feedback, stoppt
// aber Masseneintraege, die das Email-Guthbeiten leerfahren koennten.
const MAX_TICKETS_PER_USER_PER_DAY = 5;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

async function handle(req: Request) {
  if (req.method !== "POST") {
    return json({ error: "Nur POST-Anfragen werden unterstuetzt." }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!accessToken) {
      return json({ error: "Bitte zuerst anmelden." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !supabaseAnonKey) {
      return json({ error: "Server-Konfiguration unvollstaendig." }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData?.user) {
      return json({ error: "Sitzung ungueltig - bitte neu anmelden." }, 401);
    }
    const user = userData.user;
    const userEmail = user.email ?? "";

    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return json({ error: "Ungueltige Anfrage." }, 400);
    }

    const ticketType = clip(payload.ticket_type, 20).toLowerCase();
    const message = clip(payload.message, MAX_MESSAGE_LENGTH);
    const contact = clip(payload.contact, MAX_SHORT_FIELD);
    const accountEmail = clip(payload.account_email, MAX_SHORT_FIELD) || userEmail;
    const accountName = clip(payload.account_name, MAX_SHORT_FIELD);
    const tenantName = clip(payload.tenant_name, MAX_SHORT_FIELD);
    const page = clip(payload.page, MAX_SHORT_FIELD) || "(unbekannte Seite)";
    const section = clip(payload.section, MAX_SHORT_FIELD) || "(kein Bereich)";
    const userAgent = clip(req.headers.get("User-Agent"), MAX_SHORT_FIELD);
    const appUrl = clip(payload.app_url, MAX_SHORT_FIELD);

    if (!TICKET_TYPES.has(ticketType)) {
      return json({ error: "Bitte eine Ticket-Art (Idee, Fehler oder Verbesserung) waehlen." }, 400);
    }
    if (!message) {
      return json({ error: "Bitte das Anliegen beschreiben." }, 400);
    }
    if (!contact && !userEmail) {
      return json({ error: "Bitte angeben, wie wir dich erreichen koennen." }, 400);
    }

    // Aussteller der Session pruefen: Konto muss zum Ticket passen (Spam-
    // Schutz + "mit dem Konto verbunden", wie gewuenscht).
    const { data: tickets, error: recentError } = await supabase
      .from("feedback_tickets")
      .select("id")
      .eq("user_id", user.id)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if (recentError) {
      console.error("feedback-ticket: Rate-Limit-Abfrage fehlgeschlagen", recentError);
      return json({ error: "Ticket konnte nicht geprueft werden - bitte spaeter erneut." }, 500);
    }
    if ((tickets?.length ?? 0) >= MAX_TICKETS_PER_USER_PER_DAY) {
      return json(
        { error: "Für heute ist das Limit erreicht - bitte morgen erneut oder direkt an quentin@decideyourdream.de schreiben." },
        429,
      );
    }

    const insertPayload = {
      user_id: user.id,
      account_email: accountEmail,
      account_name: accountName || null,
      tenant_name: tenantName || null,
      ticket_type: ticketType,
      page,
      section,
      message,
      contact: contact || null,
      app_url: appUrl || null,
      user_agent: userAgent || null,
      status: "offen",
      email_sent: false,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("feedback_tickets")
      .insert(insertPayload)
      .select("id, created_at")
      .single();
    if (insertError || !inserted) {
      console.error("feedback-ticket: Eintrag fehlgeschlagen", insertError);
      return json({ error: "Ticket konnte nicht gespeichert werden - bitte spaeter erneut." }, 500);
    }

    let emailSent = false;
    try {
      emailSent = await sendResendMail({
        ticketType,
        accountEmail,
        accountName,
        tenantName,
        page,
        section,
        message,
        contact,
        appUrl,
        userAgent,
        ticketId: inserted.id,
      });
    } catch (mailError) {
      console.error("feedback-ticket: Mailversand fehlgeschlagen", mailError);
    }

    if (emailSent) {
      await supabase.from("feedback_tickets").update({ email_sent: true }).eq("id", inserted.id);
    }

    return json({ ok: true, ticket_id: inserted.id, email_sent: emailSent }, 201);
  } catch (err) {
    console.error("feedback-ticket: unerwarteter Fehler", err);
    return json({ error: "Unerwarteter Fehler - bitte spaeter erneut versuchen." }, 500);
  }
}

async function sendResendMail(ticket: {
  ticketType: string;
  accountEmail: string;
  accountName: string | null;
  tenantName: string | null;
  page: string;
  section: string;
  message: string;
  contact: string;
  appUrl: string | null;
  userAgent: string | null;
  ticketId: string;
}): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!apiKey) {
    console.error("feedback-ticket: RESEND_API_KEY ist nicht gesetzt");
    return false;
  }

  const typeLabel =
    ticket.ticketType === "fehler" ? "Fehler" : ticket.ticketType === "verbesserung" ? "Verbesserung" : "Idee";
  const subject = `[ORBIT ${typeLabel}] ${ticket.tenantName || ticket.accountEmail} — ${ticket.page}`;

  const lines = [
    `Ticket-ID: ${ticket.ticketId}`,
    `Art: ${typeLabel}`,
    `Konto: ${ticket.accountName || "-"} <${ticket.accountEmail}>`,
    `Mandant: ${ticket.tenantName || "-"}`,
    `Seite: ${ticket.page}`,
    `Bereich: ${ticket.section}`,
    `Kontakt: ${ticket.contact || "-"}`,
    ticket.appUrl ? `URL: ${ticket.appUrl}` : null,
    ticket.userAgent ? `Browser: ${ticket.userAgent}` : null,
    `Eingegangen: ${new Date().toISOString()}`,
    "",
    "Anliegen:",
    ticket.message,
  ].filter((l): l is string => l !== null);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "ORBIT Tickets <onboarding@resend.dev>",
      to: [TICKET_INBOX],
      reply_to: ticket.contact.includes("@") ? ticket.contact : ticket.accountEmail,
      subject,
      text: lines.join("\n"),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`feedback-ticket: Resend lehnte ab (HTTP ${res.status})`, body);
    return false;
  }
  return true;
}
