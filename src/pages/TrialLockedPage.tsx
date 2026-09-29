import type { CSSProperties } from "react";
import { PlanPicker } from "../components/PlanPicker";

interface TrialLockedPageProps {
  reason: "trial_expired" | "tenant_inactive";
  apiBase: string;
  apiKey: string;
  onLogout: () => void;
}

/**
 * NEU (Schritt 7, Auth-Flow): Sperrbildschirm anstelle des Dashboards, wenn
 * die Tenant-Session (siehe App.tsx/session.ts) einen abgelaufenen Trial
 * oder ein inaktives Abo meldet. Entscheidung aus Schritt "Team-Fragen":
 * Trial-Ablauf sperrt Dashboard UND Journey komplett — die serverseitige
 * Durchsetzung passiert unabhängig davon in orbit-api.ts
 * (enforceTenantActive, Schritt 2); dieser Bildschirm ist nur die
 * clientseitige Entsprechung, damit Kunden nicht auf einem kaputt
 * wirkenden, halb ladenden Dashboard landen.
 *
 * GEÄNDERT (Schritt 4, Upgrade-Flow): der frühere statische Link zur
 * externen Preise-Seite ist ersetzt durch den PlanPicker direkt hier im
 * Sperrbildschirm (Team-Entscheidung: "Im ORBIT-Dashboard/Sperrbildschirm"),
 * weil nur ORBIT bereits den X-API-Key aus der Tenant-Session kennt, den
 * der Checkout-Aufruf braucht — die externe Website hat ihn nicht.
 */
export function TrialLockedPage({ reason, apiBase, apiKey, onLogout }: TrialLockedPageProps) {
  const message =
    reason === "tenant_inactive"
      ? "Dein Abonnement ist aktuell nicht aktiv. Bitte prüfe deine Zahlungsdaten oder wähle unten erneut einen Plan."
      : "Deine Testphase ist abgelaufen. Wähle einen Plan, um weiter auf dein Dashboard zuzugreifen.";

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brand}>DYD ORBIT</div>
        <h1 style={styles.heading}>Zugriff gesperrt</h1>
        <p style={styles.text}>{message}</p>

        <PlanPicker apiBase={apiBase} apiKey={apiKey} />

        <button onClick={onLogout} style={styles.logout}>
          Abmelden
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f4f6fb",
    fontFamily: "'Inter', system-ui, sans-serif",
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 720,
    background: "#fff",
    border: "1px solid #e6eaf2",
    borderRadius: 16,
    padding: "32px 28px",
    boxShadow: "0 8px 24px rgba(15,27,45,.08)",
    textAlign: "center",
  },
  brand: {
    fontSize: 12.5,
    fontWeight: 700,
    letterSpacing: 1.5,
    color: "#2f8fd6",
    marginBottom: 6,
  },
  heading: {
    margin: "0 0 10px",
    fontSize: 22,
    color: "#0c1c34",
  },
  text: {
    margin: "0 0 22px",
    fontSize: 14,
    lineHeight: 1.5,
    color: "#5b6779",
  },
  logout: {
    marginTop: 22,
    background: "none",
    border: "none",
    color: "#5b6779",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    textDecoration: "underline",
  },
};