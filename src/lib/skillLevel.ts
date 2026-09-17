/**
 * Lokale, deterministische Heuristik fuer ein Erfahrungslevel je Skill —
 * OHNE Netzwerk-Call, laeuft sofort im Browser. Liefert immer nur einen
 * VORSCHLAG (siehe ExperienceLevel in api/core.ts): in der UI bleibt jedes
 * Level frei per Klick veraenderbar, das hier ersetzt keine menschliche
 * Pruefung.
 *
 * Bewusst kein LLM-Call an dieser Stelle (anders als die optionale
 * KI-Verfeinerung, siehe fetchSkillLevelDetect in api/orbit.ts): diese
 * Heuristik soll ohne Backend-Aenderung sofort nutzbar sein, sobald eine
 * Kursbeschreibung vorliegt. Sie ist entsprechend simpel gehalten (Jahres-
 * Angaben + Signalwoerter) und macht keinen Anspruch auf inhaltliche
 * Praezision — "keine erfundenen Zahlen/Fakten": wo kein Hinweis im Text
 * steht, wird das offen als Standardannahme ausgewiesen statt eine
 * Scheingenauigkeit vorzutaeuschen.
 */

import type { ExperienceLevel } from "../api/core";

export interface ExperienceLevelGuess {
  level: ExperienceLevel;
  /** Kurzer, für Mitarbeiter lesbarer Grund — z.B. für ein Tooltip. */
  reason: string;
  /** true, wenn ein Fundort für den Skill im Text vorlag (sonst wurde der
   *  gesamte Text durchsucht, weniger verlässlich). */
  foundContext: boolean;
}

const YEARS_PATTERN = /(\d+)\s*\+?\s*jahr/i;

// Reihenfolge wichtig: spezifischere/eindeutigere Signalwoerter zuerst.
const EXPERT_WORDS =
  /\b(experte|expertin|profi|professionell|zertifiziert|spezialist|spezialistin|meisterklasse|senior|advanced|sehr erfahren)\b/i;
const ADVANCED_WORDS = /\b(fortgeschritten|aufbau(kurs)?|vertiefend|vertiefung|weiterführend|intermediate)\b/i;
const BASIC_WORDS =
  /\b(grundlagen|grundkurs|einsteiger|einstieg|basics?|einführung|anfänger|erste schritte|kompaktkurs)\b/i;

/** Schneidet ein Textfenster um die erste Fundstelle von `needle` in `haystack`
 *  aus (Gross-/Kleinschreibung egal) — damit die Heuristik nicht durch
 *  Signalwoerter an ganz anderer Stelle im Text (z.B. zu einem anderen
 *  Skill) in die Irre geführt wird. Ohne Fundstelle: null. */
function contextWindow(haystack: string, needle: string, radius = 80): string | null {
  const n = needle.trim();
  if (!n) return null;
  const idx = haystack.toLowerCase().indexOf(n.toLowerCase());
  if (idx < 0) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(haystack.length, idx + n.length + radius);
  return haystack.slice(start, end);
}

/**
 * Ermittelt ein Erfahrungslevel fuer EINEN Skill aus dem Gesamttext (z.B.
 * eine Kursbeschreibung). `matchedOn`/`preferredLabel` kommen direkt aus dem
 * MatchedSkill-Treffer (siehe fetchSkillMatch) und dienen nur dazu, im Text
 * die richtige Stelle wiederzufinden.
 */
export function guessExperienceLevel(fullText: string, matchedOn: string, preferredLabel: string): ExperienceLevelGuess {
  const window = contextWindow(fullText, matchedOn) ?? contextWindow(fullText, preferredLabel);
  const scope = window ?? fullText;
  const foundContext = window !== null;

  const yearsMatch = scope.match(YEARS_PATTERN);
  if (yearsMatch) {
    const years = parseInt(yearsMatch[1], 10);
    if (Number.isFinite(years)) {
      if (years >= 3) {
        return { level: "experte", reason: `„${yearsMatch[0].trim()}" im Text erkannt`, foundContext };
      }
      if (years >= 1) {
        return { level: "fortgeschritten", reason: `„${yearsMatch[0].trim()}" im Text erkannt`, foundContext };
      }
    }
  }

  if (EXPERT_WORDS.test(scope)) {
    const hit = scope.match(EXPERT_WORDS)?.[0] ?? "";
    return { level: "experte", reason: `Signalwort „${hit}" im Text erkannt`, foundContext };
  }
  if (BASIC_WORDS.test(scope)) {
    const hit = scope.match(BASIC_WORDS)?.[0] ?? "";
    return { level: "grundkenntnisse", reason: `Signalwort „${hit}" im Text erkannt`, foundContext };
  }
  if (ADVANCED_WORDS.test(scope)) {
    const hit = scope.match(ADVANCED_WORDS)?.[0] ?? "";
    return { level: "fortgeschritten", reason: `Signalwort „${hit}" im Text erkannt`, foundContext };
  }

  return {
    level: "fortgeschritten",
    reason: foundContext
      ? "Kein eindeutiger Hinweis in der Nähe gefunden — Standardannahme, bitte prüfen"
      : "Kein eindeutiger Hinweis im Text gefunden — Standardannahme, bitte prüfen",
    foundContext,
  };
}