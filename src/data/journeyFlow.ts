/**
 * Journey v2 – "Der kurze Weg" (24.09.2026), reine Logik ohne UI.
 * Konzept: Projekt-Doc journey-v2-konzept-2026-09-24.md.
 *
 * Aufgabe dieses Moduls: aus dem, was eine Person in Alltagssprache angibt
 * (Ziel, Taetigkeiten, 1–2 Bereiche), deterministisch ableiten,
 *  1. welche 2–3 Berufe als Richtung realistisch sind (Eingrenzung statt
 *     Mittelung ueber einen ganzen Bereich — Ursache von "Fragen zu
 *     allgemein", siehe rollen-katalog-erweiterung-2026-09-24.md),
 *  2. welche hoechstens 5 Skills im Kurz-Check gefragt werden,
 *  3. wie jede Frage in Alltagssprache lautet,
 *  4. welche Skills durch Taetigkeiten schon belegt sind (transparent, im
 *     Ergebnis korrigierbar — siehe "Transparenz-Regel" im Konzept),
 *  5. zu welchen Berufen ein Kurs fuehrt ("Fuehrt zu: …" im Ergebnis).
 *
 * Grundsaetze wie im restlichen Projekt: keine KI, gleiche Eingaben =>
 * gleiches Ergebnis, keine erfundenen Fakten, Rollentitel werden der Person
 * erst am Kurs gezeigt.
 */

import { ROLES_CATALOG, type CatalogRole } from "./rolesCatalog";
import { buildBereichRole, suggestRolesForSkillIds } from "./gapAnalysis";
import { ACTIVITY_FIELDS, deriveSkillsFromActivities, getActivity } from "./activitiesCatalog";

export type Niveau = 1 | 2 | 3 | 4;

// ---------------------------------------------------------------------------
// 1. Herkunfts-Niveau schaetzen
// ---------------------------------------------------------------------------

/** Taetigkeiten, die Verantwortung fuer andere belegen. */
const LEADERSHIP_ACTIVITY_IDS = new Set(["verantw-team", "verantw-einarbeiten", "verantw-dienstplan", "verantw-budget"]);

export interface OriginEstimate {
  /** Geschaetztes aktuelles Anforderungsniveau oder null, wenn nichts angegeben. */
  niveau: Niveau | null;
  hasLeadershipExperience: boolean;
  /** Bester Treffer (nur intern, wird nie als "du bist X" angezeigt). */
  bestMatchRoleId: string | null;
}

/** Hoechster Abschluss (Bildschirm 2, eine Frage). "keine" ist fuer
 *  Arbeitsagentur/Transfer zentral: ohne Berufsabschluss ist die Fachkraft-
 *  Ausbildung (Umschulung/Teilqualifizierung) der realistische naechste
 *  Schritt, nicht eine Aufstiegsfortbildung. */
export type QualificationLevel = "keine" | "berufsausbildung" | "aufstieg" | "studium";

/**
 * Schaetzt, auf welchem Niveau jemand heute steht.
 *  - Ist der Abschluss bekannt, ist ER massgeblich (keine -> 1,
 *    Ausbildung -> 2, Meister/Fachwirt/Techniker -> 3, Studium -> 3).
 *  - Sonst aus den Taetigkeiten, aber hoechstens Fachkraft (2): Taetigkeiten
 *    zeigen, WAS jemand getan hat, nicht mit welcher Qualifikation — ein
 *    Lagerhelfer, der Waren prueft und einlagert, ist deshalb noch keine
 *    Fachkraft mit Aufstiegsziel Lagerleitung.
 * Fuehrungs-Taetigkeiten werden nur als Signal gemerkt (fuer Ziel "fuehrung").
 */
export function estimateOrigin(
  activityIds: string[],
  roles: CatalogRole[] = ROLES_CATALOG,
  qualification: QualificationLevel | null = null,
): OriginEstimate {
  const hasLeadershipExperience = activityIds.some((id) => LEADERSHIP_ACTIVITY_IDS.has(id));
  const derived = deriveSkillsFromActivities(activityIds);
  const best =
    activityIds.length > 0 ? suggestRolesForSkillIds(new Set(derived.keys()), { roles, limit: 1, minMatchPercentage: 15 })[0] : undefined;
  let niveau: Niveau | null;
  if (qualification) {
    niveau = qualification === "keine" ? 1 : qualification === "berufsausbildung" ? 2 : 3;
  } else if (activityIds.length === 0) {
    niveau = null;
  } else if (best) {
    const r = roles.find((x) => x.role_id === best.role_id);
    niveau = (Math.min(2, r?.anforderungsniveau ?? 2) as Niveau);
  } else {
    niveau = activityIds.length >= 3 ? 2 : 1;
  }
  return { niveau, hasLeadershipExperience, bestMatchRoleId: best?.role_id ?? null };
}

