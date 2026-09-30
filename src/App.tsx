import { useEffect, useState, type CSSProperties } from "react";
import { DashboardPage } from "./pages/DashboardPage";
import { JourneyPage } from "./pages/JourneyPage";
import { LoginPage } from "./pages/LoginPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { TrialLockedPage } from "./pages/TrialLockedPage";
import { PlanPicker } from "./components/PlanPicker";
import { createBillingPortalSession } from "./api/billing";
import { supabase } from "./lib/supabaseClient";
import { fetchTenantSession, type TenantSessionResponse } from "./api/session";
import { fetchAdminSession } from "./api/admin";
import { AdminTenantListPage } from "./pages/AdminTenantListPage";

// Deine deployte Edge-Function-Adresse, z.B.
// https://<DEIN-PROJECT-REF>.supabase.co/functions/v1/api
// In Bolt unter "Umgebungsvariablen" (bzw. lokal in .env) setzen:
//   VITE_ORBIT_API_BASE=https://<DEIN-PROJECT-REF>.supabase.co/functions/v1/api
const API_BASE = (import.meta.env.VITE_ORBIT_API_BASE as string | undefined) ?? "";

type AuthState =
  | { status: "loading" }
  | { status: "loggedOut" }
  | { status: "passwordRecovery" }
  // NEU (30.09.2026, Admin-Modus): dein eigenes Admin-Konto (siehe
  // admin_users-Tabelle im Backend) landet nach dem Login HIER statt in
  // "loggedIn" - Tenant-Auswahl statt direktem Dashboard, siehe
  // resolveSession() unten.
  | { status: "adminTenantList"; adminEmail: string }
  // GEAENDERT (30.09.2026, Admin-Modus): "adminView" ist nur gesetzt, wenn
  // diese Sitzung ueber die Tenant-Auswahl (Impersonation) statt ueber einen
  // echten Tenant-Login zustande kam - steuert die zusaetzliche Admin-Leiste
  // im Dashboard weiter unten.
  | { status: "loggedIn"; session: TenantSessionResponse; adminView?: { adminEmail: string } }
  | { status: "error"; message: string };

/** Rein clientseitige Entsprechung von enforceTenantActive() in orbit-api.ts
 * (Schritt 2) — nur für die Anzeige des Sperrbildschirms. Die tatsächliche
 * Durchsetzung passiert weiterhin serverseitig bei jedem API-Aufruf. */
function tenantLockReason(session: TenantSessionResponse): "trial_expired" | "tenant_inactive" | null {
  if (!session.status) return null; // Legacy-Tenant ohne Plan-Zeile — nie gesperrt.
  if (session.status === "past_due" || session.status === "canceled") return "tenant_inactive";
  if (session.status === "trial" && session.trial_ends_at) {
    if (new Date(session.trial_ends_at).getTime() <= Date.now()) return "trial_expired";
  }
  return null;
}

/**
 * NEU (Schritt 7, Auth-Flow): ersetzt den bisherigen reinen Vorschau-Toggle
 * durch echten Login (Supabase Auth) + Sitzungsauflösung. Ablauf:
 *   1) Supabase-Auth-Session prüfen (E-Mail+Passwort-Login, siehe LoginPage).
 *   2) Mit dem Auth-JWT GET /api/v1/tenant/session aufrufen — liefert den
 *      zum eingeloggten Nutzer gehörenden Tenant-Namen + API-Key + Plan-Status.
 *   3) Ist der Tenant laut Plan-Status gesperrt (abgelaufener Trial /
 *      inaktives Abo) -> TrialLockedPage statt Dashboard.
 *   4) Sonst -> DashboardPage im Whitelabel-Modus (showConnectionPanel=false),
 *      mit dem aufgelösten API-Key/Basis-URL statt manueller Eingabe.
 *
 * Der alte Dashboard/Journey-Vorschau-Toggle bleibt NUR auf deinem eigenen
 * Rechner (echtes localhost, siehe isLocalDevMachine() unten) über einen
 * expliziten Link erreichbar, NIE in der Bolt-Live-Vorschau und NIE im
 * echten Deployment — echte Kunden sehen ihn nie.
 */
