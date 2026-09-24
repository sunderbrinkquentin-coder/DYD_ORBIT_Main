/**
 * Journey v2 – Ergebnis-Pitch pro Kurs (24.09.2026), reine Logik ohne UI.
 * Konzept: Projekt-Doc journey-v2-konzept-2026-09-24.md, Bildschirm 6.
 *
 * Auftrag (Quentin): "Bei den Vorschlaegen am Ende sollen auch die Rollen
 * vermerkt werden, die man am Ende erreichen kann, und was jetzt eine Stufe
 * davor ist — und der Pitch dafuer muss perfekt und individuell sein."
 *
 * Umsetzung:
 *  1. Karriereleiter je Kurs:
 *     - "Mit diesem Kurs": Beruf, zu dem der Kurs fuehrt (rolesForCourse).
 *     - Ist das eine Stufe UNTER dem Beruf, auf den die Person zielt, wird
 *       der Kurs ehrlich als Zwischenschritt gezeigt: "Zwischenstufe:
 *       Fachlagerist/in -> dein Ziel: Fachkraft fuer Lagerlogistik".
 *     - Sonst "Danach moeglich": der naechste Beruf eine Niveaustufe hoeher
 *       im selben Bereich mit fachlicher Naehe.
 *  2. Individueller Pitch nach ARCS (Attention/Relevance/Confidence/
 *     Satisfaction), zusammengesetzt NUR aus echten Daten: den Taetigkeiten
 *     der Person (in ihren eigenen Worten), ihren Kurz-Check-Antworten, den
 *     vom Kurs tatsaechlich abgedeckten Luecken und den Rahmendaten des Kurses.
 *     Kein Satz behauptet etwas, das nicht in den Daten steht (keine
 *     erfundenen Gehaelter, Quoten oder Garantien). Fehlt eine Angabe, fehlt
 *     die Zeile — sie wird nicht mit Floskeln aufgefuellt.
 */

import { ROLES_CATALOG, type CatalogRole } from "./rolesCatalog";
import {
  rolesForCourse,
  type ActivityEvidence,
  type DirectionCandidate,
  type QuickAnswer,
  type CourseRoleLink,
} from "./journeyFlow";

export const NIVEAU_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: "Einstieg",
  2: "Fachkraft",
  3: "Spezialist/in",
  4: "Leitung / Expert/in",
};

/** Situation aus Bildschirm 5 ("Dein Rahmen") — steuert die Foerder-Zeile. */
export type Situation = "beschaeftigt" | "arbeitsuchend" | "transfer" | "ausbildung";

export interface PitchCourse {
  course_id: string;
  course_name: string;
  provider?: string | null;
  duration_weeks?: number | null;
  covered_skill_uris?: string[] | null;
  target_role_id?: string | null;
  target_role_ids?: string[] | null;
  employment_mode?: "vollzeit" | "teilzeit" | "beides" | null;
  location_mode?: "remote" | "vor_ort" | "hybrid" | null;
  location?: string | null;
  starts_at?: string | null;
  funding_types?: string[] | null;
  funding_measure_number?: string | null;
  qualification_type?: string | null;
  dqr_level?: number | null;
}

export interface PitchContext {
  goal: string | null;
  situation: Situation | null;
  /** Wunsch aus Bildschirm 5. */
  employmentPref: "vollzeit" | "teilzeit" | "egal" | null;
  startPref: "asap" | "4-wochen" | "1-3-monate" | "offen" | null;
  /** Eingegrenzte Richtung (narrowDirection), bester Beruf zuerst. */
  direction: DirectionCandidate[];
  /** Durch Taetigkeiten belegte Skills (planQuickCheck().evidence). */
  evidence: ActivityEvidence[];
  /** Kurz-Check-Antworten je skill_id. */
  answers: ReadonlyMap<string, QuickAnswer>;
  /** Skills der Richtungs-Rolle mit Gewicht (buildDirectionRole().skills). */
  directionSkills: { skill_id: string; name: string; weight: number }[];
  /** Angeklickte Taetigkeiten (fuer Fuehrungs-Erfahrung im Pitch). */
  activityIds?: string[];
  /** Bereichs-Label fuer Formulierungen ohne Beruf. */
  bereichLabel?: string | null;
  roles?: CatalogRole[];
  /** Fuer Tests: "heute". */
  now?: Date;
}