// ---------------------------------------------------------------------------
// 2. Eingrenzung der Richtung auf 2–3 Berufe
// ---------------------------------------------------------------------------

/**
 * Welches Niveau ist als NAECHSTER Schritt realistisch? (Grundlage der
 * spaeteren Stepping-Stone-Logik.) Ziel-Keys wie GOAL_OPTIONS in
 * JourneyPage: weiterkommen, knowhow, neuorientierung, fuehrung, chancen,
 * unsicher.
 */
export function targetNiveauFor(goal: string | null, origin: OriginEstimate): Niveau {
  const cur = origin.niveau ?? 1;
  switch (goal) {
    case "fuehrung":
      return (Math.min(4, Math.max(3, cur + 1)) as Niveau);
    case "knowhow":
    case "weiterkommen":
      return (Math.min(4, Math.max(2, cur + 1)) as Niveau);
    case "neuorientierung":
    case "chancen":
      // Wechsel in ein neues Feld: realistisch auf Fachkraft-Niveau
      // einsteigen, wer schon hoeher war, hoechstens auf gleichem Niveau.
      return (Math.min(3, Math.max(2, cur)) as Niveau);
    default:
      return (Math.min(3, Math.max(2, cur + 1)) as Niveau);
  }
}

/** Gewichtete Skill-Ueberschneidung zweier Rollen (0–1): Anteil des
 *  Gewichts von `a`, das auch in `b` vorkommt. */
function roleOverlap(a: CatalogRole, b: CatalogRole): number {
  const ids = new Set(b.skills.map((s) => s.skill_id));
  const total = a.skills.reduce((sum, s) => sum + s.weight, 0) || 1;
  return a.skills.filter((s) => ids.has(s.skill_id)).reduce((sum, s) => sum + s.weight, 0) / total;
}

export interface DirectionCandidate {
  role: CatalogRole;
  score: number;
  /** Anteil (0–100) der Rollen-Skills, die die Taetigkeiten schon abdecken. */
  experienceMatch: number;
}

/**
 * Grenzt die gewaehlten Bereiche auf 1–3 Berufe ein, die fuer diese Person
 * der realistische naechste Schritt sind. Score (0–1):
 *  45 % Niveau-Passung zum Zielniveau, 30 % Erfahrungs-Passung
 *  (Taetigkeiten), 15 % Angebots-Bonus (der Traeger hat Kurse, die zu
 *  diesem Beruf fuehren — conversion-relevant: keine Richtung ohne
 *  passendes Angebot), 10 % Ziel-Bonus (Fuehrungsrolle bei "fuehrung").
 * Regeln:
 *  - Helferberufe (Niveau 1) sind nie Ziel, ausser ein Bereich hat nichts anderes.
 *  - Bei Aufstiegszielen (weiterkommen/knowhow/fuehrung) nur Berufe ab dem
 *    Zielniveau (Fallback: nicht unter dem heutigen Niveau).
 *  - Zusammenhang: weitere Berufe kommen nur dazu, wenn sie mit dem besten
 *    fachlich zusammenhaengen (>= 20 % gemeinsame Skills) oder einen weiteren
 *    gewaehlten Bereich vertreten. Sonst lieber 1 Beruf mit konkreten Fragen
 *    als 3 unzusammenhaengende mit beliebigen.
 *  - Deterministischer Tie-Break ueber role_id.
 */