/** Warte-Intervalle beim Zurueckkommen von Stripe Checkout: der Webhook
 *  (customer.subscription.updated, siehe Backend Schritt 4) braucht ein paar
 *  Sekunden, bis tenants.status in der DB aktualisiert ist - ohne diesen
 *  kurzen Poll wuerde die Person direkt nach "Diesen Plan wählen" kurz
 *  wieder auf dem Sperrbildschirm landen, obwohl die Zahlung erfolgreich war. */
const CHECKOUT_POLL_DELAYS_MS = [1500, 2000, 2500, 3000, 3000];

function stripCheckoutParamFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("checkout");
  window.history.replaceState({}, "", url.toString());
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * GEÄNDERT (Bugfix): "import.meta.env.DEV" ist NICHT gleichbedeutend mit
 * "läuft nur lokal bei mir" - Bolts Live-Vorschau führt die App ebenfalls
 * über den Vite-Dev-Server aus, d.h. DEV ist dort ebenfalls true. Ohne
 * diesen zusätzlichen Hostname-Check war der "Dev-Vorschau ohne
 * Login"-Link (und damit das alte manuelle API-Key-Feld dahinter) für
 * JEDEN sichtbar, der den Bolt-Vorschau-Link öffnet - nicht nur lokal.
 * Jetzt zusätzlich: nur auf echtem localhost/127.0.0.1 (dein eigener
 * Rechner beim Ausführen von "npm run dev"), NIE in der Bolt-Vorschau oder
 * im echten Deployment.
 */
