import type { CSSProperties } from "react";

interface TrialLockedPageProps {
  reason: "trial_expired" | "tenant_inactive";
  onLogout: () => void;
}

// TODO: durch die echte Preise-/Upgrade-Seite auf deiner Website ersetzen,
// sobald Schritt 5 (Website-Anbindung) steht.
const UPGRADE_URL = "https://DEINE-WEBSITE.de/preise";

/**
 * NEU (Schritt 7, Auth-Flow): Sperrbildschirm anstelle des Dashboards, wenn
 * die Tenant-Session (siehe App.tsx/session.ts) einen abgelaufenen Trial
 * oder ein inaktives Abo meldet. Entscheidung aus Schritt "Team-Fragen":
 * Trial-Ablauf sperrt Dashboard UND Journey komplett — die serverseitige
 * Durchsetzung passiert unabhängig davon in orbit-api.ts
 * (enforceTenantActive, Schritt 2); dieser Bildschirm ist nur die
 * clientseitige Entsprechung, damit Kunden nicht auf einem kaputt
 * wirkenden, halb ladenden Dashboard landen.
 */
export function TrialLockedPage({ reason, onLogout }: TrialLockedPageProps) {
  const message =
    reason === "tenant_inactive"
      ? "Dein Abonnement ist aktuell nicht aktiv. Bitte prüfe deine Zahlungsdaten oder reaktiviere deinen Plan."
      : "Deine Testphase ist abgelaufen. Wähle einen Plan, um weiter auf dein Dashboard zuzugreifen.";

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brand}>DYD ORBIT</div>
        <h1 style={styles.heading}>Zugriff gesperrt</h1>
        <p style={styles.text}>{message}</p>
        <a href={UPGRADE_URL} style={styles.cta}>
          Jetzt Plan wählen
        </a>
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
    maxWidth: 400,
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
  cta: {
    display: "inline-block",
    width: "100%",
    boxSizing: "border-box",
    textDecoration: "none",
    border: "none",
    borderRadius: 8,
    padding: "11px 14px",
    fontSize: 14,
    fontWeight: 700,
    fontFamily: "inherit",
    background: "linear-gradient(90deg, #8fecb4, #2f8fd6)",
    color: "#0c1c34",
  },
  logout: {
    marginTop: 14,
    background: "none",
    border: "none",
    color: "#5b6779",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    textDecoration: "underline",
  },
};