export function narrowDirection(params: {
  bereichKeys: string[];
  activityIds: string[];
  goal: string | null;
  roles?: CatalogRole[];
  max?: number;
  qualification?: QualificationLevel | null;
  /** Rollen, zu denen Kurse des Traegers fuehren (siehe rolesForCourse). */
  offeredRoleIds?: ReadonlySet<string>;
}): DirectionCandidate[] {
  const roles = params.roles ?? ROLES_CATALOG;
  const max = params.max ?? 3;
  const inBereich = roles.filter((r) => params.bereichKeys.includes(r.bereich_key));
  const nonHelper = inBereich.filter((r) => r.anforderungsniveau !== 1);
  let candidates = nonHelper.length > 0 ? nonHelper : inBereich;
  if (candidates.length === 0) return [];

  const origin = estimateOrigin(params.activityIds, roles, params.qualification ?? null);
  const target = targetNiveauFor(params.goal, origin);
  const isAscent = params.goal === "weiterkommen" || params.goal === "knowhow" || params.goal === "fuehrung";
  if (isAscent) {
    // Aufstieg heisst: mindestens das Zielniveau. Gibt es im Bereich nichts
    // auf diesem Niveau, wenigstens nicht unter dem heutigen.
    const atTarget = candidates.filter((r) => (r.anforderungsniveau ?? 2) >= target);
    const notBelow = origin.niveau ? candidates.filter((r) => (r.anforderungsniveau ?? 2) >= origin.niveau!) : candidates;
    if (atTarget.length > 0) candidates = atTarget;
    else if (notBelow.length > 0) candidates = notBelow;
  }
  const offered = params.offeredRoleIds ?? new Set<string>();
  const derived = deriveSkillsFromActivities(params.activityIds);
  const matchById = new Map(
    suggestRolesForSkillIds(new Set(derived.keys()), { roles: candidates, limit: candidates.length, minMatchPercentage: 0.1 }).map(
      (s) => [s.role_id, s.match_percentage] as const,
    ),
  );

  const scored = candidates.map((role) => {
    const niv = role.anforderungsniveau ?? 2;
    const niveauFit = 1 - Math.min(3, Math.abs(niv - target)) / 3;
    const experienceMatch = matchById.get(role.role_id) ?? 0;
    const goalBonus = params.goal === "fuehrung" && (role.level === "Führung" || (role.anforderungsniveau ?? 0) >= 3) ? 1 : 0;
    const offerBonus = offered.has(role.role_id) ? 1 : 0;
    const score = 0.45 * niveauFit + 0.3 * Math.min(1, experienceMatch / 40) + 0.15 * offerBonus + 0.1 * goalBonus;
    return { role, score: Math.round(score * 1000) / 1000, experienceMatch };
  });
  scored.sort((a, b) => b.score - a.score || a.role.role_id.localeCompare(b.role.role_id));

  // Bei zwei Bereichen: aus jedem mindestens den besten Beruf nehmen, damit
  // die Wahl der Person sichtbar Wirkung hat.
  const picked: DirectionCandidate[] = [];
  for (const key of params.bereichKeys) {
    const best = scored.find((s) => s.role.bereich_key === key);
    if (best && !picked.includes(best)) picked.push(best);
  }
  const top = scored[0];
  for (const s of scored) {
    if (picked.length >= max) break;
    if (picked.includes(s)) continue;
    // Nur fachlich Zusammenhaengendes dazunehmen, und nur, wenn es nicht
    // deutlich schlechter passt als der beste Beruf.
    const coherent = roleOverlap(top.role, s.role) >= 0.2 || roleOverlap(s.role, top.role) >= 0.2;
    if (coherent && s.score >= top.score * 0.8) picked.push(s);
  }
  return picked.slice(0, max).sort((a, b) => b.score - a.score || a.role.role_id.localeCompare(b.role.role_id));
}

/**
 * Pseudo-Rolle fuer Gap-Analyse und Kursmatching aus den eingegrenzten
 * Berufen — baut auf buildBereichRole() auf (gleiches Format, gleiche
 * Normierung), aber nur ueber 2–3 passende Berufe statt ueber den ganzen
 * Bereich. role_id bekommt einen ":n=<ids>"-Suffix, damit eine andere
 * Eingrenzung nie als "gleiche Rolle" erkannt und uebersprungen wird (der
 * Praefix "bereich:<keys>" bleibt fuer resolveLeadTargetRoleId() lesbar).
 */
export function buildDirectionRole(bereichKeys: string[], narrowed: DirectionCandidate[], goal: string | null): CatalogRole {
  const narrowedRoles = narrowed.map((n) => n.role);
  // goal bewusst NICHT weitergeben: das Ziel ist in narrowDirection() schon
  // eingeflossen; ein zweiter Level-Filter wuerde die 2–3 Berufe unnoetig
  // weiter ausduennen.
  void goal;
  const base = buildBereichRole(bereichKeys, narrowedRoles.length > 0 ? narrowedRoles : undefined, null);
  const suffix = narrowedRoles.length > 0 ? `:n=${narrowedRoles.map((r) => r.role_id).sort().join("+")}` : "";
  return { ...base, role_id: `${base.role_id}${suffix}` };
}

// ---------------------------------------------------------------------------
// 3./4. Kurz-Check: welche Skills fragen, welche sind schon belegt
// ---------------------------------------------------------------------------

export type QuickAnswer = "ja" | "etwas" | "nein";

