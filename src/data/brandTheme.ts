/**
 * Corporate-Farben fuer die Journey (28.09.2026).
 *
 * Die Journey nutzt die DYD-Farbvariablen aus theme.css (--dyd-blue,
 * --dyd-mint ...). brandThemeVars() berechnet aus Haupt- und Akzentfarbe
 * eines Bildungstraegers Ersatzwerte fuer genau diese Variablen — gesetzt auf
 * dem Journey-Container ueberschreiben sie die DYD-Farben nur dort.
 *
 * Lesbarkeit geht vor Farbtreue (WCAG 2.1):
 *  - Buttons/Verlaeufe tragen in der Journey dunkle Schrift (--dyd-navy).
 *    Ist eine Markenfarbe dafuer zu dunkel, wird sie so weit aufgehellt,
 *    bis der Kontrast mind. 4,5:1 erreicht.
 *  - Links/Textakzente (--dyd-blue-dark) werden so weit abgedunkelt, bis sie
 *    auf Weiss mind. 4,5:1 erreichen.
 * Der Farbton bleibt dabei erhalten; nur die Helligkeit wird angepasst.
 */

export interface BrandColors {
  primary_color: string;
  accent_color?: string | null;
}

const NAVY = "#0c1c34";
const WHITE = "#ffffff";

export function isHexColor(v: string | null | undefined): v is string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim());
}

function rgb(hex: string): [number, number, number] {
  const h = hex.trim().toLowerCase();
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function hex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Relative Leuchtdichte nach WCAG 2.1. */
export function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrastverhaeltnis nach WCAG 2.1 (1 bis 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mischt color mit target (0 = color, 1 = target). */
export function mix(color: string, target: string, amount: number): string {
  const a = rgb(color);
  const b = rgb(target);
  return hex([a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount]);
}

/** Hellt color in kleinen Schritten auf, bis Text in textColor darauf mind. minRatio erreicht. */
export function lightenForText(color: string, textColor: string, minRatio = 4.5): string {
  let c = color;
  for (let i = 1; i <= 20 && contrastRatio(c, textColor) < minRatio; i++) c = mix(color, WHITE, i * 0.05);
  return c;
}

/** Dunkelt color ab, bis sie als Textfarbe auf background mind. minRatio erreicht. */
export function darkenForText(color: string, background: string, minRatio = 4.5): string {
  let c = color;
  for (let i = 1; i <= 20 && contrastRatio(c, background) < minRatio; i++) c = mix(color, "#000000", i * 0.05);
  return c;
}

/** Bessere Schriftfarbe (Dunkelblau oder Weiss) auf einer Flaeche. */
export function readableTextOn(background: string): string {
  return contrastRatio(background, NAVY) >= contrastRatio(background, WHITE) ? NAVY : WHITE;
}

export interface BrandThemeCheck {
  /** Kontrast dunkler Schrift auf dem Button-Verlauf (schlechteres Ende). */
  buttonContrast: number;
  /** Kontrast der Link-/Akzentschrift auf Weiss. */
  linkContrast: number;
  /** Wurden Farben fuer die Lesbarkeit angepasst? */
  adjusted: boolean;
}

/**
 * CSS-Variablen fuer den Journey-Container. Ohne gueltige Hauptfarbe: leeres
 * Objekt (= DYD-Standardfarben bleiben).
 */
export function brandThemeVars(brand: BrandColors | null | undefined): Record<string, string> {
  return buildBrandTheme(brand).vars;
}

export function buildBrandTheme(brand: BrandColors | null | undefined): { vars: Record<string, string>; check: BrandThemeCheck | null } {
  if (!brand || !isHexColor(brand.primary_color)) return { vars: {}, check: null };
  const primary = brand.primary_color.toLowerCase();
  // Ohne Akzentfarbe: helle Variante der Hauptfarbe als zweiter Verlaufston.
  const accent = isHexColor(brand.accent_color) ? brand.accent_color.toLowerCase() : mix(primary, WHITE, 0.45);
  const blue = lightenForText(primary, NAVY);
  const mint2 = lightenForText(accent, NAVY);
  const mint = lightenForText(mix(accent, WHITE, 0.25), NAVY);
  const blueDark = darkenForText(primary, WHITE);
  const vars: Record<string, string> = {
    "--dyd-blue": blue,
    "--dyd-blue-dark": blueDark,
    "--dyd-mint": mint,
    "--dyd-mint-2": mint2,
    "--dyd-brand-green": mint2,
    "--blue-bg": mix(primary, WHITE, 0.9),
    "--blue-border": mix(primary, WHITE, 0.75),
    // RGB-Kanaele fuer die rgba()-Toene in journey.css (Schatten, Tints).
    "--dyd-blue-rgb": rgb(blue).join(", "),
    "--dyd-mint-rgb": rgb(mint).join(", "),
    "--dyd-mint-2-rgb": rgb(mint2).join(", "),
  };
  const check: BrandThemeCheck = {
    buttonContrast: Math.min(contrastRatio(blue, NAVY), contrastRatio(mint, NAVY), contrastRatio(mint2, NAVY)),
    linkContrast: contrastRatio(blueDark, WHITE),
    adjusted: blue !== primary || blueDark !== primary || mint2 !== accent,
  };
  return { vars, check };
}