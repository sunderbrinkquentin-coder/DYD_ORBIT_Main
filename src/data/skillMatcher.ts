/**
 * Skill-Matching ohne Python: TypeScript-Portierung der bisherigen
 * rapidfuzz-basierten Logik aus backend/app/services/skill_matcher.py.
 *
 * Läuft ohne externe Abhängigkeiten — funktioniert unverändert sowohl im
 * Browser (Vite/React) als auch in einer Supabase Edge Function (Deno),
 * da beide Standard-TypeScript/ESM ausführen. Das macht den Umzug von
 * "Prototyp im Frontend" zu "läuft serverseitig in der Edge Function"
 * später zu einem reinen Kopiervorgang, keiner Neuimplementierung.
 *
 * Fachliche Entsprechung zum Python-Original:
 *  - _contains_term()      -> findValidMatch() (erweitert um Verneinungs- und
 *                             Substring-Kollisions-Pruefung, siehe FIX 1/FIX 2
 *                             unten — im Original nicht vorhanden)
 *  - fuzz.partial_ratio()  -> partialRatio() (eigene, kompakte Implementierung
 *                             auf Basis von Levenshtein-Distanz über ein
 *                             gleitendes Fenster, siehe Kommentar dort)
 *  - match_skills()        -> matchSkills()
 */

import { SKILLS_CATALOG, type CatalogSkill } from "./rolesCatalog";

export interface SkillMatch {
  skill_id: string;
  name: string;
  matched_on: string;
  score: number;
}

/** Sehr kurze Suchbegriffe (z.B. "R", "BI", "KI") duerfen nur als
 * eigenstaendiges Wort zaehlen, sonst matcht "R" faelschlich in "ERfahrung"
 * o.ae. — 1:1 aus dem Python-Original uebernommen. */
const SHORT_TERM_MAX_LEN = 3;

/**
 * FIX 1 — Verneinung wurde bisher ignoriert: "keine Erfahrung mit Excel"
 * matchte Excel mit vollem Score 100, weil containsTerm() nur prueft, OB der
 * Begriff im Text vorkommt, nie WIE. Fenstergroesse angelehnt an das gleiche
 * Prinzip in lib/skillLevel.ts (dort 80 Zeichen um die Skill-Erwaehnung),
 * hier bewusst enger (40 Zeichen = ca. 5-6 Woerter vor dem Treffer), weil
 * eine Verneinung inhaltlich nah am Skillbegriff stehen muss, um ihn
 * plausibel zu entwerten - sonst entwertet ein "kein" drei Saetze frueher
 * faelschlich einen ganz anderen, tatsaechlich vorhandenen Skill.
 */
const NEGATION_MARKERS = [
  "kein", "keine", "keinen", "keinem", "keiner", "keinerlei",
  "nicht", "ohne", "fehlende", "fehlend", "fehlt", "mangelnde",
  "mangelhafte", "noch keine", "noch nicht", "bisher keine", "bisher nicht",
];
const NEGATION_WINDOW = 40;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True, wenn im Fenster unmittelbar VOR `index` ein Verneinungswort steht. */
function isNegatedAt(textLower: string, index: number): boolean {
  const windowText = textLower.slice(Math.max(0, index - NEGATION_WINDOW), index);
  return NEGATION_MARKERS.some((marker) => new RegExp(`\\b${escapeRegExp(marker)}\\b`).test(windowText));
}

/**
 * FIX 2 — Substring-Kollision bei laengeren Begriffen: containsTerm() macht
 * fuer Begriffe > SHORT_TERM_MAX_LEN ein reines includes() OHNE Wortgrenze -
 * das ist ABSICHTLICH so (deutsche Komposita wie "Projektmanagement" muessen
 * auch in "Projektmanagementerfahrung" matchen, eine harte Wortgrenze wuerde
 * das zerstoeren). Nebenwirkung, im echten Katalog bestaetigt
 * (rolesCatalog.ts:165-166 "java" UND "javascript" als eigene Skills mit
 * eigenem Gewicht): "javascript" enthaelt "java" als Substring, jeder
 * JavaScript-CV matcht automatisch faelschlich auch Java mit Score 100.
 * Da eine generelle Wortgrenze fuer laengere Begriffe die gewollte
 * Komposita-Toleranz zerstoeren wuerde, gibt es keine automatische Lösung -
 * stattdessen ein rein additives, optionales Katalog-Feld
 * `excludeIfFollowedBy`: steht direkt nach dem Treffer einer der hier
 * gelisteten Strings, zaehlt DIESES Vorkommen nicht (ein spaeteres, echtes
 * "Java"-Vorkommen woanders im Text zaehlt trotzdem weiter). Siehe
 * rolesCatalog.ts: bei "java" ergaenzen um `excludeIfFollowedBy: ["script"]`.
 */
