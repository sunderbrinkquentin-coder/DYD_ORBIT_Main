import { type ChangeEvent, type CSSProperties, useMemo, useRef, useState } from "react";
import {
  detectTenantBranding,
  resetTenantBranding,
  saveTenantBranding,
  type TenantBranding,
  type TenantBrandingSuggestion,
  tenantBrandingBaseUrl,
} from "../api/orbit";
import { buildBrandTheme, isHexColor } from "../data/brandTheme";

/**
 * "Dein Branding" (28.09.2026): Logo und Corporate-Farben fuer die Journey
 * festlegen — per Klick von der eigenen Website vorschlagen lassen, pruefen,
 * in der Live-Vorschau ansehen und speichern. Gespeichert wird serverseitig
 * (Edge Function "tenant-branding"); Journey und Dashboard laden es von dort.
 * Nichts wird ohne Klick auf "Speichern" uebernommen.
 */

const DYD_DEFAULT = { primary: "#2f8fd6", accent: "#5fdc99" };
/** Grenze fuer hochgeladene Logos (die Datenbank erlaubt ~400 KB Bild). */
const MAX_LOGO_DATA_URL = 540_000;
const MAX_LOGO_EDGE = 512;

interface Props {
  apiBase: string;
  apiKey: string;
  branding: TenantBranding | null;
  /** Vorbelegung fuer die Website-Adresse (z.B. aus der Kurssuche). */
  defaultWebsite: string;
  tenantName: string;
  onSaved: (branding: TenantBranding | null) => void;
  onClose: () => void;
}

