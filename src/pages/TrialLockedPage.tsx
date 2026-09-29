import type { CSSProperties } from "react";
import { PlanPicker } from "../components/PlanPicker";

interface TrialLockedPageProps {
  reason: "trial_expired" | "tenant_inactive";
  apiBase: string;
  apiKey: string;
  /** NEU (Billing Portal): nur gesetzt bei reason "tenant_inactive" - ein
   *  past_due/canceled-Tenant hat evtl. schon ein bestehendes Stripe-Abo,
   *  das sich per Kundenportal reparieren (Zahlungsmittel aktualisieren)
   *  bzw. einsehen laesst, statt per Checkout ein zweites Abo anzulegen.
   *  undefined bei "trial_expired", weil dort typischerweise noch gar kein
   *  Stripe-Kunde existiert (siehe App.tsx). */
  onManageBilling?: () => void;
  portalLoading?: boolean;
  portalError?: string | null;
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
 *
 * GEÄNDERT (Billing Portal, Review-Runde): bei "tenant_inactive" (Zahlung
 * fehlgeschlagen ODER gekündigt) zusätzlich ein "Zahlungsdaten
 * aktualisieren"-Button VOR dem PlanPicker - ein bestehendes, nur wegen
 * fehlgeschlagener Zahlung gesperrtes Abo sollte repariert statt durch ein
 * zweites, per Checkout neu angelegtes Abo ersetzt werden.
 */
export function TrialLockedPage({
  reason,
  apiBase,
  apiKey,
  onManageBilling,
  portalLoading,
  portalError,
  onLogout,
}: TrialLockedPageProps) {
  const message =
    reason === "tenant_inactive"
      ? "Dein Abonnement ist aktuell nicht aktiv. Aktualisiere deine Zahlungsdaten oder wähle unten einen neuen Plan."
      : "Deine Testphase ist abgelaufen. Wähle einen Plan, um weiter auf dein Dashboard zuzugreifen.";

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brand}>DYD ORBIT</div>
        <h1 style={styles.heading}>Zugriff gesperrt</h1>
        <p style={styles.text}>{message}</p>

        {reason === "tenant_inactive" && onManageBilling && (
          <div style={styles.portalBox}>
            <p style={styles.portalText}>
              Falls dein bestehendes Abo nur wegen einer fehlgeschlagenen Zahlung gesperrt ist,
              kannst du hier direkt deine Zahlungsdaten aktualisieren:
            </p>
            <button style={styles.portalButton} disabled={portalLoading} onClick={onManageBilling}>
              {portalLoading ? "Wird geöffnet…" : "Zahlungsdaten aktualisieren"}
            </button>
            {portalError && <div style={styles.portalError}>{portalError}</div>}
            <p style={styles.portalOr}>oder wähle unten einen neuen Plan:</p>
          </div>
        )}

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
  portalBox: {
    border: "1px solid #e6eaf2",
    borderRadius: 12,
    padding: "16px 18px",
    marginBottom: 24,
    background: "#fafbfd",
  },
  portalText: {
    margin: "0 0 12px",
    fontSize: 13,
    lineHeight: 1.5,
    color: "#5b6779",
  },
  portalButton: {
    border: "none",
    borderRadius: 8,
    padding: "10px 16px",
    fontSize: 13.5,
    fontWeight: 700,
    fontFamily: "inherit",
    cursor: "pointer",
    background: "#0c1c34",
    color: "#fff",
  },
  portalError: {
    marginTop: 10,
    fontSize: 12.5,
    color: "#c0392b",
    background: "#fdecea",
    border: "1px solid #f5c6c0",
    borderRadius: 8,
    padding: "8px 10px",
  },
  portalOr: {
    margin: "14px 0 0",
    fontSize: 12.5,
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