function isExcludedContinuation(textLower: string, index: number, termLower: string, excludeIfFollowedBy?: string[]): boolean {
  if (!excludeIfFollowedBy || excludeIfFollowedBy.length === 0) return false;
  const after = textLower.slice(index + termLower.length);
  return excludeIfFollowedBy.some((suffix) => after.startsWith(normalize(suffix)));
}

/**
 * Spiegelbildlich zu `isExcludedContinuation`, aber prueft, was VOR dem
 * Treffer steht statt danach — noetig fuer Kollisionen, bei denen der kuerzere
 * Begriff als SUFFIX eines laengeren, fachlich anderen Begriffs auftaucht
 * (statt als Praefix wie beim Java/JavaScript-Fall oben). Konkretes Beispiel
 * im echten Katalog: "Fallmanagement" ist Substring von "Notfallmanagement" —
 * ein Lebenslauf mit "Notfallmanagement" wuerde ohne diese Pruefung
 * faelschlich auch "Fallmanagement" (ein eigenstaendiger, fachlich anderer
 * Skill in der Sozialarbeit) mit Score 100 matchen. Siehe rolesCatalog.ts:
 * bei "fallmanagement" ergaenzt um `excludeIfPrecededBy: ["not"]`.
 */
function isExcludedPrecedingContext(textLower: string, index: number, excludeIfPrecededBy?: string[]): boolean {
  if (!excludeIfPrecededBy || excludeIfPrecededBy.length === 0) return false;
  return excludeIfPrecededBy.some((prefix) => {
    const p = normalize(prefix);
    return index >= p.length && textLower.slice(index - p.length, index) === p;
  });
}

/** Liefert die Startindizes ALLER Vorkommen von `termLower` in `textLower` -
 *  gebraucht, damit ein einzelnes negiertes/ausgeschlossenes Vorkommen ein
 *  SPAETERES, gueltiges Vorkommen desselben Begriffs nicht mit zunichtemacht. */