/** Verkleinert Rasterbilder auf max. 512 px Kantenlaenge (PNG), damit das Logo in die Datenbank passt. */
function readLogoFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Logo konnte nicht gelesen werden."));
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) return reject(new Error("Logo konnte nicht gelesen werden."));
      if (file.type === "image/svg+xml") {
        if (dataUrl.length > MAX_LOGO_DATA_URL) return reject(new Error("Das SVG-Logo ist zu groß (max. ca. 400 KB)."));
        return resolve(dataUrl);
      }
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_LOGO_EDGE / Math.max(img.width, img.height));
        if (scale === 1 && dataUrl.length <= MAX_LOGO_DATA_URL) return resolve(dataUrl);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Logo konnte nicht verarbeitet werden."));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const out = canvas.toDataURL("image/png");
        if (out.length > MAX_LOGO_DATA_URL) return reject(new Error("Das Logo ist auch verkleinert noch zu groß. Bitte eine kleinere Datei wählen."));
        resolve(out);
      };
      img.onerror = () => reject(new Error("Die Datei ist kein lesbares Bild."));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function BrandingModal({ apiBase, apiKey, branding, defaultWebsite, tenantName, onSaved, onClose }: Props) {
  const base = tenantBrandingBaseUrl(apiBase);
  const [website, setWebsite] = useState(branding?.source_url ?? defaultWebsite);
  const [primary, setPrimary] = useState(branding?.primary_color ?? DYD_DEFAULT.primary);
  const [accent, setAccent] = useState<string>(branding?.accent_color ?? "");
  const [logo, setLogo] = useState<string | null>(branding?.logo_url ?? null);
  const [suggestion, setSuggestion] = useState<TenantBrandingSuggestion | null>(null);
  const [detectedFrom, setDetectedFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState<"detect" | "save" | "reset" | null>(null);
  const [status, setStatus] = useState<{ msg: string; kind: "ok" | "err" | "" }>({ msg: "", kind: "" });
  const fileRef = useRef<HTMLInputElement | null>(null);

  const theme = useMemo(
    () => buildBrandTheme(isHexColor(primary) ? { primary_color: primary, accent_color: isHexColor(accent) ? accent : null } : null),
    [primary, accent],
  );
  const previewStyle = theme.vars as CSSProperties;

  async function detect() {
    setBusy("detect");
    setStatus({ msg: "", kind: "" });
    try {
      const res = await detectTenantBranding(base, apiKey, website.trim() || null);
      setSuggestion(res.suggestion);
      setDetectedFrom(res.source_url);
      if (res.suggestion.primary_color) setPrimary(res.suggestion.primary_color);
      setAccent(res.suggestion.accent_color ?? "");
      if (res.suggestion.logo_url) setLogo(res.suggestion.logo_url.startsWith("https://") ? res.suggestion.logo_url : null);
      setStatus({
        msg: res.suggestion.primary_color
          ? "✓ Vorschlag übernommen – bitte prüfen und erst dann speichern."
          : "Auf der Seite wurde keine eindeutige Markenfarbe gefunden – bitte Farben selbst wählen.",
        kind: res.suggestion.primary_color ? "ok" : "err",
      });
    } catch (e) {
      setStatus({ msg: e instanceof Error ? e.message : String(e), kind: "err" });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!isHexColor(primary)) {
      setStatus({ msg: "Bitte eine Hauptfarbe wählen (z.B. #004b8d).", kind: "err" });
      return;
    }
    if (accent && !isHexColor(accent)) {
      setStatus({ msg: "Die Akzentfarbe muss ein Farbwert wie #f39200 sein – oder leer bleiben.", kind: "err" });
      return;
    }
    setBusy("save");
    setStatus({ msg: "", kind: "" });
    try {
      const res = await saveTenantBranding(base, apiKey, {
        primary_color: primary.toLowerCase(),
        accent_color: accent ? accent.toLowerCase() : null,
        logo_url: logo,
        source_url: detectedFrom ?? (website.trim() || null),
      });
      onSaved(res.branding);
      setStatus({ msg: "✓ Branding gespeichert – die Journey zeigt ab sofort deine Farben und dein Logo.", kind: "ok" });
    } catch (e) {
      setStatus({ msg: e instanceof Error ? e.message : String(e), kind: "err" });
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy("reset");
    setStatus({ msg: "", kind: "" });
    try {
      await resetTenantBranding(base, apiKey);
      onSaved(null);
      setPrimary(DYD_DEFAULT.primary);
      setAccent("");
      setLogo(null);
      setSuggestion(null);
      setStatus({ msg: "✓ Zurückgesetzt – die Journey nutzt wieder die DYD-Farben.", kind: "ok" });
    } catch (e) {
      setStatus({ msg: e instanceof Error ? e.message : String(e), kind: "err" });
    } finally {
      setBusy(null);
    }
  }

  async function onLogoFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) {
      setStatus({ msg: "Bitte ein Bild als PNG, JPG, WebP, GIF oder SVG wählen.", kind: "err" });
      return;
    }
    try {
      setLogo(await readLogoFile(file));
      setStatus({ msg: "✓ Logo geladen – mit „Speichern“ übernehmen.", kind: "ok" });
    } catch (err) {
      setStatus({ msg: err instanceof Error ? err.message : String(err), kind: "err" });
    }
  }

  const check = theme.check;

  return (
    <div className="lead-modal-overlay" onClick={onClose}>
      <div
        className="lead-modal branding-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Branding für die Journey"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="lead-modal-close" onClick={onClose} aria-label="Schließen">
          ✕
        </button>
        <div className="lead-modal-header">
          <div className="lead-modal-header-info">
            <div className="lead-modal-name">🎨 Dein Branding für die Journey</div>
            <div className="hint">
              Logo und Farben erscheinen in deiner Journey. „Powered by DYD ORBIT“ bleibt klein sichtbar.
            </div>
          </div>
        </div>

        <div className="branding-grid">
          <div className="branding-form">
            <section className="branding-section">
              <div className="branding-section-title">1 · Von deiner Website übernehmen</div>
              <div className="branding-detect-row">
                <input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://www.ihre-akademie.de"
                  aria-label="Adresse deiner Website"
                />
                <button type="button" className="btn-primary" onClick={detect} disabled={busy !== null}>
                  {busy === "detect" ? "Lese Website …" : "Farben & Logo erkennen"}
                </button>
              </div>
              {suggestion && (
                <ul className="branding-notes">
                  {suggestion.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="branding-section">
              <div className="branding-section-title">2 · Farben</div>
              <div className="branding-color-row">
                <label className="branding-color">
                  <span>Hauptfarbe</span>
                  <span className="branding-color-inputs">
                    <input type="color" value={isHexColor(primary) ? primary : DYD_DEFAULT.primary} onChange={(e) => setPrimary(e.target.value)} />
                    <input value={primary} onChange={(e) => setPrimary(e.target.value.trim())} aria-label="Hauptfarbe als Farbwert" />
                  </span>
                </label>
                <label className="branding-color">
                  <span>Akzentfarbe (optional)</span>
                  <span className="branding-color-inputs">
                    <input type="color" value={isHexColor(accent) ? accent : DYD_DEFAULT.accent} onChange={(e) => setAccent(e.target.value)} />
                    <input value={accent} placeholder="leer = aus Hauptfarbe" onChange={(e) => setAccent(e.target.value.trim())} aria-label="Akzentfarbe als Farbwert" />
                  </span>
                </label>
              </div>
              {suggestion && suggestion.palette.length > 1 && (
                <div className="branding-palette">
                  <span className="hint">Auf der Website gefunden:</span>
                  {suggestion.palette.map((c) => (
                    <span key={c} className="branding-swatch-group">
                      <span className="branding-swatch" style={{ background: c }} title={c} />
                      <button type="button" onClick={() => setPrimary(c)} className={primary === c ? "active" : ""}>
                        Haupt
                      </button>
                      <button type="button" onClick={() => setAccent(c)} className={accent === c ? "active" : ""}>
                        Akzent
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {check && (
                <div className={`branding-check ${check.adjusted ? "adjusted" : ""}`}>
                  {check.adjusted
                    ? "✓ Gut lesbar: Für Buttons und Links werden hellere bzw. dunklere Töne deiner Farben verwendet, damit alle Texte den Kontrast nach WCAG erreichen."
                    : "✓ Gut lesbar: Deine Farben erreichen den Kontrast nach WCAG ohne Anpassung."}
                </div>
              )}
            </section>

            <section className="branding-section">
              <div className="branding-section-title">3 · Logo</div>
              <div className="branding-logo-row">
                <div className="branding-logo-preview">{logo ? <img src={logo} alt="Logo-Vorschau" /> : <span>Kein Logo</span>}</div>
                <div className="branding-logo-actions">
                  <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
                    Logo hochladen
                  </button>
                  {logo && (
                    <button type="button" className="btn-ghost" onClick={() => setLogo(null)}>
                      Entfernen
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={onLogoFile} hidden />
                </div>
              </div>
              {suggestion && suggestion.logo_candidates.filter((u) => u.startsWith("https://")).length > 1 && (
                <div className="branding-logo-candidates">
                  <span className="hint">Weitere Bilder von der Website:</span>
                  {suggestion.logo_candidates
                    .filter((u) => u.startsWith("https://"))
                    .map((u) => (
                      <button key={u} type="button" className={`branding-logo-candidate ${logo === u ? "active" : ""}`} onClick={() => setLogo(u)} title={u}>
                        <img src={u} alt="" />
                      </button>
                    ))}
                </div>
              )}
            </section>
          </div>

          <aside className="branding-preview" style={previewStyle} aria-label="Vorschau der Journey">
            <div className="branding-preview-label">Vorschau</div>
            <div className="bp-widget">
              <div className="bp-top">
                {logo ? <img className="bp-logo" src={logo} alt="" /> : <span className="bp-logo-text">{tenantName}</span>}
                <span className="bp-powered">Powered by DYD ORBIT</span>
              </div>
              <div className="bp-eyebrow">Weiterbildungs-Finder</div>
              <div className="bp-title">Finde die Weiterbildung, die dich weiterbringt</div>
              <div className="bp-progress">
                <span />
              </div>
              <div className="bp-cards">
                <div className="bp-card selected">✓ In meinem Beruf weiterkommen</div>
                <div className="bp-card">Mich neu orientieren</div>
              </div>
              <div className="bp-chip">Passende Kurse</div>
              <a className="bp-link" href="#vorschau" onClick={(e) => e.preventDefault()}>
                Details & Anfrage ↓
              </a>
              <button type="button" className="bp-cta" tabIndex={-1}>
                Förderung & Starttermin prüfen lassen →
              </button>
            </div>
          </aside>
        </div>

        {status.msg && (
          <div className={status.kind === "err" ? "hint warn" : "hint"} role="status">
            {status.msg}
          </div>
        )}
        <div className="course-form-actions">
          <button className="btn-primary" type="button" onClick={save} disabled={busy !== null}>
            {busy === "save" ? "Speichere …" : "Speichern"}
          </button>
          {branding && (
            <button type="button" className="btn-ghost" onClick={reset} disabled={busy !== null}>
              {busy === "reset" ? "Setze zurück …" : "Auf DYD-Farben zurücksetzen"}
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}