"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import {
  signupTrialTenant,
  validateTrialSignupInput,
  TrialSignupError,
  type TrialSignupResult,
} from "../lib/orbitSignup";

// Basis-URL deiner ORBIT-API, z.B.
// https://<DEIN-PROJECT-REF>.supabase.co/functions/v1/api
// KORREKTUR: dies ist eine Vite-App (kein Next.js) - "process" existiert im
// Browser-Bundle nicht (siehe gleicher Fund/Fix bei DirectPurchaseForm.tsx im
// Website-Projekt). Echte Env-Vars kommen ausschliesslich ueber
// import.meta.env.VITE_* rein.
const API_BASE = (import.meta.env.VITE_ORBIT_API_BASE as string | undefined) ?? "";

// Wohin nach erfolgreicher Registrierung verlinkt wird, damit die Person
// sich direkt bei ORBIT einloggen kann (E-Mail+Passwort, die sie gerade
// hier vergeben hat). Passe das auf deine echte ORBIT-App-URL an.
const ORBIT_APP_URL =
  (import.meta.env.VITE_ORBIT_APP_URL as string | undefined) ?? "https://app.DEINE-DOMAIN.de";

interface TrialSignupFormProps {
  /** Optional: welcher Plan-Card-Klick das Formular geöffnet hat, nur für
   *  Tracking/Analytics gedacht - der Trial selbst startet immer gleich
   *  (7 Tage, 20 Kurse demo-Limit), die eigentliche Plan-Wahl passiert
   *  erst später eingeloggt in ORBIT (siehe PlanPicker.tsx dort). */
  sourcePlan?: "starter" | "growth" | "professional";
  onClose?: () => void;
}

/**
 * NEU (Schritt 5, Website-Anbindung): Trial-Signup-Formular für die
 * Pricing-Seite der Marketing-Website. Ruft direkt (kein eigener
 * Server-Proxy nötig, CORS ist auf der Edge Function offen) POST
 * /api/v1/signup auf und legt so einen neuen 7-Tage-Trial-Tenant an.
 *
 * WICHTIG (Architektur-Entscheidung, siehe Chat): hier gibt es bewusst
 * KEINE Plan-Auswahl und KEINEN Stripe-Checkout - das passiert
 * ausschließlich eingeloggt in ORBIT selbst. Diese Seite/Form ist nur der
 * Trial-Einstieg; danach wird auf den ORBIT-Login verwiesen.
 */
export function TrialSignupForm({ sourcePlan, onClose }: TrialSignupFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<TrialSignupResult | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    const validationError = validateTrialSignupInput({ email, password, companyName, contactName });
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    if (!API_BASE) {
      setErrorMessage(
        "Die Registrierung ist aktuell nicht verfügbar (VITE_ORBIT_API_BASE fehlt)."
      );
      return;
    }

    setSubmitting(true);
    try {
      const signupResult = await signupTrialTenant(API_BASE, { email, password, companyName, contactName });
      setResult(signupResult);
    } catch (err) {
      if (err instanceof TrialSignupError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("Die Registrierung ist fehlgeschlagen. Bitte später erneut versuchen.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div style={styles.wrap}>
        <h2 style={styles.heading}>Willkommen bei DYD ORBIT 🎉</h2>
        <p style={styles.text}>
          Dein 7-tägiger Testzeitraum für <strong>{result.tenant_name}</strong> läuft bis{" "}
          {new Date(result.trial_ends_at).toLocaleDateString("de-DE")}. Logg dich jetzt mit
          deiner E-Mail-Adresse und deinem Passwort bei ORBIT ein, um loszulegen.
        </p>
        <a style={styles.cta} href={ORBIT_APP_URL}>
          Jetzt bei ORBIT einloggen
        </a>
      </div>
    );
  }

  return (
    <form style={styles.wrap} onSubmit={handleSubmit}>
      <h2 style={styles.heading}>7 Tage kostenlos testen</h2>
      <p style={styles.text}>
        Kein Zahlungsmittel nötig. Nach der Registrierung loggst du dich direkt bei ORBIT ein.
      </p>

      <label style={styles.label}>
        Ihr Name
        <input
          style={styles.input}
          type="text"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          placeholder="z.B. Anna Beispiel"
          autoComplete="name"
          required
        />
      </label>

      <label style={styles.label}>
        Firmen-/Bildungsträger-Name
        <input
          style={styles.input}
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="z.B. Musterakademie GmbH"
          autoComplete="organization"
          required
        />
      </label>

      <label style={styles.label}>
        E-Mail-Adresse
        <input
          style={styles.input}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="du@firma.de"
          autoComplete="email"
          required
        />
      </label>

      <label style={styles.label}>
        Passwort
        <input
          style={styles.input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="mind. 8 Zeichen"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </label>

      {errorMessage && <p style={styles.errorText}>{errorMessage}</p>}

      <button type="submit" style={{ ...styles.cta, ...(submitting ? styles.ctaDisabled : {}) }} disabled={submitting}>
        {submitting ? "Wird angelegt…" : "Kostenlos starten"}
      </button>

      {onClose && (
        <button type="button" style={styles.closeButton} onClick={onClose}>
          Abbrechen
        </button>
      )}

      {sourcePlan && <input type="hidden" name="source_plan" value={sourcePlan} />}
    </form>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    width: "100%",
    maxWidth: 420,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  heading: {
    margin: "0 0 4px",
    fontSize: 20,
    color: "#0c1c34",
  },
  text: {
    margin: "0 0 8px",
    fontSize: 13.5,
    lineHeight: 1.5,
    color: "#5b6779",
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    color: "#0c1c34",
  },
  input: {
    border: "1px solid #e6eaf2",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 14,
    fontFamily: "inherit",
    fontWeight: 400,
  },
  errorText: {
    color: "#c23b3b",
    fontSize: 13,
    margin: 0,
  },
  cta: {
    display: "inline-block",
    textAlign: "center",
    textDecoration: "none",
    border: "none",
    borderRadius: 8,
    padding: "12px 16px",
    fontSize: 14,
    fontWeight: 700,
    fontFamily: "inherit",
    cursor: "pointer",
    background: "linear-gradient(90deg, #8fecb4, #2f8fd6)",
    color: "#0c1c34",
    marginTop: 4,
  },
  ctaDisabled: {
    opacity: 0.6,
    cursor: "default",
  },
  closeButton: {
    background: "none",
    border: "none",
    color: "#5b6779",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    textDecoration: "underline",
  },
};