export interface QuickCheckItem {
  skill_id: string;
  name: string;
  weight: number;
  /** Frage in Alltagssprache. */
  question: string;
  /** Kleine Hilfe unter der Frage. */
  hint: string;
  /** Taetigkeit, die den Skill nur teilweise belegt — als freundlicher Hinweis. */
  partialFromActivity: string | null;
}

export interface ActivityEvidence {
  skill_id: string;
  name: string;
  weight: number;
  sourceLabels: string[];
}

/** Umkehr-Index: Skill -> erste Taetigkeit, die ihn DIREKT belegt. */
const DIRECT_ACTIVITY_BY_SKILL: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const f of ACTIVITY_FIELDS) {
    for (const a of f.activities) {
      for (const l of a.skills) if (l.strength === "direkt" && !m.has(l.skill_id)) m.set(l.skill_id, a.label);
    }
  }
  return m;
})();

/**
 * Alltagsfrage fuer einen Skill. Gibt es eine Taetigkeit, die den Skill
 * direkt beschreibt, wird deren Formulierung genutzt (die Taetigkeits-Labels
 * sind bereits Alltagssprache) — sonst eine neutrale Frage mit dem
 * Skill-Namen. Keine erfundenen Beschreibungen.
 */
export function quickCheckQuestion(skillId: string, skillName: string): { question: string; hint: string } {
  const activity = DIRECT_ACTIVITY_BY_SKILL.get(skillId);
  if (activity) {
    return { question: `„${activity}“ – hast du das schon gemacht?`, hint: "Auch Aushilfe, Praktikum oder Ehrenamt zählt." };
  }
  return { question: `Hast du schon mit „${skillName}“ gearbeitet?`, hint: "Denk an Job, Ausbildung, Praktikum oder Ehrenamt." };
}

/**
 * Teilt die Skills der Richtungs-Rolle auf in
 *  - evidence: durch Taetigkeiten DIREKT belegt (keine Frage, im Ergebnis
 *    sichtbar und korrigierbar),
 *  - questions: hoechstens `max` Kern-Skills, die NICHT direkt belegt sind,
 *    nach Gewicht absteigend.
 * Kern = Skills bis 70 % des kumulierten Gewichts (gleiche ABC/Pareto-Logik
 * wie pickCoreQuestionSkills/classifyPriority). Reicht der Kern nicht fuer
 * mindestens 3 Fragen, wird mit den naechstwichtigen Skills aufgefuellt.
 */
export function planQuickCheck(
  directionRole: CatalogRole,
  activityIds: string[],
  max = 5,
  /** Optional: eigene Alltagsformulierungen (z. B. aus einem kuratierten
   *  Fragen-Katalog). Liefert null -> Standard aus quickCheckQuestion(). */
  questionFor?: (skillId: string, skillName: string) => { question: string; hint: string } | null,
): { questions: QuickCheckItem[]; evidence: ActivityEvidence[] } {
  const derived = deriveSkillsFromActivities(activityIds, new Set(directionRole.skills.map((s) => s.skill_id)));
  const sorted = [...directionRole.skills].sort((a, b) => b.weight - a.weight || a.skill_id.localeCompare(b.skill_id));
  const total = sorted.reduce((sum, s) => sum + s.weight, 0) || 1;

  const evidence: ActivityEvidence[] = [];
  for (const s of sorted) {
    const d = derived.get(s.skill_id);
    if (d?.strength === "direkt") {
      evidence.push({
        skill_id: s.skill_id,
        name: s.name,
        weight: s.weight,
        sourceLabels: d.source_activity_ids.map((id) => getActivity(id)?.label).filter((l): l is string => !!l),
      });
    }
  }
  const evidenceIds = new Set(evidence.map((e) => e.skill_id));

  const kernIds = new Set<string>();
  let running = 0;
  for (const s of sorted) {
    if (running >= total * 0.7) break;
    kernIds.add(s.skill_id);
    running += s.weight;
  }
  const open = sorted.filter((s) => !evidenceIds.has(s.skill_id));
  const kernOpen = open.filter((s) => kernIds.has(s.skill_id));
  const pool = kernOpen.length >= 3 ? kernOpen : [...kernOpen, ...open.filter((s) => !kernIds.has(s.skill_id))];

  const questions: QuickCheckItem[] = pool.slice(0, max).map((s) => {
    const { question, hint } = questionFor?.(s.skill_id, s.name) ?? quickCheckQuestion(s.skill_id, s.name);
    const d = derived.get(s.skill_id);
    const partialFrom = d?.strength === "teilweise" ? getActivity(d.source_activity_ids[0])?.label ?? null : null;
    return { skill_id: s.skill_id, name: s.name, weight: s.weight, question, hint, partialFromActivity: partialFrom };
  });
  return { questions, evidence };
}