export interface LadderStep {
  role_id: string;
  role_name: string;
  niveauLabel: string | null;
  typische_weiterbildung: string | null;
}

export interface CareerLadder {
  /** Beruf, zu dem der Kurs fuehrt. */
  reach: LadderStep | null;
  /** Woher wir das wissen — fuer ehrliche Formulierung ("fuehrt zu" vs. "bereitet vor auf"). */
  reachSource: CourseRoleLink["source"] | null;
  /** true: Kurs ist eine Stufe VOR dem Zielberuf der Person. */
  isSteppingStone: boolean;
  /** Bei Zwischenschritt: der Zielberuf; sonst der naechste Beruf danach. */
  then: LadderStep | null;
}

export interface CoursePitch {
  ladder: CareerLadder;
  /** Attention: eine Zeile, die sofort sagt, was dieser Kurs fuer DICH ist. */
  headline: string;
  /** Relevance 1: worauf der Kurs bei dir aufbaut (deine eigenen Worte). */
  because: string | null;
  /** Relevance 2: welche deiner Luecken er schliesst (max. 3). */
  closes: { line: string; skills: string[] } | null;
  /** Confidence: harte Rahmendaten, die zu deinem Wunsch passen. */
  fit: string[];
  /** Confidence: Foerderhinweis, nur wenn am Kurs hinterlegt und zur Situation passend. */
  funding: string | null;
  /** Satisfaction: Ausblick ("Danach moeglich" / "Dein Ziel danach"). */
  outlook: string | null;
  /** Satisfaction: Button-Text. */
  cta: string;
  /** Anteil (0–100) deines offenen Luecken-Gewichts, den der Kurs abdeckt — fuer Sortierung/Badge. */
  gapCoverage: number;
}

// ---------------------------------------------------------------------------
// Karriereleiter
// ---------------------------------------------------------------------------

function toStep(role: CatalogRole): LadderStep {
  return {
    role_id: role.role_id,
    role_name: role.role_name,
    niveauLabel: role.anforderungsniveau ? NIVEAU_LABELS[role.anforderungsniveau] : null,
    typische_weiterbildung: role.typische_weiterbildung ?? null,
  };
}

function overlap(a: CatalogRole, b: CatalogRole): number {
  const ids = new Set(b.skills.map((s) => s.skill_id));
  const total = a.skills.reduce((sum, s) => sum + s.weight, 0) || 1;
  return a.skills.filter((s) => ids.has(s.skill_id)).reduce((sum, s) => sum + s.weight, 0) / total;
}

/**
 * Naechster Beruf eine Niveaustufe hoeher im selben Bereich, fachlich nah
 * (mind. 20 % des Skill-Gewichts des Folgeberufs sind schon im Ausgangsberuf
 * enthalten). Bevorzugt Berufe aus der Richtung der Person.
 */
export function nextRoleAfter(role: CatalogRole, roles: CatalogRole[] = ROLES_CATALOG, prefer: ReadonlySet<string> = new Set()): CatalogRole | null {
  const niv = role.anforderungsniveau;
  if (!niv || niv >= 4) return null;
  const candidates = roles
    .filter((r) => r.bereich_key === role.bereich_key && r.anforderungsniveau === niv + 1 && r.role_id !== role.role_id)
    .map((r) => ({ r, o: overlap(r, role) }))
    .filter((x) => x.o >= 0.2)
    .sort((a, b) => Number(prefer.has(b.r.role_id)) - Number(prefer.has(a.r.role_id)) || b.o - a.o || a.r.role_id.localeCompare(b.r.role_id));
  return candidates[0]?.r ?? null;
}