function isLocalDevMachine(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export default function App() {
  const [devPreview, setDevPreview] = useState(false);
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [syncingCheckout, setSyncingCheckout] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [apiKeyPanelOpen, setApiKeyPanelOpen] = useState(false);
  const [embedPanelOpen, setEmbedPanelOpen] = useState(false);
  const showDevPreviewEntry = import.meta.env.DEV && isLocalDevMachine();

  // NEU (30.09.2026, Journey-Embed): oeffentliche, unauthentifizierte Route
  // fuer den iframe-Code, den ein Bildungstraeger auf seiner eigenen Website
  // einbindet - Aufruf per ?embed=journey&key=<oeffentlicher Journey-Key>
  // (siehe EmbedBox weiter unten, die genau diese URL zusammenbaut). Einmal
  // beim Mount aus der URL gelesen, gleiches Muster wie isV2 in
  // JourneyPage.tsx.
  const [embedJourneyKey] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("embed") === "journey") {
        return params.get("key");
      }
    } catch {
      // kein window (SSR/Tests)
    }
    return null;
  });

  useEffect(() => {
    let cancelled = false;

    async function resolveSession() {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;

      if (!accessToken) {
        if (!cancelled) setAuth({ status: "loggedOut" });
        return;
      }

      const checkoutStatus = new URLSearchParams(window.location.search).get("checkout");

      // NEU (30.09.2026, Admin-Modus): admin_users hat IMMER Vorrang vor der
      // normalen Tenant-Session - so bekommt dein Admin-Konto zuverlaessig
      // die Tenant-Liste zu sehen, unabhaengig davon, ob es (z.B. aus
      // frueheren Tests) zufaellig auch selbst einen Tenant besitzt. Fuer
      // jeden echten Bildungstraeger-Kunden (kein Eintrag in admin_users)
      // schlaegt das hier einfach mit 403 fehl und es geht normal weiter
      // unten mit fetchTenantSession().
      try {
        const adminSession = await fetchAdminSession(API_BASE, accessToken);
        if (checkoutStatus) stripCheckoutParamFromUrl();
        if (!cancelled) setAuth({ status: "adminTenantList", adminEmail: adminSession.email });
        return;
      } catch {
        // kein Admin-Konto - normal als Tenant weiter unten aufloesen.
      }

      try {
        let session = await fetchTenantSession(API_BASE, accessToken);

        // Kommt die Person gerade von einem erfolgreichen Stripe-Checkout
        // zurueck, kurz auf die Webhook-Aktualisierung warten, statt sie
        // fälschlich wieder auf dem Sperrbildschirm zu zeigen ODER (Bugfix,
        // Review-Runde) mit veraltetem Plan/Kurslimit im Dashboard landen zu
        // lassen. GEÄNDERT: nicht mehr nur bei zuvor gesperrten Tenants
        // (abgelaufener Trial/past_due) pollen - auch ein Tenant, der noch
        // GAR NICHT gesperrt war (z.B. freiwilliges Upgrade waehrend eines
        // noch laufenden Trials ueber den "Plan upgraden"-Button), landet
        // sonst nach dem Checkout mit status "trial" und altem course_limit
        // im Dashboard, bis er zufaellig neu laedt. Stattdessen: nach einem
        // erfolgreichen Checkout IMMER warten, bis der Webhook den Status auf
        // "active" gesetzt hat (oder die Versuche ausgehen).
        if (checkoutStatus === "success" && session.status !== "active") {
          if (!cancelled) setSyncingCheckout(true);
          for (const delay of CHECKOUT_POLL_DELAYS_MS) {
            if (cancelled) break;
            await sleep(delay);
            session = await fetchTenantSession(API_BASE, accessToken);
            if (session.status === "active") break;
          }
          if (!cancelled) setSyncingCheckout(false);
        }

        if (checkoutStatus) stripCheckoutParamFromUrl();
        if (!cancelled) setAuth({ status: "loggedIn", session });
      } catch (err) {
        if (checkoutStatus) stripCheckoutParamFromUrl();
        if (!cancelled) {
          setAuth({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    void resolveSession();

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      // NEU (Task #8): kommt die Person ueber den "Passwort vergessen"-Link
      // zurueck, meldet Supabase dieses Event EINMALIG, mit einer gueltigen
      // (Recovery-)Session, aber noch OHNE neues Passwort. In diesem Fall
      // NICHT wie sonst sofort die Tenant-Session aufloesen (das wuerde
      // direkt am ResetPasswordPage-Bildschirm vorbei ins Dashboard fuehren)
      // - erst nach erfolgreichem updateUser() dort geht es normal weiter.
      if (event === "PASSWORD_RECOVERY") {
        if (!cancelled) setAuth({ status: "passwordRecovery" });
        return;
      }
      void resolveSession();
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    setAuth({ status: "loggedOut" });
  }

  // NEU (Billing Portal): oeffnet Stripes gehostete Kundenportal-Seite
  // (Zahlungsmittel aendern, Rechnungen einsehen, selbst kuendigen) - fuer
  // einen Tenant mit bereits bestehendem Stripe-Abo. Getrennt vom
  // PlanPicker/Checkout, siehe Kommentar bei createBillingPortalSession().
  async function handleManageBilling(apiKey: string) {
    setPortalError(null);
    setPortalLoading(true);
    try {
      const returnUrl = window.location.origin + window.location.pathname;
      const { portal_url } = await createBillingPortalSession(API_BASE, apiKey, returnUrl);
      window.location.href = portal_url;
    } catch (err) {
      setPortalLoading(false);
      setPortalError(err instanceof Error ? err.message : String(err));
    }
  }

  // NEU (30.09.2026, Journey-Embed): bewusst VOR jeder Login-/Tenant-Session-
  // Logik geprueft - der Endnutzer im iframe ist NIE bei ORBIT eingeloggt,
  // er ist einfach Besucher der Website des Bildungstraegers. showConnectionPanel
  // bleibt false, damit im Embed nie ein Verbindungs-/Debug-Formular
  // aufblitzt, egal in welchem Modus (Dev/Prod) die Seite laeuft.
  if (embedJourneyKey) {
    return <JourneyPage defaultApiKey={embedJourneyKey} defaultBaseUrl={API_BASE} showConnectionPanel={false} />;
  }

  if (showDevPreviewEntry && devPreview) {
    return <DevPreview onExit={() => setDevPreview(false)} />;
  }

  if (auth.status === "loading") {
    return (
      <CenteredMessage>{syncingCheckout ? "Dein Plan wird aktiviert…" : "Lade…"}</CenteredMessage>
    );
  }

  if (auth.status === "loggedOut") {
    return (
      <>
        <LoginPage onLoggedIn={() => setAuth({ status: "loading" })} />
        {showDevPreviewEntry && (
          <button style={devLinkStyle} onClick={() => setDevPreview(true)}>
            Dev-Vorschau ohne Login
          </button>
        )}
      </>
    );
  }

  if (auth.status === "passwordRecovery") {
    return <ResetPasswordPage onPasswordUpdated={() => setAuth({ status: "loading" })} />;
  }

  if (auth.status === "error") {
    return (
      <CenteredMessage>
        <div>Anmeldung fehlgeschlagen: {auth.message}</div>
        <button style={{ marginTop: 12 }} onClick={handleLogout}>
          Erneut versuchen
        </button>
      </CenteredMessage>
    );
  }

  // NEU (30.09.2026, Admin-Modus): Tenant-Auswahl statt Dashboard - siehe
  // AdminTenantListPage.tsx. Ein Klick auf "Dashboard öffnen" dort ruft
  // onOpenTenant() auf und wechselt in denselben "loggedIn"-Zustand wie ein
  // echter Tenant-Login, nur mit gesetztem adminView (siehe Banner weiter
  // unten).
  if (auth.status === "adminTenantList") {
    return (
      <AdminTenantListPage
        apiBase={API_BASE}
        adminEmail={auth.adminEmail}
        onOpenTenant={(session) =>
          setAuth({ status: "loggedIn", session, adminView: { adminEmail: auth.adminEmail } })
        }
        onLogout={handleLogout}
      />
    );
  }

  const lockReason = tenantLockReason(auth.session);
  if (lockReason) {
    return (
      <TrialLockedPage
        reason={lockReason}
        apiBase={API_BASE}
        apiKey={auth.session.api_key}
        // NEU (Billing Portal): past_due/canceled hat evtl. schon ein
        // bestehendes Stripe-Abo, das repariert (statt per Checkout ein
        // zweites angelegt) werden soll - siehe TrialLockedPage.
        onManageBilling={lockReason === "tenant_inactive" ? () => handleManageBilling(auth.session.api_key) : undefined}
        portalLoading={portalLoading}
        portalError={portalError}
        onLogout={handleLogout}
      />
    );
  }

  // Noch nicht gesperrt, aber im Trial -> zusätzlicher, freiwilliger
  // Upgrade-Einstieg direkt im Dashboard (Team-Entscheidung: "Im
  // ORBIT-Dashboard/Sperrbildschirm"), damit man nicht erst auf den
  // Sperrbildschirm warten muss, um einen bezahlten Plan zu wählen.
  const canUpgrade = auth.session.status === "trial";
  // NEU (Billing Portal): ein bereits zahlender Kunde soll Zahlungsdaten/
  // Rechnungen selbst verwalten koennen, ohne Support kontaktieren zu muessen.
  const canManageBilling = auth.session.status === "active";
  // NEU (30.09.2026, Admin-Modus): nur gesetzt, wenn diese Sitzung ueber die
  // Tenant-Auswahl (Impersonation) zustande kam - steuert Admin-Leiste +
  // Logout-Beschriftung unten. In einen lokalen const kopiert (statt jedes
  // Mal auth.adminView zu schreiben), damit TypeScript die Narrowing auch in
  // den onClick-Closures unten sauber durchreicht.
  const adminView = auth.adminView;

  return (
    <div>
      {adminView && (
        <div style={adminBannerStyle}>
          <span>
            Admin-Ansicht: eingeloggt als <strong>{auth.session.tenant_name}</strong> ({adminView.adminEmail})
          </span>
          <button
            style={adminBannerButtonStyle}
            onClick={() => setAuth({ status: "adminTenantList", adminEmail: adminView.adminEmail })}
          >
            ← Zurück zur Tenant-Liste
          </button>
        </div>
      )}
      <div style={headerActionsRowStyle}>
        {/* NEU (Direktkauf): der API-Key muss fuer JEDEN eingeloggten Tenant
         * sichtbar/kopierbar sein - insbesondere fuer einen Direktkauf-Kunden
         * ohne vorherigen Trial ist das Login gerade der einzige Weg, an
         * seinen Key zu kommen ("dem Kaeufer zugaenglich gemacht werden",
         * siehe Team-Entscheidung). Bewusst HIER in App.tsx statt in
         * DashboardPage, damit es unabhaengig von deren Inhalt garantiert
         * angezeigt wird. */}
        <button style={apiKeyButtonStyle} onClick={() => setApiKeyPanelOpen(true)}>
          API-Zugang
        </button>
        {/* NEU (30.09.2026, Journey-Embed): fertiger iframe-Code fuer die
         * Nutzer-Journey, mit dem eigenen oeffentlichen Journey-Key des
         * Tenants (auth.session.journey_key - NICHT dem Operator-Key oben),
         * damit der Bildungstraeger sie auf seiner eigenen Website
         * einbetten kann. */}
        <button style={apiKeyButtonStyle} onClick={() => setEmbedPanelOpen(true)}>
          Journey einbetten
        </button>
        {canManageBilling && (
          <button
            style={manageBillingButtonStyle}
            disabled={portalLoading}
            onClick={() => void handleManageBilling(auth.session.api_key)}
          >
            {portalLoading ? "Wird geöffnet…" : "Abo verwalten"}
          </button>
        )}
        {canUpgrade && (
          <button style={upgradeButtonStyle} onClick={() => setUpgradeOpen(true)}>
            Plan upgraden
          </button>
        )}
        <button style={logoutButtonStyle} onClick={handleLogout}>
          {adminView ? "Admin abmelden" : "Abmelden"}
        </button>
      </div>
      {portalError && <div style={portalErrorStyle}>{portalError}</div>}
      <DashboardPage
        tenantName={auth.session.tenant_name}
        defaultBaseUrl={API_BASE}
        defaultApiKey={auth.session.api_key}
        showConnectionPanel={false}
      />
      {upgradeOpen && (
        <div style={overlayStyle} onClick={() => setUpgradeOpen(false)}>
          <div style={overlayCardStyle} onClick={(e) => e.stopPropagation()}>
            <button style={overlayCloseStyle} onClick={() => setUpgradeOpen(false)} aria-label="Schließen">
              ×
            </button>
            <h2 style={overlayHeadingStyle}>Plan upgraden</h2>
            <PlanPicker apiBase={API_BASE} apiKey={auth.session.api_key} />
          </div>
        </div>
      )}
      {apiKeyPanelOpen && (
        <div style={overlayStyle} onClick={() => setApiKeyPanelOpen(false)}>
          <div style={overlayCardStyle} onClick={(e) => e.stopPropagation()}>
            <button style={overlayCloseStyle} onClick={() => setApiKeyPanelOpen(false)} aria-label="Schließen">
              ×
            </button>
            <h2 style={overlayHeadingStyle}>API-Zugang</h2>
            <ApiKeyBox tenantId={auth.session.tenant_id} apiKey={auth.session.api_key} apiBase={API_BASE} />
          </div>
        </div>
      )}
      {embedPanelOpen && (
        <div style={overlayStyle} onClick={() => setEmbedPanelOpen(false)}>
          <div style={overlayCardStyle} onClick={(e) => e.stopPropagation()}>
            <button style={overlayCloseStyle} onClick={() => setEmbedPanelOpen(false)} aria-label="Schließen">
              ×
            </button>
            <h2 style={overlayHeadingStyle}>Journey einbetten</h2>
            <EmbedBox journeyKey={auth.session.journey_key} />
          </div>
        </div>
      )}
    </div>
  );
}

/** NEU (Direktkauf): einfache Anzeige der Zugangsdaten mit "Kopieren"-Buttons,
 * damit auch ein Kunde, der nie den ORBIT-Support kontaktiert hat, seinen
 * API-Key selbst findet und in seine eigene Website/Integration eintragen
 * kann. */
function ApiKeyBox({ tenantId, apiKey, apiBase }: { tenantId: string; apiKey: string; apiBase: string }) {
  const [copied, setCopied] = useState<"key" | "base" | null>(null);

  async function copy(value: string, which: "key" | "base") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard-API kann in manchen Kontexten fehlen/verweigert werden -
      // dann bleibt nur manuelles Markieren/Kopieren, kein Absturz.
    }
  }

  return (
    <div style={apiKeyBoxStyle}>
      <p style={apiKeyHintStyle}>
        Tenant-ID: <strong>{tenantId}</strong>
      </p>
      <label style={apiKeyLabelStyle}>API-Basis-URL</label>
      <div style={apiKeyRowStyle}>
        <code style={apiKeyCodeStyle}>{apiBase}</code>
        <button style={apiKeyCopyButtonStyle} onClick={() => void copy(apiBase, "base")}>
          {copied === "base" ? "Kopiert!" : "Kopieren"}
        </button>
      </div>
      <label style={apiKeyLabelStyle}>API-Key</label>
      <div style={apiKeyRowStyle}>
        <code style={apiKeyCodeStyle}>{apiKey}</code>
        <button style={apiKeyCopyButtonStyle} onClick={() => void copy(apiKey, "key")}>
          {copied === "key" ? "Kopiert!" : "Kopieren"}
        </button>
      </div>
      <p style={apiKeyWarningStyle}>
        Behandle diesen Key wie ein Passwort - gib ihn nur in deine eigene Website/Integration ein,
        niemals an Dritte weiter.
      </p>
    </div>
  );
}

/** NEU (30.09.2026, Journey-Embed): zeigt den fertigen iframe-Code fuer die
 * Nutzer-Journey mit dem OEFFENTLICHEN Journey-Key des Tenants (Produkt
 * "journey", siehe generatePublicApiKey()/handleTenantSession() im
 * Backend) - bewusst NIE dem Operator-Key aus ApiKeyBox oben. Dieser Key
 * darf oeffentlich im Seitenquelltext einer fremden Website stehen: er kann
 * serverseitig nur die paar Journey-Endpunkte nutzen (Skill-Match,
 * Gap-Analyse, Kursvorschlag, Test-Log, Lead-Anlegen), nicht Kurse
 * verwalten oder die Leads-Liste/Reports lesen. journeyKey ist nur bei
 * einem sehr alten Tenant null, falls das automatische Nachlegen im
 * Backend einmalig fehlschlug - dann bittet der Hinweistext, es per
 * erneutem Login zu versuchen. */
function EmbedBox({ journeyKey }: { journeyKey: string | null }) {
  const [copied, setCopied] = useState<"url" | "snippet" | null>(null);

  const embedUrl = journeyKey
    ? `${window.location.origin}${window.location.pathname}?embed=journey&key=${encodeURIComponent(journeyKey)}`
    : "";
  const iframeSnippet = embedUrl
    ? `<iframe src="${embedUrl}" style="width:100%;min-height:900px;border:0" title="Weiterbildungs-Finder"></iframe>`
    : "";

  async function copy(value: string, which: "url" | "snippet") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard-API kann in manchen Kontexten fehlen/verweigert werden -
      // dann bleibt nur manuelles Markieren/Kopieren, kein Absturz.
    }
  }

  if (!journeyKey) {
    return (
      <div style={apiKeyBoxStyle}>
        <p style={apiKeyWarningStyle}>
          Für dein Konto wurde noch kein öffentlicher Journey-Key angelegt. Bitte einmal ab- und
          wieder anmelden - danach sollte er hier erscheinen.
        </p>
      </div>
    );
  }

  return (
    <div style={apiKeyBoxStyle}>
      <p style={apiKeyHintStyle}>
        Binde diesen Code auf deiner eigenen Website ein, damit Besucher dort direkt den
        Weiterbildungs-Finder nutzen können. Der enthaltene Key ist absichtlich eingeschränkt -
        er kann keine Kurse verwalten und keine Leads einsehen, nur die Journey selbst ausführen.
      </p>
      <label style={apiKeyLabelStyle}>Einbettungs-Code (iframe)</label>
      <div style={apiKeyRowStyle}>
        <code style={apiKeyCodeStyle}>{iframeSnippet}</code>
        <button style={apiKeyCopyButtonStyle} onClick={() => void copy(iframeSnippet, "snippet")}>
          {copied === "snippet" ? "Kopiert!" : "Kopieren"}
        </button>
      </div>
      <label style={apiKeyLabelStyle}>Nur der Link (z.B. für einen Button/Menüpunkt)</label>
      <div style={apiKeyRowStyle}>
        <code style={apiKeyCodeStyle}>{embedUrl}</code>
        <button style={apiKeyCopyButtonStyle} onClick={() => void copy(embedUrl, "url")}>
          {copied === "url" ? "Kopiert!" : "Kopieren"}
        </button>
      </div>
      <p style={apiKeyWarningStyle}>
        Dieser Key ist bewusst öffentlich einsetzbar - trotzdem gilt: nur auf Seiten einbetten, die
        du selbst kontrollierst.
      </p>
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter', system-ui, sans-serif",
        color: "#5b6779",
        textAlign: "center",
        padding: 16,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Der alte, unveränderte Vorschau-Toggle (vor Schritt 7) — nur im
 * Dev-Server erreichbar, siehe App() oben.
 */
function DevPreview({ onExit }: { onExit: () => void }) {
  type View = "dashboard" | "journey";
  const [view, setView] = useState<View>("dashboard");

  return (
    <div>
      <div
        style={{
          position: "fixed",
          top: 12,
          left: 12,
          zIndex: 50,
          display: "flex",
          gap: 8,
          background: "#fff",
          border: "1px solid #e6eaf2",
          borderRadius: 12,
          padding: 6,
          boxShadow: "0 8px 24px rgba(15,27,45,.08)",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        <ViewButton active={view === "dashboard"} onClick={() => setView("dashboard")}>
          Bildungsträger-Dashboard
        </ViewButton>
        <ViewButton active={view === "journey"} onClick={() => setView("journey")}>
          Nutzer-Journey
        </ViewButton>
        <ViewButton active={false} onClick={onExit}>
          ← Zurück zum Login
        </ViewButton>
      </div>

      {view === "dashboard" ? <DashboardPage /> : <JourneyPage />}
    </div>
  );
}

function ViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "none",
        borderRadius: 8,
        padding: "8px 14px",
        fontSize: 12.5,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "inherit",
        background: active ? "linear-gradient(90deg, #8fecb4, #2f8fd6)" : "transparent",
        color: active ? "#0c1c34" : "#5b6779",
      }}
    >
      {children}
    </button>
  );
}

/** NEU (Bugfix Überlappung): alle Header-Aktions-Buttons (API-Zugang, Abo
 *  verwalten/Plan upgraden, Abmelden) sitzen jetzt in EINER gemeinsamen
 *  fixed-Flexbox-Zeile (headerActionsRowStyle) statt jeder einzeln mit
 *  eigenem hartem "right"-Pixelwert. Vorher überlappten sich Buttons mit
 *  längerem Text (z.B. "Plan upgraden"), weil der eingeplante Abstand nicht
 *  zur tatsächlichen Button-Breite passte. Die einzelnen Styles hier
 *  enthalten deshalb bewusst kein position/top/right/zIndex mehr. */
const headerActionsRowStyle: CSSProperties = {
  position: "fixed",
  top: 12,
  right: 12,
  zIndex: 50,
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  gap: 8,
  maxWidth: "calc(100vw - 24px)",
};

const adminBannerStyle: CSSProperties = {
  position: "fixed",
  top: 12,
  left: 12,
  zIndex: 55,
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
  maxWidth: "calc(100vw - 24px)",
  background: "#0c1c34",
  color: "#fff",
  border: "1px solid #14294a",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 12.5,
  fontFamily: "'Inter', system-ui, sans-serif",
  boxShadow: "0 8px 24px rgba(15,27,45,.25)",
};

const adminBannerButtonStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,.35)",
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  background: "transparent",
  color: "#fff",
  whiteSpace: "nowrap",
};

