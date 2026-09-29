import { useEffect, useState, type CSSProperties } from "react";
import { DashboardPage } from "./pages/DashboardPage";
import { JourneyPage } from "./pages/JourneyPage";
import { LoginPage } from "./pages/LoginPage";
import { TrialLockedPage } from "./pages/TrialLockedPage";
import { supabase } from "./lib/supabaseClient";
import { fetchTenantSession, type TenantSessionResponse } from "./api/session";

// Deine deployte Edge-Function-Adresse, z.B.
// https://<DEIN-PROJECT-REF>.supabase.co/functions/v1/api
// In Bolt unter "Umgebungsvariablen" (bzw. lokal in .env) setzen:
//   VITE_ORBIT_API_BASE=https://<DEIN-PROJECT-REF>.supabase.co/functions/v1/api
const API_BASE = (import.meta.env.VITE_ORBIT_API_BASE as string | undefined) ?? "";

type AuthState =
  | { status: "loading" }
  | { status: "loggedOut" }
  | { status: "loggedIn"; session: TenantSessionResponse }
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
 * Der alte Dashboard/Journey-Vorschau-Toggle bleibt NUR im lokalen
 * Dev-Server (import.meta.env.DEV) über einen expliziten Link erreichbar,
 * damit man die Oberflächen weiterhin ohne Supabase-Login durchklicken kann
 * — echte Kunden sehen ihn nie.
 */
export default function App() {
  const [devPreview, setDevPreview] = useState(false);
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function resolveSession() {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;

      if (!accessToken) {
        if (!cancelled) setAuth({ status: "loggedOut" });
        return;
      }

      try {
        const session = await fetchTenantSession(API_BASE, accessToken);
        if (!cancelled) setAuth({ status: "loggedIn", session });
      } catch (err) {
        if (!cancelled) {
          setAuth({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    void resolveSession();

    const { data: subscription } = supabase.auth.onAuthStateChange(() => {
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

  if (import.meta.env.DEV && devPreview) {
    return <DevPreview onExit={() => setDevPreview(false)} />;
  }

  if (auth.status === "loading") {
    return <CenteredMessage>Lade…</CenteredMessage>;
  }

  if (auth.status === "loggedOut") {
    return (
      <>
        <LoginPage onLoggedIn={() => setAuth({ status: "loading" })} />
        {import.meta.env.DEV && (
          <button style={devLinkStyle} onClick={() => setDevPreview(true)}>
            Dev-Vorschau ohne Login
          </button>
        )}
      </>
    );
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

  const lockReason = tenantLockReason(auth.session);
  if (lockReason) {
    return <TrialLockedPage reason={lockReason} onLogout={handleLogout} />;
  }

  return (
    <div>
      <button style={logoutButtonStyle} onClick={handleLogout}>
        Abmelden
      </button>
      <DashboardPage
        tenantName={auth.session.tenant_name}
        defaultBaseUrl={API_BASE}
        defaultApiKey={auth.session.api_key}
        showConnectionPanel={false}
      />
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

const logoutButtonStyle: CSSProperties = {
  position: "fixed",
  top: 12,
  right: 12,
  zIndex: 50,
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