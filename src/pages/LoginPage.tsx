import { useState, type CSSProperties, type FormEvent } from "react";
import { supabase } from "../lib/supabaseClient";

interface LoginPageProps {
  /** Wird nach erfolgreichem Login aufgerufen (App.tsx löst danach die Tenant-Session auf). */
  onLoggedIn: () => void;
}

/**
 * NEU (Schritt 7, Auth-Flow): echter E-Mail+Passwort-Login (Supabase Auth) —
 * ersetzt das bisherige "API-Key manuell eintragen"-Panel für echte Kunden.
 * Konten entstehen ausschließlich über den Signup auf der Website (Schritt
 * 3/5) — hier gibt es bewusst KEIN Registrierungsformular.
 */
export function LoginPage({ onLoggedIn }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setSubmitting(false);

    if (signInError) {
      setError(
        /invalid.*credentials/i.test(signInError.message)
          ? "E-Mail oder Passwort ist falsch."
          : signInError.message
      );
      return;
    }

    onLoggedIn();
  }

  return (
    <div style={styles.page}>
      <form onSubmit={handleSubmit} style={styles.card}>
        <div style={styles.brand}>DYD ORBIT</div>
        <h1 style={styles.heading}>Anmelden</h1>
        <p style={styles.subheading}>Melde dich mit deinem Bildungsträger-Konto an.</p>

        <label style={styles.label} htmlFor="orbit-login-email">
          E-Mail
        </label>
        <input
          id="orbit-login-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={styles.input}
        />

        <label style={styles.label} htmlFor="orbit-login-password">
          Passwort
        </label>
        <input
          id="orbit-login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
        />

        {error && <div style={styles.error}>{error}</div>}

        <button type="submit" disabled={submitting} style={styles.submit}>
          {submitting ? "Anmelden…" : "Anmelden"}
        </button>
      </form>
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