export function careerLadderForCourse(course: PitchCourse, ctx: Pick<PitchContext, "direction" | "roles">): CareerLadder {
  const roles = ctx.roles ?? ROLES_CATALOG;
  const prefer = new Set(ctx.direction.map((d) => d.role.role_id));
  const links = rolesForCourse(course, roles, { preferRoleIds: prefer, max: 2 });
  const reachRole = links[0]?.role ?? null;
  if (!reachRole) return { reach: null, reachSource: null, isSteppingStone: false, then: null };

  const target = ctx.direction[0]?.role ?? null;
  // Zwischenstufe, wenn der Kurs-Beruf im selben Bereich liegt und
  //  a) eine Niveaustufe unter dem Zielberuf liegt, ODER
  //  b) auf gleichem Niveau fast vollstaendig im Zielberuf enthalten ist
  //     (>= 65 % seines Skill-Gewichts, weniger Skills) — typische
  //     Anrechnungs-Paare wie Fachlagerist/in -> Fachkraft fuer Lagerlogistik
  //     oder Verkaeufer/in -> Kaufmann/-frau im Einzelhandel, die in der KldB
  //     beide "Fachkraft" sind.
  const sameBereich = !!target && target.role_id !== reachRole.role_id && target.bereich_key === reachRole.bereich_key;
  const lowerLevel = sameBereich && (reachRole.anforderungsniveau ?? 2) < (target!.anforderungsniveau ?? 2);
  const subProfile =
    sameBereich &&
    (reachRole.anforderungsniveau ?? 2) === (target!.anforderungsniveau ?? 2) &&
    reachRole.skills.length <= target!.skills.length &&
    overlap(reachRole, target!) >= 0.65;
  const isSteppingStone = lowerLevel || subProfile;
  const thenRole = isSteppingStone ? target : nextRoleAfter(reachRole, roles, prefer);
  return { reach: toStep(reachRole), reachSource: links[0].source, isSteppingStone, then: thenRole ? toStep(thenRole) : null };
}

// ---------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------

/** Skill-Namen in Anfuehrungszeichen: viele enthalten selbst ein "und"
 *  ("Frachtpapiere und Versanddokumente") — ohne Quotes liest sich die
 *  Aufzaehlung sonst falsch. */