/** Kurz-Check-Antwort -> Tiefe im bestehenden Scoring (siehe quizSkillScore
 *  in JourneyPage: fortgeschritten·aktuell = 80, grundkenntnisse·aktuell = 55). */
export function quickAnswerToDepth(
  answer: QuickAnswer,
): { proficiency: "fortgeschritten" | "grundkenntnisse"; recency: "aktuell" | "letzte_jahre" } | null {
  if (answer === "ja") return { proficiency: "fortgeschritten", recency: "aktuell" };
  if (answer === "etwas") return { proficiency: "grundkenntnisse", recency: "aktuell" };
  return null;
}

/** Tiefe fuer taetigkeits-belegte Skills: fortgeschritten, aber Aktualitaet
 *  unbekannt -> konservativ "letzte_jahre" (Score 72 statt 80). */
export const EVIDENCE_DEPTH = { proficiency: "fortgeschritten", recency: "letzte_jahre" } as const;

// ---------------------------------------------------------------------------
// 5. "Fuehrt zu: …" – Berufe zu einem Kurs
// ---------------------------------------------------------------------------

export interface CourseRoleLink {
  role: CatalogRole;
  source: "zuordnung" | "weiterbildung" | "skills";
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\/(in|innen|frau|-frau)\b/g, "")
    .replace(/[^a-zäöüß0-9]+/g, " ")
    .trim();
}

/**
 * Zu welchen Berufen fuehrt ein Kurs? In dieser Reihenfolge, erste Quelle
 * mit Treffer gewinnt:
 *  1. "zuordnung": im Dashboard gesetzte target_role_ids/target_role_id,
 *  2. "weiterbildung": Kursname enthaelt die typische_weiterbildung eines
 *     Berufs (z. B. Kurs "Geprüfter Wirtschaftsfachwirt (IHK)" ->
 *     Kaufmaennische/r Teamleiter/in),
 *  3. "skills": der Kurs deckt mind. 30 % des gewichteten Skill-Profils
 *     eines Berufs ab.
 * Bevorzugt Berufe aus preferRoleIds (eingegrenzte Richtung). Maximal `max`.
 */
export function rolesForCourse(
  course: { course_name: string; target_role_id?: string | null; target_role_ids?: string[] | null; covered_skill_uris?: string[] | null },
  roles: CatalogRole[] = ROLES_CATALOG,
  opts: { preferRoleIds?: ReadonlySet<string>; max?: number } = {},
): CourseRoleLink[] {
  const max = opts.max ?? 2;
  const prefer = opts.preferRoleIds ?? new Set<string>();
  const byPreference = (a: CatalogRole, b: CatalogRole) =>
    Number(prefer.has(b.role_id)) - Number(prefer.has(a.role_id)) ||
    (b.anforderungsniveau ?? 2) - (a.anforderungsniveau ?? 2) ||
    a.role_id.localeCompare(b.role_id);

  const ids = new Set([...(course.target_role_ids ?? []), ...(course.target_role_id ? [course.target_role_id] : [])]);
  const assigned = roles.filter((r) => ids.has(r.role_id)).sort(byPreference);
  if (assigned.length > 0) return assigned.slice(0, max).map((role) => ({ role, source: "zuordnung" }));

  const courseTitle = normalizeTitle(course.course_name);
  const byTraining = roles
    .filter((r) => {
      if (!r.typische_weiterbildung) return false;
      const t = normalizeTitle(r.typische_weiterbildung.split(" / ")[0]);
      return t.length >= 6 && courseTitle.includes(t);
    })
    .sort(byPreference);
  if (byTraining.length > 0) return byTraining.slice(0, max).map((role) => ({ role, source: "weiterbildung" }));

  const covered = new Set(course.covered_skill_uris ?? []);
  if (covered.size === 0) return [];
  const bySkills = suggestRolesForSkillIds(covered, { roles, limit: roles.length, minMatchPercentage: 30 })
    .map((s) => roles.find((r) => r.role_id === s.role_id))
    .filter((r): r is CatalogRole => !!r && r.anforderungsniveau !== 1)
    // Reihenfolge = Passung (suggestRolesForSkillIds sortiert absteigend);
    // bevorzugte Berufe (eingegrenzte Richtung) nur nach vorn ziehen.
    .sort((a, b) => Number(prefer.has(b.role_id)) - Number(prefer.has(a.role_id)));
  return bySkills.slice(0, max).map((role) => ({ role, source: "skills" }));
}