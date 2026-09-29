import { useState, type CSSProperties, type FormEvent } from "react";
import { supabase } from "../lib/supabaseClient";

interface LoginPageProps {
  /** Wird nach erfolgreichem Login aufgerufen (App.tsx löst danach die Tenant-Session auf). */
  onLoggedIn: () => void;
}

// Deine Pricing-/Signup-Seite auf der Marketing-Website (siehe
// TrialSignupForm.tsx dort, Schritt 5). In Bolt unter "Umgebungsvariablen"
// setzen: VITE_MARKETING_SIGNUP_URL=https://DEINE-WEBSITE.de/preise
const SIGNUP_URL =
  (import.meta.env.VITE_MARKETING_SIGNUP_URL as string | undefined) ?? "https://DEINE-WEBSITE.de/preise";

type Mode = "login" | "forgot" | "forgotSent";

/**
 * NEU (Schritt 7, Auth-Flow): echter E-Mail+Passwort-Login (Supabase Auth) —
 * ersetzt das bisherige "API-Key manuell eintragen"-Panel für echte Kunden.
 * Konten entstehen ausschließlich über den Signup auf der Website (Schritt
 * 3/5) — hier gibt es bewusst KEIN Registrierungsformular.
 *
 * GEÄNDERT (Bugfix): ohne jeden Hinweis landen neue Interessenten, die
 * direkt auf ORBIT statt auf der Website landen, hier in einer Sackgasse
 * ("wo melde ich mich an?"). Deshalb jetzt ein Link zur Website-Pricing-
 * Seite unterhalb des Formulars.
 *
 * NEU (Task #8, Passwort vergessen): "mode" schaltet zwischen Login- und
 * einem eingebetteten "Passwort vergessen"-Formular um, statt eine eigene
 * Route/Seite zu brauchen. resetPasswordForEmail() schickt einen Link, der
 * die Person zurück in die App bringt (redirectTo = aktuelle App-URL) —
 * App.tsx faengt das dortige "PASSWORD_RECOVERY"-Auth-Event ab und zeigt
 * dann ResetPasswordPage, um ein neues Passwort zu setzen.
 *
 * WICHTIG: die Ziel-URL (redirectTo) muss in Supabase unter
 * Authentication -> URL Configuration -> Redirect URLs eingetragen sein,
 * sonst lehnt Supabase den Link ab bzw. leitet auf die Default-URL um.
 */
export function LoginPage({ onLoggedIn }: LoginPageProps) {
  const [mode, setMode] = useState<Mode>("login");
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

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + window.location.pathname,
    });

    setSubmitting(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setMode("forgotSent");
  }

  if (mode === "forgot" || mode === "forgotSent") {
    return (
      <div style={styles.page}>
        <form onSubmit={handleForgotSubmit} style={styles.card}>
          <div style={styles.brand}>DYD ORBIT</div>
          <h1 style={styles.heading}>Passwort vergessen</h1>

          {mode === "forgotSent" ? (
            <p style={styles.subheading}>
              Falls für <strong>{email.trim()}</strong> ein Konto existiert, haben wir dir gerade
              einen Link zum Zurücksetzen deines Passworts geschickt. Prüfe dein Postfach (ggf.
              auch den Spam-Ordner).
            </p>
          ) : (
            <>
              <p style={styles.subheading}>
                Gib deine E-Mail-Adresse ein — wir schicken dir einen Link zum Zurücksetzen deines
                Passworts.
              </p>

              <label style={styles.label} htmlFor="orbit-forgot-email">
                E-Mail
              </label>
              <input
                id="orbit-forgot-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={styles.input}
              />

              {error && <div style={styles.error}>{error}</div>}

              <button type="submit" disabled={submitting} style={styles.submit}>
                {submitting ? "Wird gesendet…" : "Link senden"}
              </button>
            </>
          )}

          <p style={styles.signupHint}>
            <button
              type="button"
              style={styles.linkButton}
              onClick={() => {
                setMode("login");
                setError(null);
              }}
            >
              ← Zurück zum Login
            </button>
          </p>
        </form>
      </div>
    );
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

        <p style={styles.forgotRow}>
          <button
            type="button"
            style={styles.linkButton}
            onClick={() => {
              setMode("forgot");
              setError(null);
            }}
          >
            Passwort vergessen?
          </button>
        </p>

        {error && <div style={styles.error}>{error}</div>}

        <button type="submit" disabled={submitting} style={styles.submit}>
          {submitting ? "Anmelden…" : "Anmelden"}
        </button>

        <p style={styles.signupHint}>
          Noch kein Konto?{" "}
          <a href={SIGNUP_URL} style={styles.signupLink}>
            Jetzt 7 Tage kostenlos testen
          </a>
        </p>
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
  forgotRow: {
    margin: "10px 0 0",
    textAlign: "right",
  },
  linkButton: {
    background: "none",
    border: "none",
    padding: 0,
    color: "#2f8fd6",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    textDecoration: "underline",
  },
  signupHint: {
    marginTop: 18,
    marginBottom: 0,
    fontSize: 13,
    color: "#5b6779",
    textAlign: "center",
  },
  signupLink: {
    color: "#2f8fd6",
    fontWeight: 700,
    textDecoration: "none",
  },
};