function findAllOccurrences(termLower: string, textLower: string, wordBounded: boolean): number[] {
  const indices: number[] = [];
  if (wordBounded) {
    const re = new RegExp(`\\b${escapeRegExp(termLower)}\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(textLower)) !== null) {
      indices.push(m.index);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  } else {
    let from = 0;
    while (true) {
      const idx = textLower.indexOf(termLower, from);
      if (idx === -1) break;
      indices.push(idx);
      from = idx + 1;
    }
  }
  return indices;
}

/** Wie containsTerm() vorher, aber liefert den Index eines gueltigen
 *  (nicht negierten, nicht ausgeschlossenen) Treffers statt nur true/false -
 *  oder -1, wenn kein gueltiges Vorkommen existiert. */
function findValidMatch(
  termLower: string,
  textLower: string,
  excludeIfFollowedBy?: string[],
  excludeIfPrecededBy?: string[]
): number {
  const wordBounded = termLower.length <= SHORT_TERM_MAX_LEN;
  for (const index of findAllOccurrences(termLower, textLower, wordBounded)) {
    if (isNegatedAt(textLower, index)) continue;
    if (isExcludedContinuation(textLower, index, termLower, excludeIfFollowedBy)) continue;
    if (isExcludedPrecedingContext(textLower, index, excludeIfPrecededBy)) continue;
    return index;
  }
  return -1;
}

/** Klassische Levenshtein-Distanz (Zeilen-Array-Variante, O(n*m) Zeit,
 * O(min(n,m)) Speicher). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Naeherung an rapidfuzz.fuzz.partial_ratio: findet die beste
 * Uebereinstimmung eines (kurzen) Suchbegriffs `term` irgendwo im
 * (laengeren) `text`, indem ein Fenster der Laenge von `term` ueber `text`
 * geschoben wird und pro Fensterposition eine Levenshtein-basierte
 * Aehnlichkeit berechnet wird. Gibt einen Score von 0-100 zurueck.
 *
 * Das ist keine bit-identische Nachbildung von rapidfuzz (das nutzt
 * SequenceMatcher-Bloecke), aber fuer kurze Skill-Begriffe gegen
 * Freitext-Profile praktisch gleichwertig — und ausreichend fuer diesen
 * Zweck (Tippfehler/leichte Umformulierungen abfangen).
 */
function partialRatio(term: string, text: string): { score: number; index: number; dist: number } {
  const tLen = term.length;
  if (tLen === 0 || text.length === 0) return { score: 0, index: -1, dist: Math.max(tLen, text.length) };
  if (text.length <= tLen) {
    const dist = levenshtein(term, text);
    const maxLen = Math.max(tLen, text.length);
    return { score: Math.round((1 - dist / maxLen) * 1000) / 10, index: 0, dist };
  }

  let best = 0;
  let bestIndex = 0;
  let bestDist = tLen;
  // Schrittweite 1 fuer kurze Texte, groesser fuer lange (Performance) —
  // Skill-Begriffe sind kurz genug, dass das Fenster i.d.R. < 200 Iterationen hat.
  for (let i = 0; i <= text.length - tLen; i++) {
    const window = text.slice(i, i + tLen);
    const dist = levenshtein(term, window);
    const ratio = (1 - dist / tLen) * 100;
    if (ratio > best) {
      best = ratio;
      bestIndex = i;
      bestDist = dist;
    }
    if (best >= 100) break;
  }
  return { score: Math.round(best * 10) / 10, index: bestIndex, dist: bestDist };
}

/**
 * FIX 3 — Der prozentuale Fuzzy-Score von partialRatio() allein ist fuer
 * KURZE bis MITTLERE Begriffe irrefuehrend: zwei voellig unverwandte, aber
 * aehnlich lange deutsche Woerter teilen sich oft genug haeufige Buchstaben
 * (e, n, r, t, s, a, i, g ...), dass ihr Levenshtein-basierter Prozentsatz
 * rein zufaellig bei 55-70% liegt — z.B. "Testing" vs. "Assistenzleistungen"
 * oder "Wartung" vs. "Aktenverwaltung". Bei einem minScore von 55-60 (wie an
 * allen Aufrufstellen im Dashboard/der Journey ueblich) rutschen solche
 * komplett unpassenden Skills als vermeintliche Treffer durch — vermutlich
 * eine der Hauptursachen fuer insgesamt unpraezises Matching, unabhaengig
 * von fehlenden Aliasen (siehe matchSkillsLocal-Kommentar in
 * DashboardPage.tsx). Deshalb zusaetzlich zur Prozent-Schwelle ein
 * ABSOLUTER Editierdistanz-Deckel: ein Fuzzy-Treffer zaehlt nur, wenn er
 * durch wenige TATSAECHLICHE Zeichen-Aenderungen (Tippfehler, Umformulierung)
 * erklaerbar ist, skaliert mit der Begriffslaenge — nicht durch zufaelligen
 * prozentualen Buchstaben-Ueberlapp bei ansonsten unverwandten Woertern.
 */
function maxAllowedFuzzyDistance(termLen: number): number {
  if (termLen <= 5) return 0;
  if (termLen <= 9) return 1;
  if (termLen <= 15) return 2;
  return 3;
}

/**
 * FIX 4 (25.09.2026) — Suchbegriffe eines Skills: bisher wurden NUR die
 * Aliase durchsucht, sobald ein Skill ueberhaupt Aliase hatte. Bei 517 von
 * 956 Katalog-Skills stand der eigentliche Name nicht unter den Aliasen -
 * "Unternehmensführung" (Alias nur "Managementgrundlagen") oder
 * "Anforderungsanalyse" (Alias nur "Requirements Engineering") wurden deshalb
 * nie gefunden, selbst wenn sie woertlich im Text standen. Jetzt: Name, Name
 * ohne Klammerzusatz ("Abgasuntersuchung (AU)" -> "Abgasuntersuchung") und
 * alle Aliase, ohne Dubletten.
 */
export function searchTermsFor(skill: CatalogSkill): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    const clean = t.trim();
    const key = normalize(clean);
    if (clean.length === 0 || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };
  add(skill.name);
  const withoutParens = skill.name.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  if (withoutParens.length >= 4) add(withoutParens);
  for (const a of skill.aliases) add(a);
  return out;
}

/**
 * Schubfachprinzip fuer die unscharfe Suche: Liegt ein Begriff mit hoechstens
 * k Aenderungen (Levenshtein) irgendwo im Text, dann kommt mindestens eines
 * seiner k+1 zusammenhaengenden Teilstuecke UNVERAENDERT im Text vor. Findet
 * sich keines, kann partialRatio() keinen zulaessigen Treffer liefern - die
 * teure Fensterberechnung wird uebersprungen. Das Ergebnis bleibt identisch.
 */
function fuzzyCandidate(termLower: string, textLower: string): boolean {
  const k = maxAllowedFuzzyDistance(termLower.length);
  if (k === 0) return false; // Distanz 0 = exakter Treffer, der oben schon geprueft wurde
  const pieces = k + 1;
  const size = Math.floor(termLower.length / pieces);
  if (size < 2) return true;
  for (let i = 0; i < pieces; i++) {
    const start = i * size;
    const end = i === pieces - 1 ? termLower.length : start + size;
    if (textLower.includes(termLower.slice(start, end))) return true;
  }
  return false;
}

export interface MatchSkillsOptions {
  maxResults?: number;
  minScore?: number;
  /** Ersetzt den Standard-Katalog, z.B. fuer Tests. Default: SKILLS_CATALOG. */
  catalog?: CatalogSkill[];
}

/** TS-Entsprechung von match_skills() aus skill_matcher.py — matcht einen
 * Freitext gegen den Skill-Katalog und liefert die besten Treffer.
 *
 * `excludeIfFollowedBy`/`excludeIfPrecededBy` sind rein additive, optionale
 * Felder auf CatalogSkill (siehe Kommentare bei isExcludedContinuation /
 * isExcludedPrecedingContext oben) — ein Katalog-Eintrag ohne diese Felder
 * verhaelt sich exakt wie vorher. */
export function matchSkills(text: string, opts: MatchSkillsOptions = {}): SkillMatch[] {
  const maxResults = opts.maxResults ?? 10;
  const minScore = opts.minScore ?? 60.0;
  const catalog = opts.catalog ?? SKILLS_CATALOG;
  const textLower = normalize(text);

  const results: SkillMatch[] = [];

  for (const skill of catalog) {
    let bestScore = 0;
    let bestTerm = "";
    const excludeIfFollowedBy = (skill as CatalogSkill & { excludeIfFollowedBy?: string[] }).excludeIfFollowedBy;
    const excludeIfPrecededBy = (skill as CatalogSkill & { excludeIfPrecededBy?: string[] }).excludeIfPrecededBy;

    for (const term of searchTermsFor(skill)) {
      const termLower = normalize(term);
      let score: number;

      const matchIndex = findValidMatch(termLower, textLower, excludeIfFollowedBy, excludeIfPrecededBy);
      if (matchIndex >= 0) {
        score = 100;
      } else if (termLower.length <= SHORT_TERM_MAX_LEN) {
        // Wie im Python-Original: kein Fuzzy-Fallback fuer sehr kurze Begriffe,
        // da das gegen langen Freitext fast immer Zufallstreffer waeren.
        score = 0;
      } else if (minScore >= 100 || !fuzzyCandidate(termLower, textLower)) {
        // Verlustfreie Abkuerzungen (25.09.2026, Geschwindigkeit): (1) wer nur
        // exakte Treffer will, braucht keine Fuzzy-Suche; (2) fuzzyCandidate()
        // schliesst Begriffe aus, die mit der erlaubten Editierdistanz gar
        // nicht im Text vorkommen KOENNEN (Schubfachprinzip, siehe dort).
        score = 0;
      } else {
        const fuzzy = partialRatio(termLower, textLower);
        // Auch der unscharfe Treffer zaehlt nicht, wenn er in einem
        // Verneinungs- oder Ausschluss-Kontext liegt ("kein Excel" soll nicht
        // ueber einen Tippfehler-Treffer doch noch als Match durchrutschen —
        // und ein per excludeIfFollowedBy/excludeIfPrecededBy bewusst
        // ausgeschlossenes Vorkommen, z.B. "Java" in "JavaScript" oder
        // "Fallmanagement" in "Notfallmanagement", darf nicht ueber den
        // Fuzzy-Fallback wieder hereinrutschen, sonst waere der exakte
        // Ausschluss oben wirkungslos, weil die Fuzzy-Suche dasselbe
        // Vorkommen mit Distanz 0 = Score 100 sofort wiederfindet).
        const fuzzyExcluded =
          fuzzy.index >= 0 &&
          (isNegatedAt(textLower, fuzzy.index) ||
            isExcludedContinuation(textLower, fuzzy.index, termLower, excludeIfFollowedBy) ||
            isExcludedPrecedingContext(textLower, fuzzy.index, excludeIfPrecededBy));
        // FIX 3 (siehe Kommentar bei maxAllowedFuzzyDistance): ein hoher
        // Prozent-Score allein reicht nicht - die tatsaechliche Editierdistanz
        // muss zur Begriffslaenge passen, sonst ist es nur zufaelliger
        // Buchstaben-Ueberlapp zwischen zwei unverwandten Woertern.
        const fuzzyTooFar = fuzzy.dist > maxAllowedFuzzyDistance(termLower.length);
        score = fuzzyExcluded || fuzzyTooFar ? 0 : fuzzy.score;
      }

      if (score > bestScore) {
        bestScore = score;
        bestTerm = term;
      }
      if (bestScore >= 100) break;
    }

    if (bestScore >= minScore) {
      results.push({
        skill_id: skill.skill_id,
        name: skill.name,
        matched_on: bestTerm,
        score: Math.round(bestScore * 10) / 10,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}