/**
 * Kurs-Zuordnung: Skills und Zielrollen fuer einen Kurs vorschlagen.
 *
 * Eine gemeinsame, deterministische Logik fuer alle Wege, auf denen Kurse in
 * den Katalog kommen (manuelles Formular, URL-Import, CSV-Import und spaeter
 * der Katalog-Assistent). Alles laeuft lokal gegen denselben Katalog wie die
 * Journey (ROLES_CATALOG/SKILLS_CATALOG via matchSkills) - vorher liefen die
 * Zielrollen-Vorschlaege ueber die Backend-Gap-Analyse und nur ueber die
 * ersten 15 Rollen, waehrend die Journey mit 126 lokalen Rollen arbeitet.
 *
 * Grundsaetze:
 *  - Nur Vorschlaege mit Begruendung; nichts wird automatisch gesetzt.
 *  - Skills nur aus dem, was der Kurs VERMITTELT (Titel, Lerninhalte,
 *    Beschreibung). Was nur unter Voraussetzungen/Zielgruppe steht, ist kein
 *    Kurs-Skill ("Excel-Grundkenntnisse vorausgesetzt").
 *  - Unscharfe Treffer (Tippfehler-Toleranz) nur im Kurstitel. In Lerninhalten
 *    und Beschreibungen nur exakte Treffer: dort erzeugt die Toleranz
 *    ueberwiegend Rauschen und kostet spuerbar Rechenzeit.
 *  - Zielrollen: (1) Kurstitel entspricht der typischen Weiterbildung oder
 *    der Berufsbezeichnung einer Rolle, (2) Anteil der Kern-Skills der Rolle,
 *    die der Kurs abdeckt, und Anteil der Kurs-Skills, die zur Rolle gehoeren.
 */

import { ROLES_CATALOG, type CatalogRole } from "./rolesCatalog";
import { matchSkills } from "./skillMatcher";

export type Confidence = "hoch" | "mittel" | "niedrig";
export type SkillSource = "titel" | "lerninhalte" | "beschreibung";

export interface CourseText {
  title: string;
  description?: string | null;
  /** Lerninhalte/Module/Lernziele - je Eintrag ein Punkt oder ein Freitext. */
  learningGoals?: string[] | null;
  /** Voraussetzungen/Zielgruppe: dient NUR zum Ausschluss, nie als Skill-Quelle. */
  prerequisites?: string | null;
  /** Bereits gewaehlte Bereiche - bevorzugt Rollen desselben Bereichs leicht. */
  bereichKeys?: string[] | null;
}

export interface SkillSuggestion {
  skill_id: string;
  name: string;
  confidence: Confidence;
  sources: SkillSource[];
  /** Woertliche Fundstelle (gekuerzt) fuer die Anzeige als Beleg. */
  evidence: string;
  score: number;
}

export interface ExcludedSkill {
  skill_id: string;
  name: string;
  reason: string;
}

export interface RoleSuggestion {
  role_id: string;
  role_name: string;
  bereich_label: string;
  confidence: Confidence;
  /** Interner Rangwert 0..1 (nicht als Prozent anzeigen). */
  rank: number;
  /** Kurze, verstaendliche Begruendung fuer die Anzeige. */
  reason: string;
  title_match: boolean;
  matched_skills: string[];
  role_skill_count: number;
}

export interface CourseClassification {
  skills: SkillSuggestion[];
  excluded: ExcludedSkill[];
  roles: RoleSuggestion[];
}

// ---------------------------------------------------------------------------
// Text-Normalisierung
// ---------------------------------------------------------------------------