function quoted(items: string[]): string[] {
  return items.map((i) => `„${i}“`);
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} und ${items[items.length - 1]}`;
}

function daysUntil(dateIso: string | null | undefined, now: Date): number | null {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

function formatDate(dateIso: string): string {
  const d = new Date(dateIso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function headlineFor(goal: string | null, ladder: CareerLadder, bereichLabel: string | null | undefined): string {
  const reach = ladder.reach?.role_name;
  if (!reach) return bereichLabel ? `Dein nächster Schritt in ${bereichLabel}` : "Dein nächster Schritt";
  if (ladder.isSteppingStone && ladder.then) return `Dein Zwischenschritt auf dem Weg zu ${ladder.then.role_name}`;
  // Nur ueber Skill-Abdeckung erkannt (keine Zuordnung, kein Abschluss im
  // Namen): ehrlich "Richtung" statt "fuehrt zu" — ein 6-Wochen-Kurs macht
  // niemanden zur/zum Controller/in.
  if (ladder.reachSource === "skills") return `Dein Schritt in Richtung ${reach}`;
  switch (goal) {
    case "fuehrung":
      return `Dein Weg in die Verantwortung: ${reach}`;
    case "neuorientierung":
      return `Dein Neustart als ${reach}`;
    case "chancen":
      return `Mehr Chancen auf dem Arbeitsmarkt: ${reach}`;
    case "knowhow":
      return `Mehr Tiefe für deinen Beruf: ${reach}`;
    default:
      return `Dein nächster Schritt: ${reach}`;
  }
}

/** Taetigkeiten, die Verantwortung belegen (wie LEADERSHIP_ACTIVITY_IDS in journeyFlow). */
const LEADERSHIP_LABELS: Record<string, string> = {
  "verantw-team": "Ein Team oder eine Schicht geleitet",
  "verantw-einarbeiten": "Neue Kolleginnen oder Azubis eingearbeitet",
  "verantw-dienstplan": "Dienst- oder Schichtpläne erstellt",
  "verantw-budget": "Ein Budget oder Kosten verantwortet",
};

/** Relevance 1 — in den Worten der Person (Taetigkeits-Labels), max. 2.
 *  Bei Ziel "fuehrung" steht vorhandene Fuehrungserfahrung vorn. */
function becauseLine(ctx: PitchContext, courseSkillIds: ReadonlySet<string>): string | null {
  const leadership =
    ctx.goal === "fuehrung" ? (ctx.activityIds ?? []).map((id) => LEADERSHIP_LABELS[id]).filter((l): l is string => !!l) : [];
  // Bevorzugt Taetigkeiten, deren Skills der Kurs weiterfuehrt — sonst die
  // mit dem hoechsten Gewicht in der Richtung.
  const weightById = new Map(ctx.directionSkills.map((s) => [s.skill_id, s.weight] as const));
  const ranked = [...ctx.evidence].sort(
    (a, b) =>
      Number(courseSkillIds.has(b.skill_id)) - Number(courseSkillIds.has(a.skill_id)) ||
      (weightById.get(b.skill_id) ?? 0) - (weightById.get(a.skill_id) ?? 0),
  );
  const labels: string[] = leadership.slice(0, 1);
  for (const e of ranked) for (const l of e.sourceLabels) if (!labels.includes(l) && labels.length < 2) labels.push(l);
  // "Darauf baut dieser Kurs auf" nur, wenn der Kurs nachweislich an
  // Skills der Richtung anknuepft — sonst waere es eine Behauptung ohne Beleg.
  const buildsOn = ctx.directionSkills.some((s) => courseSkillIds.has(s.skill_id));
  const tail = buildsOn ? "Darauf baut dieser Kurs auf." : "Diese Erfahrung nimmst du mit.";
  if (labels.length > 0) {
    return `Du bringst schon Praxis mit: ${joinList(quoted(labels))}. ${tail}`;
  }
  const yes = ctx.directionSkills.filter((s) => ctx.answers.get(s.skill_id) === "ja").slice(0, 2).map((s) => s.name);
  if (yes.length > 0) return `Du hast schon Erfahrung mit ${joinList(quoted(yes))}. ${tail}`;
  return null;
}

type GapState = "fehlt" | "etwas" | "unbekannt";

/** Luecken der Richtung, ehrlich unterschieden:
 *  - "fehlt": im Kurz-Check mit "Noch nicht" beantwortet,
 *  - "etwas": mit "Ein bisschen" beantwortet,
 *  - "unbekannt": nicht gefragt und nicht durch Taetigkeiten belegt.
 *  Nur "fehlt"/"etwas" duerfen als "fehlt dir noch" formuliert werden. */
function openGaps(ctx: PitchContext): { skill_id: string; name: string; weight: number; state: GapState }[] {
  const evidenceIds = new Set(ctx.evidence.map((e) => e.skill_id));
  return ctx.directionSkills
    .filter((s) => !evidenceIds.has(s.skill_id) && ctx.answers.get(s.skill_id) !== "ja")
    .map((s) => {
      const a = ctx.answers.get(s.skill_id);
      return { ...s, state: (a === "nein" ? "fehlt" : a === "etwas" ? "etwas" : "unbekannt") as GapState };
    });
}

function fundingLine(course: PitchCourse, situation: Situation | null): string | null {
  const types = new Set(course.funding_types ?? []);
  const measure = course.funding_measure_number ? ` (Maßnahme-Nr. ${course.funding_measure_number})` : "";
  if ((situation === "arbeitsuchend" || situation === "transfer") && types.has("bildungsgutschein")) {
    return situation === "transfer"
      ? `Mit Bildungsgutschein förderfähig${measure} – in der Transfergesellschaft klären wir die Finanzierung gemeinsam mit dir.`
      : `Mit Bildungsgutschein der Agentur für Arbeit förderfähig${measure} – die Kosten können komplett übernommen werden.`;
  }
  if (situation === "beschaeftigt" || situation === null) {
    if (types.has("aufstiegs_bafoeg")) return "Mit Aufstiegs-BAföG förderfähig – ein Teil der Kosten ist ein Zuschuss, den du nicht zurückzahlst.";
    if (types.has("bildungsurlaub")) return "Als Bildungsurlaub anerkannt – je nach Bundesland bekommst du dafür bezahlt frei.";
  }
  if (types.has("laenderfoerderung")) return "Eine Förderung über dein Bundesland ist möglich.";
  if (types.has("bildungsgutschein")) return `Mit Bildungsgutschein förderfähig${measure}.`;
  if (types.has("aufstiegs_bafoeg")) return "Mit Aufstiegs-BAföG förderfähig.";
  return null;
}

function fitLines(course: PitchCourse, ctx: PitchContext): string[] {
  const out: string[] = [];
  const now = ctx.now ?? new Date();
  const em = course.employment_mode;
  if (em && ctx.employmentPref && ctx.employmentPref !== "egal") {
    const ok = em === "beides" || em === ctx.employmentPref;
    const wish = ctx.employmentPref === "vollzeit" ? "Vollzeit" : "Teilzeit / berufsbegleitend";
    out.push(ok ? `${wish} – wie du es wolltest` : `Wird nur in ${em === "vollzeit" ? "Vollzeit" : "Teilzeit"} angeboten`);
  } else if (em) {
    out.push(em === "beides" ? "In Vollzeit oder Teilzeit möglich" : em === "vollzeit" ? "Vollzeit" : "Teilzeit / berufsbegleitend");
  }
  const days = daysUntil(course.starts_at, now);
  if (days !== null && days >= 0) {
    const soon = ctx.startPref === "asap" && days <= 30 ? " – passt zu „so schnell wie möglich“" : "";
    out.push(days <= 14 ? `Start schon in ${days} Tag${days === 1 ? "" : "en"}${soon}` : `Start am ${formatDate(course.starts_at!)}${soon}`);
  }
  if (course.duration_weeks && course.duration_weeks > 0) {
    out.push(course.duration_weeks >= 9 ? `Dauer ca. ${Math.round(course.duration_weeks / 4.33)} Monate` : `Dauer ${course.duration_weeks} Wochen`);
  }
  if (course.location_mode === "remote") out.push("Online – von zu Hause aus");
  else if (course.location_mode === "hybrid") out.push(course.location ? `Online und vor Ort in ${course.location}` : "Online und vor Ort");
  else if (course.location_mode === "vor_ort" && course.location) out.push(`Vor Ort in ${course.location}`);
  if (course.qualification_type === "ihk_pruefung") out.push("Mit IHK-Abschluss");
  if (course.dqr_level) out.push(`DQR-Niveau ${course.dqr_level}`);
  return out;
}

export function buildCoursePitchV2(course: PitchCourse, ctx: PitchContext): CoursePitch {
  const ladder = careerLadderForCourse(course, ctx);
  const courseSkillIds = new Set(course.covered_skill_uris ?? []);

  const gaps = openGaps(ctx);
  // Gewichtung fuer die Abdeckung: bestaetigte Luecke 1, "ein bisschen" 0,5,
  // unbekannt 0,5 (koennte fehlen, ist aber nicht bestaetigt).
  const factor = (st: GapState) => (st === "fehlt" ? 1 : 0.5);
  const gapTotal = gaps.reduce((sum, g) => sum + g.weight * factor(g.state), 0);
  const coveredGaps = gaps.filter((g) => courseSkillIds.has(g.skill_id)).sort((a, b) => b.weight - a.weight);
  const gapCoverage = gapTotal > 0 ? Math.round((coveredGaps.reduce((sum, g) => sum + g.weight * factor(g.state), 0) / gapTotal) * 100) : 0;

  let closes: CoursePitch["closes"] = null;
  if (coveredGaps.length > 0) {
    const missing = coveredGaps.filter((g) => g.state === "fehlt").slice(0, 3).map((g) => g.name);
    const deepen = coveredGaps.filter((g) => g.state === "etwas").slice(0, Math.max(0, 3 - missing.length)).map((g) => g.name);
    const also = coveredGaps
      .filter((g) => g.state === "unbekannt")
      .slice(0, Math.max(0, 3 - missing.length - deepen.length))
      .map((g) => g.name);
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`Du lernst genau, was dir noch fehlt: ${joinList(quoted(missing))}.`);
    if (deepen.length > 0) parts.push(`${missing.length > 0 ? "Und du vertiefst" : "Du vertiefst"}, was du schon ein bisschen kannst: ${joinList(quoted(deepen))}.`);
    if (also.length > 0) parts.push(`${parts.length > 0 ? "Außerdem im Kurs" : "Im Kurs"}: ${joinList(quoted(also))}.`);
    closes = { line: parts.join(" "), skills: [...missing, ...deepen, ...also] };
  }

  let outlook: string | null = null;
  if (ladder.isSteppingStone && ladder.then) {
    outlook = `Danach bist du eine Stufe näher an deinem Ziel: ${ladder.then.role_name}${
      ladder.then.typische_weiterbildung ? ` (z. B. über ${ladder.then.typische_weiterbildung})` : ""
    }.`;
  } else if (ladder.then) {
    outlook = `Danach möglich: ${ladder.then.role_name}${ladder.then.niveauLabel ? ` (${ladder.then.niveauLabel})` : ""}.`;
  }

  const funding = fundingLine(course, ctx.situation);
  const cta = funding ? "Förderung & Starttermin prüfen lassen" : "Starttermin & Details anfragen";

  return {
    ladder,
    headline: headlineFor(ctx.goal, ladder, ctx.bereichLabel),
    because: becauseLine(ctx, courseSkillIds),
    closes,
    fit: fitLines(course, ctx),
    funding,
    outlook,
    cta,
    gapCoverage,
  };
}