const logoutButtonStyle: CSSProperties = {
  border: "1px solid #e6eaf2",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "'Inter', system-ui, sans-serif",
  background: "#fff",
  color: "#5b6779",
  boxShadow: "0 8px 24px rgba(15,27,45,.08)",
  whiteSpace: "nowrap",
};

const apiKeyButtonStyle: CSSProperties = {
  border: "1px solid #e6eaf2",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "'Inter', system-ui, sans-serif",
  background: "#fff",
  color: "#5b6779",
  boxShadow: "0 8px 24px rgba(15,27,45,.08)",
  whiteSpace: "nowrap",
};

const apiKeyBoxStyle: CSSProperties = {
  fontFamily: "'Inter', system-ui, sans-serif",
};

const apiKeyHintStyle: CSSProperties = {
  margin: "0 0 16px",
  fontSize: 13.5,
  color: "#5b6779",
};

const apiKeyLabelStyle: CSSProperties = {
  display: "block",
  fontSize: 12.5,
  fontWeight: 600,
  color: "#5b6779",
  marginBottom: 6,
};

const apiKeyRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 16,
};

const apiKeyCodeStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflowX: "auto",
  whiteSpace: "nowrap",
  background: "#fafbfd",
  border: "1px solid #e6eaf2",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12.5,
  color: "#0c1c34",
};

const apiKeyCopyButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 12.5,
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
  background: "#0c1c34",
  color: "#fff",
  whiteSpace: "nowrap",
};

const apiKeyWarningStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: "#5b6779",
};

const manageBillingButtonStyle: CSSProperties = {
  border: "1px solid #e6eaf2",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "'Inter', system-ui, sans-serif",
  background: "#fff",
  color: "#5b6779",
  boxShadow: "0 8px 24px rgba(15,27,45,.08)",
  whiteSpace: "nowrap",
};

const portalErrorStyle: CSSProperties = {
  position: "fixed",
  top: 56,
  right: 12,
  zIndex: 50,
  maxWidth: 280,
  fontSize: 12.5,
  color: "#c0392b",
  background: "#fdecea",
  border: "1px solid #f5c6c0",
  borderRadius: 8,
  padding: "8px 10px",
  boxShadow: "0 8px 24px rgba(15,27,45,.08)",
};

const devLinkStyle: CSSProperties = {
  position: "fixed",
  bottom: 16,
  left: 16,
  border: "none",
  background: "none",
  color: "#5b6779",
  fontSize: 12.5,
  fontFamily: "'Inter', system-ui, sans-serif",
  textDecoration: "underline",
  cursor: "pointer",
};

const upgradeButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "'Inter', system-ui, sans-serif",
  background: "linear-gradient(90deg, #8fecb4, #2f8fd6)",
  color: "#0c1c34",
  boxShadow: "0 8px 24px rgba(15,27,45,.08)",
  whiteSpace: "nowrap",
};

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  background: "rgba(12,28,52,.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const overlayCardStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  maxWidth: 760,
  maxHeight: "90vh",
  overflowY: "auto",
  background: "#fff",
  borderRadius: 16,
  padding: "32px 28px",
  fontFamily: "'Inter', system-ui, sans-serif",
};

const overlayCloseStyle: CSSProperties = {
  position: "absolute",
  top: 14,
  right: 14,
  border: "none",
  background: "none",
  fontSize: 22,
  lineHeight: 1,
  color: "#5b6779",
  cursor: "pointer",
};

const overlayHeadingStyle: CSSProperties = {
  margin: "0 0 18px",
  fontSize: 20,
  color: "#0c1c34",
  textAlign: "center",
};