export function normalizeDe(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

/**
 * Macht Berufs-/Abschlussbezeichnungen vergleichbar:
 * "Geprüfte/r Industriefachwirt/in (IHK)" -> "industriefachwirt",
 * "Personalfachkaufmann/-frau (IHK)" -> "personalfachkaufmann",
 * "Industriefachwirtin IHK" -> "industriefachwirt".
 */
export function titleKey(s: string): string {
  let t = normalizeDe(s);
  t = t.replace(/\((ihk|hwk|dkg|dgq|dvs\/iws|m\/w\/d|w\/m\/d)\)/g, " ");
  t = t.replace(/\b(ihk|hwk)\b/g, " ");
  t = t.replace(/\b(staatlich\s+)?gepruefte?r?\b(\/r)?/g, " ");
  t = t.replace(/\bzertifizierte?r?\b(\/r)?/g, " ");
  t = t.replace(/\/-?(in|innen|frau|r|e)\b/g, "");
  t = t.replace(/kauffrau/g, "kaufmann").replace(/fachfrau/g, "fachmann");
  // "Kita-Leitung"/"Pflegedienstleitung" soll "Kita-Leiter/in"/"Pflegedienstleiter/in" finden.
  t = t.replace(/leitung\b/g, "leiter");
  t = t.replace(/\/(koechin|pflegefachmann)\b/g, "");
  t = t.replace(/\(.*?\)/g, " ");
  t = t.replace(/[^a-z0-9]+/g, " ");
  const words = t
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 7 && /(wirt|ist|ant|ent|eur|ler|ner|ter|ker|ger|rer|ser|ier|ter|or)in$/.test(w) ? w.slice(0, -2) : w))
    .filter((w) => !["kurs", "lehrgang", "weiterbildung", "vorbereitung", "auf", "die", "zum", "zur", "der", "und", "berufsbegleitend", "online", "vollzeit", "teilzeit", "pruefung", "pruefungsvorbereitung", "zertifikat", "fuer", "im", "als", "nach", "gem", "gemaess", "umschulung", "teilqualifizierung", "qualifizierung", "mit"].includes(w));
  return words.join(" ").trim();
}

const MIN_TITLE_KEY_LENGTH = 4; // "koch" soll noch zaehlen; Treffer immer auf ganzen Woertern

function roleTitleKeys(role: CatalogRole): { key: string; kind: "weiterbildung" | "beruf"; label: string }[] {
  const out: { key: string; kind: "weiterbildung" | "beruf"; label: string }[] = [];
  const add = (text: string, kind: "weiterbildung" | "beruf") => {
    const key = titleKey(text);
    if (key.length >= MIN_TITLE_KEY_LENGTH && !out.some((o) => o.key === key)) out.push({ key, kind, label: text.trim() });
  };
  const tw = role.typische_weiterbildung;
  if (tw) for (const part of tw.split(/\s+\/\s+/)) add(part, "weiterbildung");
  for (const alias of role.title_aliases ?? []) add(alias, "weiterbildung");
  add(role.role_name, "beruf");
  return out;
}

/** Ein Wort aus dem Rollen-Schluessel (`needle`) passt zu einem Titelwort,
 *  wenn identisch, wenn es der Wortanfang des Titelworts ist (ab 5 Zeichen:
 *  "design" in "designer") oder das Ende eines zusammengesetzten Titelworts
 *  (ab 8 Zeichen: "staplerfahrer" in "gabelstaplerfahrer"). Nur in diese
 *  Richtung: Der Titel darf spezifischer sein als die Rolle, nie umgekehrt -
 *  sonst wuerde "Betriebswirt" die Rolle mit "Hotelbetriebswirt" treffen. */
function wordsMatch(needleWord: string, titleWord: string): boolean {
  if (needleWord === titleWord) return true;
  if (needleWord.length >= titleWord.length) return false;
  if (needleWord.length >= 5 && titleWord.startsWith(needleWord)) return true;
  if (needleWord.length >= 8 && titleWord.endsWith(needleWord)) return true;
  return false;
}

/** Enthaelt `haystack` die Wortfolge `needle` (auf Wortgrenzen, mit
 *  wordsMatch-Toleranz)? Zusaetzlich ohne Leerzeichen verglichen, damit
 *  "Tischler Meister" auch "Tischlermeister" findet. */
function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  if (` ${haystack} `.includes(` ${needle} `)) return true;
  const h = haystack.split(" ").filter(Boolean);
  const nd = needle.split(" ").filter(Boolean);
  for (let i = 0; i + nd.length <= h.length; i++) {
    if (nd.every((w, j) => wordsMatch(w, h[i + j]))) return true;
  }
  return joinedWordsMatch(h, needle.replace(/ /g, ""));
}

/** Getrennt vs. zusammengeschrieben: "tischler meister" ~ "tischlermeister".
 *  Nur ganze, aufeinanderfolgende Titelwoerter werden zusammengesetzt. */
function joinedWordsMatch(titleWords: string[], joinedNeedle: string): boolean {
  if (joinedNeedle.length < 10) return false;
  for (let i = 0; i < titleWords.length; i++) {
    let acc = titleWords[i];
    for (let j = i + 1; j < titleWords.length && acc.length < joinedNeedle.length; j++) {
      acc += titleWords[j];
      if (acc === joinedNeedle) return true;
    }
  }
  return false;
}

