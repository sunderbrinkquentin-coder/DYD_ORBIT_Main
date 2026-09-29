import { useState, type CSSProperties, type FormEvent } from "react";
import { supabase } from "../lib/supabaseClient";

interface ResetPasswordPageProps {
  /** Wird nach erfolgreich gesetztem neuem Passwort aufgerufen (App.tsx
   *  löst danach wie gewohnt die Tenant-Session auf). */
  onPasswordUpdated: () => void;
}

const MIN_PASSWORD_LENGTH = 8;

/**
 * NEU (Task #8, Passwort vergessen): wird von App.tsx angezeigt, sobald
 * Supabase beim Zurückkommen über den Reset-Link das Auth-Event
 * "PASSWORD_RECOVERY" meldet — die Person hat zu diesem Zeitpunkt bereits
 * eine gültige (Recovery-)Session, aber noch kein neues Passwort gesetzt.
 * Erst nach erfolgreichem supabase.auth.updateUser({ password }) geht es
 * regulär weiter ins Dashboard (bzw. auf den Sperrbildschirm, je nach
 * Tenant-Status) — siehe App.tsx.
 */
export function ResetPasswordPage({ onPasswordUpdated }: ResetPasswordPageProps) {
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`);
      return;
    }
    if (password !== passwordConfirm) {
      setError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setDone(true);
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brand}>DYD ORBIT</div>
        <h1 style={styles.heading}>Neues Passwort festlegen</h1>

        {done ? (
          <>
            <p style={styles.subheading}>Dein Passwort wurde geändert.</p>
            <button style={styles.submit} onClick={onPasswordUpdated}>
              Weiter
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <p style={styles.subheading}>Vergib ein neues Passwort für dein Konto.</p>

            <label style={styles.label} htmlFor="orbit-reset-password">
              Neues Passwort
            </label>
            <input
              id="orbit-reset-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
            />

            <label style={styles.label} htmlFor="orbit-reset-password-confirm">
              Neues Passwort bestätigen
            </label>
            <input
              id="orbit-reset-password-confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              style={styles.input}
            />

            {error && <div style={styles.error}>{error}</div>}

            <button type="submit" disabled={submitting} style={styles.submit}>
              {submitting ? "Wird gespeichert…" : "Passwort speichern"}
            </button>
          </form>
        )}
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
    maxWidth: 360,
    background: "#fff",
    border: "1px solid #e6eaf2",
    borderRadius: 16,
    padding: "32px 28px",
    boxShadow: "0 8px 24px rgba(15,27,45,.08)",
  },
  brand: {
    fontSize: 12.5,
    fontWeight: 700,
    letterSpacing: 1.5,
    color: "#2f8fd6",
    marginBottom: 6,
  },
  heading: {
    margin: "0 0 4px",
    fontSize: 22,
    color: "#0c1c34",
  },
  subheading: {
    margin: "0 0 20px",
    fontSize: 13.5,
    color: "#5b6779",
    lineHeight: 1.5,
  },
  label: {
    display: "block",
    fontSize: 12.5,
    fontWeight: 600,
    color: "#5b6779",
    marginBottom: 6,
    marginTop: 14,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    fontSize: 14,
    border: "1px solid #dfe4ee",
    borderRadius: 8,
    fontFamily: "inherit",
  },
  error: {
    marginTop: 14,
    fontSize: 13,
    color: "#c0392b",
    background: "#fdecea",
    border: "1px solid #f5c6c0",
    borderRadius: 8,
    padding: "8px 10px",
  },
  submit: {
    width: "100%",
    marginTop: 22,
    border: "none",
    borderRadius: 8,
    padding: "11px 14px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    background: "linear-gradient(90deg, #8fecb4, #2f8fd6)",
    color: "#0c1c34",
  },
};