/** Exakter Treffer (ohne Wort-Toleranz)? Exakte Treffer ranken hoeher. */
function containsExact(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `) || joinedWordsMatch(haystack.split(" ").filter(Boolean), needle.replace(/ /g, ""));
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

function snippet(text: string, term: string): string {
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return text.slice(0, 120).trim();
  const start = Math.max(0, text.lastIndexOf(" ", Math.max(0, idx - 40)));
  const end = Math.min(text.length, idx + term.length + 60);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * Sehr allgemeine Katalog-Begriffe, die in Kurstexten fast immer in anderer
 * Bedeutung vorkommen ("Ausbildung zum ...", "Lohnabrechnung", "Data
 * Analytics"). Sie werden nur als unsichere Vorschlaege gefuehrt.
 */
const GENERIC_SKILL_IDS = new Set(["ausbildung", "abrechnung", "analytics", "betreuung", "wartung", "testing", "monitoring", "reporting", "routing", "verhandlung"]);

/** Allgemeine Kurs-Woerter ("Umschulung", "Schulung", "Lehrgang" ...) vor der
 *  Skill-Suche im Titel entfernen - sonst trifft die Tippfehler-Toleranz z.B.
 *  "Schalung" in "Schulung". */
const COURSE_WORDS = /\b(umschulung|schulung|lehrgang|weiterbildung|fortbildung|seminar|kurs|training|workshop|zertifikatslehrgang|qualifizierung|teilqualifizierung|ausbildung|grundlagen|einsteiger|aufbaukurs|vorbereitung|pruefungsvorbereitung)\b/gi;
function stripCourseWords(title: string): string {
  return title.replace(COURSE_WORDS, " ").replace(/\s+/g, " ").trim();
}

interface RawHit {
  skill_id: string;
  name: string;
  score: number;
  matched_on: string;
  source: SkillSource;
  text: string;
}

function hitsIn(text: string, source: SkillSource, allowFuzzy: boolean): RawHit[] {
  const clean = (text ?? "").trim();
  if (clean.length < 2) return [];
  return matchSkills(clean, { maxResults: 60, minScore: allowFuzzy ? 85 : 100 }).map((m) => ({
    skill_id: m.skill_id,
    name: m.name,
    score: m.score,
    matched_on: m.matched_on,
    source,
    text: clean,
  }));
}

export function suggestSkills(input: CourseText): { skills: SkillSuggestion[]; excluded: ExcludedSkill[] } {
  const hits: RawHit[] = [];
  hits.push(...hitsIn(stripCourseWords(input.title), "titel", true));
  // Lerninhalte: nur exakte Treffer. Die Tippfehler-Toleranz kostet je Text
  // ~0,2 s (Fensterabgleich gegen ~2.000 Suchbegriffe) - bei 30 Modulen waeren
  // das mehrere Sekunden eingefrorenes Formular. Webseiten-Texte sind zudem
  // redigiert; Tippfehler-Toleranz bleibt dem (einen) Kurstitel vorbehalten.
  const seenGoals = new Set<string>();
  for (const goal of input.learningGoals ?? []) {
    const key = normalizeDe(goal.trim());
    if (!key || seenGoals.has(key)) continue;
    seenGoals.add(key);
    hits.push(...hitsIn(goal, "lerninhalte", false));
  }
  hits.push(...hitsIn(input.description ?? "", "beschreibung", false));

  // Mehrere Katalog-Skills auf DERSELBEN Fundstelle (z.B. "Personalführung"
  // und "Personalführung (Grundlagen)"): nur den behalten, dessen Name der
  // Fundstelle entspricht - sonst erscheint derselbe Inhalt doppelt.
  const sameSpot = new Map<string, RawHit[]>();
  for (const h of hits) {
    const k = `${h.source}|${h.text}|${normalizeDe(h.matched_on)}`;
    sameSpot.set(k, [...(sameSpot.get(k) ?? []), h]);
  }
  const deduped: RawHit[] = [];
  for (const group of sameSpot.values()) {
    if (group.length === 1) {
      deduped.push(group[0]);
      continue;
    }
    const exactName = group.find((h) => normalizeDe(h.name) === normalizeDe(h.matched_on));
    deduped.push(exactName ?? [...group].sort((a, b) => a.name.length - b.name.length)[0]);
  }

  const bySkill = new Map<string, RawHit[]>();
  for (const h of deduped) {
    const list = bySkill.get(h.skill_id) ?? [];
    list.push(h);
    bySkill.set(h.skill_id, list);
  }

  const prereqIds = new Set(
    input.prerequisites ? matchSkills(input.prerequisites, { maxResults: 60, minScore: 100 }).map((m) => m.skill_id) : [],
  );

  const skills: SkillSuggestion[] = [];
  const excluded: ExcludedSkill[] = [];
  for (const [skillId, list] of bySkill) {
    const sources = [...new Set(list.map((h) => h.source))];
    const best = [...list].sort((a, b) => b.score - a.score)[0];
    const exact = list.some((h) => h.score >= 100);
    if (prereqIds.has(skillId) && !sources.includes("titel") && !sources.includes("lerninhalte")) {
      excluded.push({ skill_id: skillId, name: best.name, reason: "Steht nur bei Voraussetzungen/Zielgruppe - wird vorausgesetzt, nicht vermittelt." });
      continue;
    }
    let confidence: Confidence;
    if (GENERIC_SKILL_IDS.has(skillId)) confidence = "niedrig";
    else if (exact && (sources.includes("titel") || sources.length >= 2)) confidence = "hoch";
    else if (exact) confidence = "mittel";
    else confidence = "niedrig";
    const evidenceHit = list.find((h) => h.source === "lerninhalte") ?? list.find((h) => h.source === "titel") ?? best;
    skills.push({
      skill_id: skillId,
      name: best.name,
      confidence,
      sources,
      evidence: snippet(evidenceHit.text, evidenceHit.matched_on),
      score: best.score,
    });
  }
  const order: Record<Confidence, number> = { hoch: 0, mittel: 1, niedrig: 2 };
  // Gleichnamige Katalog-Eintraege (z.B. zweimal "Büroorganisation" in
  // verschiedenen Bereichen) nur einmal anzeigen - der sicherere gewinnt.
  const byName = new Map<string, SkillSuggestion>();
  for (const sk of skills) {
    const k = normalizeDe(sk.name);
    const prev = byName.get(k);
    if (!prev || order[sk.confidence] < order[prev.confidence]) byName.set(k, sk);
  }
  skills.length = 0;
  skills.push(...byName.values());
  skills.sort((a, b) => order[a.confidence] - order[b.confidence] || b.sources.length - a.sources.length || a.name.localeCompare(b.name, "de"));
  return { skills, excluded };
}

// ---------------------------------------------------------------------------
// Zielrollen
// ---------------------------------------------------------------------------

export interface SuggestRolesOptions {
  /** Max. Anzahl Vorschlaege (Default 5). */
  limit?: number;
  catalog?: CatalogRole[];
}

export function suggestRoles(
  input: CourseText,
  skillIds: Iterable<string>,
  opts: SuggestRolesOptions = {},
  titleSkillIds: Iterable<string> = [],
): RoleSuggestion[] {
  const catalog = opts.catalog ?? ROLES_CATALOG;
  const limit = opts.limit ?? 5;
  const titleNorm = titleKey(input.title);
  const courseSkills = new Set(skillIds);
  const titleSkills = new Set(titleSkillIds);
  const bereiche = new Set(input.bereichKeys ?? []);
  const out: RoleSuggestion[] = [];

  for (const role of catalog) {
    if (role.role_id.startsWith("bereich:")) continue;
    // Bei mehreren Titeltreffern zaehlt der spezifischste (meiste Woerter/laengster).
    const titleHit = roleTitleKeys(role)
      .filter((k) => containsPhrase(titleNorm, k.key))
      .map((k) => ({ ...k, exact: containsExact(titleNorm, k.key) }))
      .sort((a, b) => Number(b.exact) - Number(a.exact) || b.key.length - a.key.length)[0];
    const roleSkillIds = role.skills.map((s) => s.skill_id);
    const matched = role.skills.filter((s) => courseSkills.has(s.skill_id));
    const coverage = matched.reduce((sum, s) => sum + s.weight, 0) / 100;
    const precision = courseSkills.size ? matched.length / courseSkills.size : 0;

    let rank = 0.6 * coverage + 0.4 * precision;
    // Titeltreffer: exakt vor tolerant, spezifisch (lang) vor allgemein.
    if (titleHit) rank += (titleHit.exact ? 1 : 0.7) + Math.min(0.3, titleHit.key.length / 100);
    if (bereiche.size && bereiche.has(role.bereich_key)) rank += 0.05;

    // Kerninhalt im Titel: ein im Kurstitel genannter Skill gehoert zu den drei
    // wichtigsten Skills der Rolle (z.B. "Schweisskurs MAG" -> Schweisstechniken
    // beim Schweisser). Schwaecher als ein Titeltreffer, staerker als Einzeltreffer.
    const topThree = [...role.skills].sort((a, b) => b.weight - a.weight).slice(0, 3);
    const titleCore = topThree.find((s) => titleSkills.has(s.skill_id));
    if (titleCore && !titleHit) rank += 0.35;

    const skillBased = matched.length >= 3 || (matched.length >= 2 && coverage >= 0.15);
    if (!titleHit && !skillBased && !titleCore) continue;

    const confidence: Confidence = titleHit
      ? "hoch"
      : (coverage >= 0.3 && matched.length >= 3) || titleCore
        ? "mittel"
        : "niedrig";
    const names = matched.map((s) => s.name);
    const skillPart = matched.length
      ? `deckt ${matched.length} von ${roleSkillIds.length} Kern-Skills ab (${names.slice(0, 4).join(", ")}${names.length > 4 ? " …" : ""})`
      : "";
    const reason = titleHit
      ? `Kurstitel entspricht ${titleHit.kind === "weiterbildung" ? "der typischen Weiterbildung" : "der Berufsbezeichnung"} „${titleHit.label}“${skillPart ? `; ${skillPart}` : ""}`
      : titleCore
        ? `Kurstitel nennt einen Kerninhalt der Rolle („${titleCore.name}“)${skillPart ? `; ${skillPart}` : ""}`
        : skillPart.charAt(0).toUpperCase() + skillPart.slice(1);

    out.push({
      role_id: role.role_id,
      role_name: role.role_name,
      bereich_label: role.bereich_label,
      confidence,
      rank,
      reason,
      title_match: Boolean(titleHit),
      matched_skills: names,
      role_skill_count: roleSkillIds.length,
    });
  }
  out.sort((a, b) => b.rank - a.rank || a.role_name.localeCompare(b.role_name, "de"));
  // Gibt es Titeltreffer, stehen nur diese plus starke Skill-Treffer oben -
  // schwache Skill-Treffer wuerden dann nur ablenken.
  const hasStrong = out.some((r) => r.confidence !== "niedrig");
  return (hasStrong ? out.filter((r) => r.confidence !== "niedrig") : out).slice(0, limit);
}

/**
 * Bereiche (Journey-Kategorien) fuer einen Kurs: zuerst die Bereiche der
 * sicher passenden Zielrollen, dann nach Gewicht der belegten Skills
 * (nur hoch/mittel) - hoechstens drei, nur Bereiche mit mind. halb so viel
 * Gewicht wie der staerkste. Ersetzt die fruehere Unscharf-Suche ueber den
 * ganzen Text, die viele Zufallstreffer lieferte.
 */
export function suggestBereiche(result: CourseClassification, catalog: CatalogRole[] = ROLES_CATALOG): string[] {
  const out: string[] = [];
  const roleById = new Map(catalog.map((r) => [r.role_id, r]));
  for (const r of result.roles) {
    if (r.confidence !== "hoch") continue;
    const key = roleById.get(r.role_id)?.bereich_key;
    if (key && !out.includes(key)) out.push(key);
  }
  const reliable = new Set(result.skills.filter((s) => s.confidence !== "niedrig").map((s) => s.skill_id));
  const score = new Map<string, number>();
  for (const role of catalog) {
    if (role.role_id.startsWith("bereich:")) continue;
    for (const sk of role.skills) if (reliable.has(sk.skill_id)) score.set(role.bereich_key, (score.get(role.bereich_key) ?? 0) + sk.weight);
  }
  const sorted = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted[0]?.[1] ?? 0;
  for (const [key, val] of sorted) {
    if (out.length >= 3) break;
    if (val >= top * 0.5 && !out.includes(key)) out.push(key);
  }
  return out.slice(0, 3);
}

export function classifyCourse(input: CourseText, opts: SuggestRolesOptions = {}): CourseClassification {
  const { skills, excluded } = suggestSkills(input);
  const reliable = skills.filter((s) => s.confidence !== "niedrig");
  const roles = suggestRoles(
    input,
    reliable.map((s) => s.skill_id),
    opts,
    reliable.filter((s) => s.sources.includes("titel")).map((s) => s.skill_id),
  );
  return { skills, excluded, roles };
}

/** Zerlegt einen Beschreibungs-/Seitentext in Lernziel-Punkte (Aufzaehlungen, Zeilen). */
export function splitLearningGoals(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n|•|·|;|(?:^|\s)[-–]\s/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && s.length <= 300);
}