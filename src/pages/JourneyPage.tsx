import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  ESCO_LANG,
  extractDocumentText,
  fetchGapAnalysis,
  fetchTargetRoles,
  type GapAnalysisResponse,
  type RoleSkillStatus,
  type TargetRole,
} from "../api/core";
import {
  attachTestRecommendation,
  createLead,
  createTest,
  depthAnalysisBaseUrl,
  fetchCourseMatch,
  fetchCourses,
  fetchDepthAnalysis,
  getCourseSessions,
  isCourseActive,
  isSessionUpcoming,
  nextUpcomingSession,
  setLeadLinkedCourses,
  type CourseMatchResponse,
  type CourseRecommendation,
  type CourseSession,
  type DepthSkillAssessment,
  type OrbitCourse,
} from "../api/orbit";
import {
  analyzeGap,
  buildBereichRole,
  listBereiche,
  rolesWithBereichCoverage,
  toTargetRoleSummary,
  topSkillsForRoles,
  type BereichOption,
  type GapAnalysisResult,
  type GapRoleSkillStatus,
} from "../data/gapAnalysis";
import { ROLES_CATALOG, SKILLS_CATALOG, type CatalogRole } from "../data/rolesCatalog";
import {
  getCoveredBereiche,
  matchCoursesToGap,
  describePreferenceMismatches,
  rankCoursesForGap,
  QUALIFICATION_LABELS,
} from "../data/courseMatcher";
import { BereichBadges, CourseBadgeRow, daysUntilCourseStart } from "../data/courseBadges";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { JourneyTour, type JourneyStepKey } from "../components/JourneyTour";
import "../styles/journey.css";

type StepKey = "ziel" | "praeferenzen" | "bereich" | "zielrolle" | "skills" | "motivation" | "gap" | "kurs";

interface StepConfig {
  key: StepKey;
  label: string;
  subtitle: string;
}

interface SkillItem {
  id: string;
  label: string;
  matched: boolean;
  weight: number;
  matchedScore: number | null;
  source: "gap" | "manual" | "questionnaire";
}

interface CourseItem {
  id: string;
  name: string;
  provider?: string | null;
  durationWeeks: number;
  gapPercentage: number;
  gapCount: number;
  richnessScore: number;
}

/** Nur fuer den gefuehrten Rundgang (JourneyTour, siehe runDemoAnalysis
 * unten): Rolle + Beispielprofil, damit die Schritte "Skill-Gap" und
 * "Kurs" im Rundgang auch OHNE vorherigen echten Durchlauf etwas zu zeigen
 * haben. Bewusst die Rolle, fuer die per SQL Demo-Kurse angelegt wurden
 * (siehe add-demo-courses.sql), und ein Beispieltext, der wortwoertlich die
 * drei ESCO-Skill-Bezeichnungen dieser Rolle enthaelt (live gegen
 * /api/v1/gap-analysis geprueft) - kein erfundenes Ergebnis, sondern ein
 * echter, live berechneter Abgleich mit einem erkennbar als Beispiel
 * markierten Text. */
// Rollen-Katalog-Ueberarbeitung (14.09.): "it-tech-junior-web-developer" wurde
// im neuen, IHK-ausgerichteten Rollen-Katalog in
// "it-tech-it-berufsspezialist-softwareentwicklung-ihk" ueberfuehrt (siehe
// Migrations-Tabelle in rolesCatalog.ts-Uebergabe an Quentin vom 14.09.2026) -
// DEMO_ROLE_ID daher hierher nachgezogen, sonst wuerde der Tour-Demo-Pfad auf
// eine nicht mehr existierende role_id zeigen. ACHTUNG QUENTIN: falls
// add-demo-courses.sql in Supabase Kurse mit target_role_id
// "it-tech-junior-web-developer" angelegt hat, bitte auf die neue role_id
// umstellen (Migrations-Tabelle beachten).
const DEMO_ROLE_ID = "it-tech-it-berufsspezialist-softwareentwicklung-ihk";
const DEMO_ROLE_NAME = "IT-Berufsspezialist Softwareentwicklung (IHK)";
const DEMO_CV_TEXT =
  "Beispielprofil für den Rundgang: Erfahrung in der Softwareentwicklung " +
  "und im Schreiben von eigenem Code. Sicherer Umgang mit Git zur " +
  "Versionskontrolle im Team. Erste Erfahrung im Testing eigener " +
  "Funktionen, bevor sie ausgeliefert werden.";

/**
 * Round 21 (18.09., Rückmeldung "bei der Journey sollen konkrete Kurse mit
 * allen vorhandenen Daten sichtbar sein"): Bewertet einen echten Kurs danach,
 * WIE VIELE der optionalen Zusatzfelder (Preis, Förderung, Abschlussart, UE,
 * Buchungslink, Standort, Beschäftigungsart, Start, Zielgruppe, Skills)
 * tatsächlich gepflegt sind. Grundlage für pickShowcaseCourses() unten — für
 * den Rundgang soll die Kurskarte im Schritt "Passende Weiterbildung"
 * möglichst VIELE echte Datenfelder zeigen, nicht nur irgendeinen Treffer.
 */
function courseRichnessScore(course: OrbitCourse): number {
  let score = 0;
  if (course.description?.trim()) score += 1;
  if (course.price_eur != null) score += 1;
  if (course.teaching_units != null) score += 1;
  if (course.funding_types && course.funding_types.length > 0) score += 1;
  if (course.qualification_type) score += 1;
  if (course.dqr_level != null) score += 1;
  if (course.booking_url) score += 1;
  if (course.location_mode || course.location) score += 1;
  if (course.employment_mode) score += 1;
  if (course.starts_at) score += 1;
  if (course.seats_remaining != null) score += 1;
  if (course.target_group?.trim()) score += 1;
  if ((course.bereich_keys && course.bereich_keys.length > 0) || course.bereich_key) score += 1;
  if (course.covered_skill_uris && course.covered_skill_uris.length > 0) score += 1;
  return score;
}

/**
 * Round 21 — Ersatz für den früheren, komplett erfundenen Kurs-Fallback in
 * runDemoAnalysis() unten ("DYD Akademie", frei erfundene Match-Werte, dazu
 * mit falschen Feldnamen (title/match_score/duration statt course_name/
 * duration_weeks) befüllt — dadurch blieb der Kurstitel auf der Kurskarte im
 * Rundgang schlicht LEER, weil KursStep course.course_name liest, siehe
 * course-hero-name weiter unten). Wählt stattdessen bis zu `limit` ECHTE
 * Kurse aus dem eigenen Katalog (allCourses), sortiert nach
 * courseRichnessScore() statt nach Aktualität/Top-Markierung wie beim echten
 * "Nie leer"-Sicherheitsnetz in goToKurs() — dort geht es um Verfügbarkeit,
 * hier bewusst um die vollständigste Demo-Ansicht. covers_gap_count/
 * -percentage bleiben wie beim echten Sicherheitsnetz bei 0, um keine
 * Lücken-Abdeckung vorzutäuschen, die es nicht gibt (Projekt-Prinzip "keine
 * erfundenen Zahlen/Fakten" / "Never fabricate a course", siehe Kommentar
 * beim echten Sicherheitsnetz).
 */
function pickShowcaseCourses(allCourses: OrbitCourse[], limit: number): CourseRecommendation[] {
  return allCourses
    .filter((course) => Boolean(course.course_id && course.course_name))
    .slice()
    .sort((a, b) => courseRichnessScore(b) - courseRichnessScore(a))
    .slice(0, limit)
    .map((course) => ({
      course_id: course.course_id,
      course_name: course.course_name,
      provider: course.provider,
      duration_weeks: course.duration_weeks,
      covers_gap_count: 0,
      covers_gap_percentage: 0,
      is_role_fallback: true,
    }));
}

/** Der Teil der Journey, der in beiden Pfaden identisch ist, sobald die
 * Zielrolle feststeht. */
const CORE_STEPS: StepConfig[] = [
  { key: "zielrolle", label: "Zielrolle", subtitle: "Definiere, wohin du möchtest." },
  { key: "skills", label: "Profil", subtitle: "Zeig uns, was du bereits kannst." },
  // Kurze Motivations-Zwischenseite (22.09.2026, ähnlich Taxfix & Co.)
  // zwischen Profil-Eingabe und der (dichten) Match-Auswertung — bewusst ein
  // ECHTER, gezählter Schritt im Stepper statt eines flüchtigen Overlays:
  // dieselbe Lektion wie beim Fragebogen-Pfad in GapStep ("Rückmeldung
  // 17.09.": zu schnelles Auto-Weiterspringen lässt einen Schritt nur kurz
  // aufblitzen statt sichtbar zu sein). Der Übergang wartet deshalb auf
  // einen aktiven Klick (siehe MotivationStep), kein Auto-Advance.
  { key: "motivation", label: "Geschafft", subtitle: "Dein Profil ist bereit." },
  { key: "gap", label: "Match", subtitle: "Sieh, wo du schon stark bist." },
  { key: "kurs", label: "Weiterbildung", subtitle: "Finde den nächsten passenden Schritt." },
];

/** Die urspruengliche Journey (Nutzer kennt seine Zielrolle bereits), jetzt
 * mit vorgeschaltetem "Ziel"-Schritt (Version 16: motivationale
 * Qualifizierung — siehe GOAL_OPTIONS) und direkt danach dem "Präferenzen"-
 * Schritt (Version 24: Beschäftigungsart/Arbeitsort/Startzeitpunkt, siehe
 * PraeferenzenStep). Wird 1:1 weiterverwendet, wenn im Einstiegsschritt "Ja"
 * gewaehlt wird. */
const BASE_STEPS: StepConfig[] = [
  { key: "ziel", label: "Zielbild", subtitle: "Was möchtest du als Nächstes erreichen?" },
  { key: "praeferenzen", label: "Alltag", subtitle: "Was soll zu deinem Alltag passen?" },
  ...CORE_STEPS,
];

/** Erweiterte Journey fuer Nutzer:innen, die ihre Zielrolle noch NICHT
 * kennen: nach "Ziel" und "Präferenzen" zusaetzlich ein "Bereich"-Schritt vor
 * der (dann vorgefilterten) Zielrollen-Auswahl. Danach ist der Ablauf
 * identisch zu BASE_STEPS. */
const WITH_BEREICH_STEPS: StepConfig[] = [
  { key: "ziel", label: "Zielbild", subtitle: "Was möchtest du als Nächstes erreichen?" },
  { key: "praeferenzen", label: "Alltag", subtitle: "Was soll zu deinem Alltag passen?" },
  { key: "bereich", label: "Entdeckung", subtitle: "Welcher Bereich passt zu dir?" },
  ...CORE_STEPS,
];

/** EHEMALS: grobe Berufsfelder fuer den "Ich weiss noch nicht"-Pfad
 * (Keyword-Heuristik roleMatchesArea() auf dem Rollennamen, AREAS-Konstante)
 * — entfernt (14.09., kritische Analyse). Erste Ablösung war ein
 * Freitext-Feld (suggestRolesForText()), dann eine klick-basierte Fassung mit
 * Skill-Checkboxen UND Match-Prozentsatz-Rollenkarten, dann (kurzzeitig,
 * 15.09.) eine Fassung ganz ohne Rollenkarten. Seit "das mit Rollen will ich
 * eher ergänzend haben und nicht verpflichtend" (15.09.) zeigt
 * RoleSuggestStep: Bereichs-Kacheln (Pflicht, listBereiche() in
 * gapAnalysis.ts) + eine optionale, nach careerGoal sortierte Zielrollen-
 * Auswahl + optionale Skill-Checkboxen (topSkillsForRoles()). */
/** Anzahl der Skill-Checkboxen, die RoleSuggestStep auf einmal anzeigt. */
const ROLE_SUGGEST_SKILL_CHIP_LIMIT = 8;
/** Rein dekorativ (siehe bereicheInPortfolio in JourneyPage, aus den echten
 *  bereich_key-Werten der Rollen) — Fallback-Icon fuer den unwahrscheinlichen
 *  Fall, dass der Katalog kuenftig einen neuen, hier noch unbekannten
 *  bereich_key bekommt. */
const BEREICH_ICONS: Record<string, string> = {
  "it-tech": "💻",
  wirtschaft: "📊",
  gesundheit: "🩺",
  handwerk: "🔧",
  "soziales-bildung": "🤝",
  marketing: "🎨",
};

/** Motivationale Qualifizierung ganz am Anfang der Journey (Version 16):
 * bewusst 4 Optionen statt eines starren Geld-vs-Wissen-Zweiklangs, damit
 * die haeufigsten echten Beweggruende abgedeckt sind. Fliesst (a) als
 * Zusatzmerkmal in den Lead (siehe submitLead) und (b) in den
 * personalisierten Pitch im Kurs-Schritt ein (siehe course-hero-pitch) —
 * damit die Frage fuer die Person selbst spuerbar etwas bewirkt, nicht nur
 * Statistik fuer den Bildungstraeger ist. Optional (Skip-Link in GoalStep),
 * um die Einstiegshuerde nicht zu erhoehen. */
const GOAL_OPTIONS: { key: string; label: string; icon: string }[] = [
  { key: "weiterkommen", label: "In meinem Beruf weiterkommen", icon: "🚀" },
  { key: "knowhow", label: "Meine Fachkenntnisse vertiefen", icon: "🧠" },
  { key: "neuorientierung", label: "In einen neuen Bereich wechseln", icon: "🧭" },
  { key: "fuehrung", label: "Führung übernehmen", icon: "🧑‍💼" },
  { key: "chancen", label: "Meine Chancen auf dem Arbeitsmarkt verbessern", icon: "📈" },
  { key: "unsicher", label: "Ich weiß noch nicht genau", icon: "✨" },
];

// ---------------------------------------------------------------------------
// Ziel-Personalisierung der Kursempfehlung (Version 20)
//
// Bisher wurde careerGoal (siehe GOAL_OPTIONS) nur gesammelt und tauchte als
// EIN Satz im Kurs-Schritt wieder auf (siehe course-hero-pitch) — auf die
// Reihenfolge der Kursempfehlungen selbst hatte das Ziel keinerlei Einfluss.
// Die beiden Funktionen unten aendern das, bewusst KONSERVATIV:
//
//   personalizeCourseOrder() ordnet NUR echte Gleichstaende (annaehernd
//   identische covers_gap_percentage, siehe TIE_EPSILON) nach dem Ziel um —
//   ein Kurs mit tatsaechlich besserer Skill-Abdeckung wird NIE durch das
//   Ziel nach hinten verdraengt. Die Skill-Abdeckung bleibt das primaere,
//   ehrliche Signal; das Ziel entscheidet nur den Tie-Break.
//
//   goalFitReason() liefert einen erklaerenden Satz NUR, wenn er fuer den
//   konkret gezeigten Kurs tatsaechlich zutrifft (z.B. wirklich der
//   laengste/kuerzeste/breiteste unter den gezeigten Optionen) — sonst
//   liefert sie null und es wird nichts behauptet. So bleibt die Erklaerung
//   immer wahr, nie eine erfundene Begruendung.
// ---------------------------------------------------------------------------

/** Zwei Kursempfehlungen gelten als "gleich gut" (Tie), wenn ihre
 *  covers_gap_percentage um weniger als diesen Wert auseinanderliegt. */
const GOAL_TIE_EPSILON = 1;

/** Schwelle für die "Startet bald"-Gruppe unten in KursStep (15.09., "startet
 *  innerhalb 1 Monats") — bewusst eigenständig von STARTS_SOON_DAYS
 *  (courseBadges.tsx, 21 Tage für den Badge-Text "Startet in Kürze"): hier
 *  geht es um die GRUPPIERUNG der weiteren Kurse unten, nicht um den
 *  Badge-Text auf der Karte selbst. */
const POPULAR_SOON_START_DAYS = 30;

/** Initial sichtbare Karten je Sektion ("Vorhanden"/"Noch zu lernen") in
 *  GapStep (15.09., "dadurch, dass das jetzt mehr sind, soll da nicht so
 *  eine ewig lange Liste kommen ... aber so ein Ding, was man aufklappen
 *  kann, sodass einen das nicht erschlägt und man relativ schnell
 *  weitergehen kann") — seit dem grösseren Rollen-Katalog (13-16 Skills/
 *  Rolle, bei der Bereichs-Pseudo-Rolle sogar über mehrere Rollen aggregiert)
 *  kann eine Sektion leicht zweistellig werden. Rest bleibt über einen
 *  Aufklapp-Link erreichbar (showAllCovered/showAllGap), nichts geht
 *  verloren. */
const GAP_SKILL_PREVIEW_LIMIT = 6;

function personalizeCourseOrder(
  courses: CourseRecommendation[],
  targetGoal: string | null,
  allCourses: OrbitCourse[] = [],
): CourseRecommendation[] {
  if (courses.length < 2) return courses;

  const richness = (course: CourseRecommendation): number => {
    const fullCourse = allCourses.find((item) => item.course_id === course.course_id);
    return fullCourse ? courseRichnessScore(fullCourse) : 0;
  };

  const goalScore = (course: CourseRecommendation): number => {
    switch (targetGoal) {
      case "knowhow":
        return course.duration_weeks;
      case "weiterkommen":
        return -course.duration_weeks;
      case "neuorientierung":
        return course.covers_gap_count;
      default:
        return 0;
    }
  };

  return [...courses].sort((a, b) => {
    const richnessDifference = richness(b) - richness(a);
    if (richnessDifference !== 0) return richnessDifference;

    const goalDifference = goalScore(b) - goalScore(a);
    if (goalDifference !== 0) return goalDifference;

    return b.covers_gap_percentage - a.covers_gap_percentage;
  });
}

/** Liefert einen kurzen, wahren Erklaerungssatz, warum GENAU dieser Kurs zum
 *  gewaehlten Ziel passt — oder null, wenn das fuer diesen Kurs unter den
 *  gezeigten Optionen nicht zutrifft (dann wird nichts behauptet). */
function goalFitReason(
  goal: string | null,
  course: CourseRecommendation,
  shownCourses: CourseRecommendation[],
  allCourses: OrbitCourse[],
): string | null {
  if (!goal) return null;
  const others = shownCourses.filter((c) => c.course_id !== course.course_id);
  switch (goal) {
    case "sicherheit": {
      const full = allCourses.find((c) => c.course_id === course.course_id);
      const flexible = full?.location_mode === "remote" || full?.location_mode === "hybrid";
      return flexible
        ? "Dieser Kurs läuft remote bzw. hybrid — passt zu deinem Wunsch nach mehr Flexibilität."
        : null;
    }
    case "knowhow": {
      const isDeepest = others.length === 0 || course.duration_weeks >= Math.max(...others.map((c) => c.duration_weeks));
      return isDeepest && course.duration_weeks > 0
        ? `Mit ${course.duration_weeks} Wochen bietet dieser Kurs unter deinen Optionen die größte Tiefe.`
        : null;
    }
    case "weiterkommen": {
      const isFastest = others.length === 0 || course.duration_weeks <= Math.min(...others.map((c) => c.duration_weeks));
      return isFastest && course.duration_weeks > 0
        ? `Mit ${course.duration_weeks} Wochen bringt dich dieser Kurs unter deinen Optionen am schnellsten weiter.`
        : null;
    }
    case "neuorientierung": {
      const isBroadest = others.length === 0 || course.covers_gap_count >= Math.max(...others.map((c) => c.covers_gap_count));
      return isBroadest && course.covers_gap_count > 0
        ? "Dieser Kurs deckt unter deinen Optionen die meisten Skills auf einmal ab — eine breite Grundlage für den Neustart."
        : null;
    }
    case "fuehrung": {
      // Kein erfundenes "Führungs-Tag" am Kurs — nur ein Textabgleich auf
      // Kursname/-beschreibung, die der Bildungsträger selbst gepflegt hat.
      // Liefert null (keine Behauptung), wenn dort kein Führungsbezug steht.
      const full = allCourses.find((c) => c.course_id === course.course_id);
      const haystack = `${full?.course_name ?? ""} ${full?.description ?? ""}`.toLowerCase();
      const leadershipHit = /führung|fuehrung|leadership|management|teamleitung|leitungs/.test(haystack);
      return leadershipHit ? "Dieser Kurs ist laut Beschreibung gezielt auf Führungsthemen ausgerichtet." : null;
    }
    default:
      return null;
  }
}

/** Kürzt einen Text an einer Wortgrenze auf maximal `max` Zeichen (plus "…") —
 * schneidet nie mitten in einem Wort ab. Reine Darstellungshilfe für
 * buildCoursePitch() unten, keine inhaltliche Veränderung des Originaltexts. */
function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Individueller, inhaltlich verankerter Pitch für EINE einzelne Kursempfehlung
 * (Version 29, auf Wunsch "warum genau passt diese Weiterbildung zu deinem
 * Ziel — am besten mit Inhalten verknüpft"). JEDE der gezeigten Kurskarten
 * bekommt ihre eigene, auf genau diesen Kurs zugeschnittene Begründung (siehe
 * course-hero-pitch in KursStep) — ergänzt seit 17.09. um course-hero-reveal
 * (konkrete Skills + Ziel-Fortschritt), sobald die jeweilige Karte ausgewählt
 * ist.
 *
 * Bewusst NICHTS erfunden (gleiches Prinzip wie überall sonst in dieser
 * Journey, siehe z.B. cvLoadingMessages/courseBadges): nur echte Felder aus
 * dem Matching (covers_gap_count/is_role_fallback), der tatsächlichen
 * Schnittmenge aus course.covered_skill_uris und den ECHTEN Gap-/Kern-Skills
 * der Zielrolle (per esco_uri, nicht nur Textvergleich), sowie — falls
 * vorhanden — der vom Bildungsträger selbst gepflegten Kursbeschreibung.
 * Jede Zeile ist einzeln optional (null), wenn die zugrundeliegende
 * Information fehlt — es wird nie eine Lücke oder Passung behauptet, die sich
 * nicht aus echten Daten ableiten lässt.
 *
 * NEU (15.09., "ich will, dass man sein Ziel mit den Bereichen/Branchen
 * verbindet ... und mit einer Empfehlung, warum genau diese Weiterbildung in
 * dem und dem Bereich"): headline nennt jetzt BEIDE Dimensionen zusammen —
 * Ziel-Label (goalLabel, aus GOAL_OPTIONS) und Bereich-Label (bereichLabel,
 * echtes bereich_label-Feld, egal ob von der synthetischen Bereichs-Rolle
 * oder einer konkret gewählten Rolle) — nur wenn BEIDE vorhanden sind, sonst
 * null (nichts Halbes behaupten).
 */
function buildCoursePitch(
  course: CourseRecommendation,
  fullCourse: OrbitCourse | undefined,
  gapSkills: RoleSkillStatus[],
  coveredSkills: RoleSkillStatus[],
  goal: string | null,
  goalLabel: string | undefined,
  targetRoleName: string | null,
  bereichLabel: string | null,
  otherShownCourses: CourseRecommendation[],
): { headline: string | null; skillLine: string | null; goalLine: string | null; descriptionSnippet: string | null } {
  const role = targetRoleName || "deine Zielrolle";
  const coveredUris = new Set(fullCourse?.covered_skill_uris ?? []);
  const headline = goalLabel && bereichLabel ? `${goalLabel} · ${bereichLabel}` : null;

  let skillLine: string | null = null;
  if (coveredUris.size > 0) {
    if (course.is_role_fallback) {
      // Kein spezifischer Treffer auf die aktuelle LÜCKE — ehrlich anders
      // formulieren statt eine nicht vorhandene Lücken-Abdeckung vorzutäuschen
      // (siehe Kommentar bei is_role_fallback in orbit.ts). Zeigt stattdessen,
      // welche der insgesamt für die Rolle relevanten Skills (Lücke UND
      // bereits vorhandene) dieser Kurs abdeckt.
      const coreNames = [...gapSkills, ...coveredSkills]
        .filter((s) => coveredUris.has(s.esco_uri))
        .map((s) => s.preferred_label);
      if (coreNames.length > 0) {
        const shown = coreNames.slice(0, 3);
        skillLine = `Deckt zentrale Kompetenzen für „${role}" ab: ${shown.join(", ")}${
          coreNames.length > shown.length ? ` und ${coreNames.length - shown.length} weitere` : ""
        }.`;
      }
    } else {
      const gapNames = gapSkills.filter((s) => coveredUris.has(s.esco_uri)).map((s) => s.preferred_label);
      if (gapNames.length > 0) {
        const shown = gapNames.slice(0, 3);
        skillLine = `Schließt genau deine Lücke bei ${shown.join(", ")}${
          gapNames.length > shown.length ? ` und ${gapNames.length - shown.length} weiteren` : ""
        }.`;
      }
    }
  }

  // Wiederverwendet dieselbe Ziel-Logik wie bisher (bisher nur für den
  // gewählten Favoriten berechnet) — jetzt pro Karte aufgerufen, damit jede
  // der gezeigten Empfehlungen ihre eigene, ehrliche Ziel-Begründung bekommt.
  const goalLine = goalFitReason(goal, course, otherShownCourses, fullCourse ? [fullCourse] : []);

  const descriptionSnippet = fullCourse?.description?.trim()
    ? truncateAtWord(fullCourse.description.trim(), 130)
    : null;

  return { headline, skillLine, goalLine, descriptionSnippet };
}

/**
 * Ordnet eine bereits berechnete Gap-Analyse anhand der KI-Tiefenanalyse neu
 * ein (Version 29 — Antwort auf "Skill-Gaps sind noch viel zu ungenau,
 * Zusammenhänge müssen erkannt werden"). Bisher lief die Tiefenanalyse (siehe
 * runDepthAnalysis) rein als Anzeige-Anreicherung NEBEN dem bereits fertigen
 * Fuzzy-Ergebnis her (Beleg-Zitat/Konfidenz-Badge je Skill in GapStep) — sie
 * hat NIE verändert, ob ein Skill als "gedeckt" oder "Lücke" zählte, und ist
 * dadurch auch nie in die Kursempfehlung eingeflossen. Der reine Text-Fuzzy-
 * Match (skillMatcher.ts) kann aber keine Zusammenhänge erkennen: er findet
 * nur wörtlich (bzw. sehr ähnlich) im Text vorkommende Skill-Begriffe, keine
 * sinngemäß gleichwertige Erfahrung — "5 Jahre B2B-Vertrieb" z.B. als Beleg
 * für "Verhandlungsgeschick", ohne dass das Wort "Verhandlung" je fällt. Die
 * KI-Tiefenanalyse KANN genau das (sie liest den ganzen Lebenslauf im
 * Kontext) — sie wurde nur bisher nicht dafür genutzt.
 *
 * Diese Funktion schließt die Lücke: sobald die Tiefenanalyse zurück ist,
 * wird jeder Skill, zu dem sie eine Einschätzung mit Konfidenz "hoch" oder
 * "mittel" abgegeben hat, anhand DIESER Einschätzung neu eingeordnet — in
 * BEIDE Richtungen. Auch ein per Fuzzy-Match fälschlich als "gedeckt"
 * markierter Skill (siehe bekannte Fehltreffer wie "SQL"→"NoSQL" oder
 * "Java"→"Javanese" aus der Dashboard-Skill-Vorschlagsanalyse) kann so wieder
 * zur echten Lücke werden. Konfidenz "niedrig" oder keine Einschätzung: die
 * ursprüngliche Fuzzy-Einordnung bleibt unangetastet — die Tiefenanalyse
 * überschreibt nur, wenn sie sich wirklich sicher ist. match_percentage wird
 * mit derselben gewichteten Formel wie in analyzeGap() (gapAnalysis.ts) neu
 * berechnet, damit beide Werte konsistent bleiben.
 */
function refineGapWithDepthAnalysis(
  gapResult: GapAnalysisResponse,
  depthByUri: Map<string, DepthSkillAssessment>,
  /** esco_uris, die die Person im Gap-Schritt bereits manuell korrigiert hat
   *  (siehe manualSkillUris/handleMoveSkill in JourneyPage) — werden HIER
   *  NIE automatisch überschrieben, egal wie sicher sich die Tiefenanalyse
   *  ist: eine bewusste Person-Entscheidung soll nicht von einer später
   *  eintreffenden KI-Einschätzung wieder rückgängig gemacht werden. Default
   *  leeres Set, damit bestehende Aufrufe unverändert funktionieren. */
  manualUris: Set<string> = new Set()
): GapAnalysisResponse {
  if (depthByUri.size === 0) return gapResult;

  const allSkills = [...gapResult.covered_skills, ...gapResult.gap_skills];
  let totalWeight = 0;
  let coveredWeightedShare = 0;
  const newCovered: RoleSkillStatus[] = [];
  const newGap: RoleSkillStatus[] = [];

  for (const skill of allSkills) {
    totalWeight += skill.weight;
    const depth = depthByUri.get(skill.esco_uri);
    const isConfident =
      !manualUris.has(skill.esco_uri) && Boolean(depth && (depth.confidence === "hoch" || depth.confidence === "mittel"));
    const covered = isConfident ? depth!.evidence_found : skill.covered;
    // Fuer per Tiefenanalyse neu eingestufte Skills gibt es keinen echten
    // Fuzzy-Score — fester, an die Konfidenz angelehnter Platzhalter auf
    // derselben 0-100-Skala wie matched_score aus skillMatcher.ts, damit der
    // gewichtete Match-Prozentsatz unten konsistent bleibt.
    const matchedScore = isConfident ? (covered ? (depth!.confidence === "hoch" ? 95 : 75) : null) : skill.matched_score;

    const next: RoleSkillStatus = { ...skill, covered, matched_score: matchedScore };
    if (covered) {
      coveredWeightedShare += skill.weight * ((matchedScore ?? 100) / 100);
      newCovered.push(next);
    } else {
      newGap.push(next);
    }
  }

  newGap.sort((a, b) => b.weight - a.weight);
  newCovered.sort((a, b) => b.weight - a.weight);

  return {
    ...gapResult,
    covered_skills: newCovered,
    gap_skills: newGap,
    match_percentage: totalWeight > 0 ? Math.round((coveredWeightedShare / totalWeight) * 1000) / 10 : 0,
  };
}

/** Verschiebt EINEN Skill von "Lücke" nach "Vorhanden" oder umgekehrt, weil
 * die Person das im Gap-Schritt selbst so korrigiert hat (siehe
 * handleMoveSkill/manualSkillUris in JourneyPage - Antwort auf "Möglichkeit
 * die Skills am Ende zu entfernen oder neu hinzufügen, also manuell").
 * Rechnet match_percentage mit DERSELBEN gewichteten Formel wie
 * analyzeGap()/refineGapWithDepthAnalysis() neu, damit der Ring/die Zähler
 * sofort konsistent bleiben. Ein manuell hinzugefügter Skill bekommt
 * matched_score 100 (volle Konfidenz - es ist die eigene Aussage der
 * Person), ein manuell entfernter null (kein Score mehr, ist ja jetzt
 * wieder Lücke) - exakt dieselbe Konvention wie bei den übrigen
 * Einordnungswegen oben. Bewusst ohne Wirkung, wenn der Skill schon den
 * Ziel-Status hat (z.B. Doppelklick) - liefert dann einfach dasselbe Objekt
 * zurück, keine unnötige Neuberechnung/kein unnötiges Re-Render. */
function applyManualSkillMove(gapResult: GapAnalysisResponse, escoUri: string, toCovered: boolean): GapAnalysisResponse {
  const allSkills = [...gapResult.covered_skills, ...gapResult.gap_skills];
  const target = allSkills.find((s) => s.esco_uri === escoUri);
  if (!target || target.covered === toCovered) return gapResult;

  let totalWeight = 0;
  let coveredWeightedShare = 0;
  const newCovered: RoleSkillStatus[] = [];
  const newGap: RoleSkillStatus[] = [];

  for (const skill of allSkills) {
    totalWeight += skill.weight;
    const covered = skill.esco_uri === escoUri ? toCovered : skill.covered;
    const matchedScore = skill.esco_uri === escoUri ? (toCovered ? 100 : null) : skill.matched_score;
    const next: RoleSkillStatus = { ...skill, covered, matched_score: matchedScore };
    if (covered) {
      coveredWeightedShare += skill.weight * ((matchedScore ?? 100) / 100);
      newCovered.push(next);
    } else {
      newGap.push(next);
    }
  }

  newGap.sort((a, b) => b.weight - a.weight);
  newCovered.sort((a, b) => b.weight - a.weight);

  return {
    ...gapResult,
    covered_skills: newCovered,
    gap_skills: newGap,
    match_percentage: totalWeight > 0 ? Math.round((coveredWeightedShare / totalWeight) * 1000) / 10 : 0,
  };
}

/**
 * Bugfix 22.09.2026 ("der Prozess mit den Skills muss viel besser sein"):
 * Der Fragebogen-Pfad fragte bisher IMMER pauschal `roleSkills.slice(0, 8)`
 * ab — unabhängig davon, wie viele Skills eine Rolle tatsächlich hat (laut
 * rolesCatalog.ts 13-16 pro Rolle). Das hatte zwei Effekte: (1) die Auswahl
 * wirkte willkürlich, weil nirgends erklärt wurde, warum genau diese 8; (2)
 * schwerwiegender — buildQuizGapResult() berechnete die Match-Prozentzahl
 * über ALLE Rollen-Skills, nicht nur die gefragten 8. Die 5-8 nie gefragten
 * Skills zählten dadurch IMMER als Lücke, egal wie geantwortet wurde — 100%
 * war für die meisten Rollen rechnerisch unerreichbar.
 *
 * Fix: diese Funktion ist jetzt die EINE Quelle der Wahrheit dafür, welche
 * Skills überhaupt gefragt werden — sowohl FragebogenMethod (Anzeige) als
 * auch buildQuizGapResult() (Berechnung) nutzen exakt dieselbe Liste, damit
 * "gefragt" und "gewertet" nie wieder auseinanderlaufen können.
 *
 * Auswahlregel: die schon vorhandene ABC/Pareto-Klassifikation aus
 * gapAnalysis.ts (`priority: "kern" | "ergaenzend"`, siehe dortiger
 * Kommentar an classifyPriority() — die höchstgewichteten Skills bis 70%
 * des kumulierten Rollen-Gewichts) statt eines Festwerts. `roleSkills`
 * trägt dieses Feld normalerweise schon (lokaler Katalog-Pfad in
 * loadRoleSkills()) — nur im seltenen Server-Fallback (Rolle nicht im
 * lokalen Katalog) fehlt es, dann wird dieselbe 70%-Regel hier lokal
 * nachgebildet, statt ersatzlos auf "erste 8" zurückzufallen. Eine
 * defensive Obergrenze verhindert einen unangemessen langen Fragebogen bei
 * einer (im aktuellen Katalog nicht vorkommenden) sehr flachen
 * Gewichtsverteilung.
 */
const MAX_QUIZ_QUESTIONS = 7;
function pickCoreQuestionSkills(skills: RoleSkillStatus[]): RoleSkillStatus[] {
  if (skills.length <= MAX_QUIZ_QUESTIONS) return skills;

  const sorted = [...skills].sort((a, b) => b.weight - a.weight);
  const withPriority = sorted as (RoleSkillStatus & { priority?: "kern" | "ergaenzend" })[];
  const hasPriority = withPriority.some((s) => s.priority != null);

  let kern: RoleSkillStatus[];
  if (hasPriority) {
    kern = withPriority.filter((s) => s.priority === "kern");
  } else {
    const totalWeight = sorted.reduce((sum, s) => sum + s.weight, 0);
    const cutoff = totalWeight * 0.7;
    let running = 0;
    kern = [];
    for (const skill of sorted) {
      if (running >= cutoff && kern.length >= 4) break;
      kern.push(skill);
      running += skill.weight;
      if (kern.length >= MAX_QUIZ_QUESTIONS) break;
    }
  }

  return (kern.length ? kern : sorted).slice(0, MAX_QUIZ_QUESTIONS);
}

function skillQuestionContext(skill: RoleSkillStatus, targetRoleName: string | null): {
  title: string;
  body: string;
  signal: string;
} {
  const role = targetRoleName || "dein Ziel";
  const name = skill.preferred_label;
  const normalized = name.toLowerCase();

  if (/kommunikation|präsentation|praesentation|moderation|kunden|beratung/.test(normalized)) {
    return {
      title: `Wo begegnet dir ${name} in der Praxis?`,
      body: `Denk an Situationen, in denen du bereits für ${role} relevante Aufgaben übernommen hast.`,
      signal: "Wir suchen echte Anwendung — nicht nur theoretisches Wissen.",
    };
  }
  if (/analyse|daten|statistik|report|excel|sql|power bi|dashboard/.test(normalized)) {
    return {
      title: `Wie sicher bist du mit ${name}, wenn es praktisch wird?`,
      body: `Zum Beispiel beim Auswerten, Strukturieren oder Ableiten von Entscheidungen für ${role}.`,
      signal: "Praxis zählt stärker als ein reines 'schon einmal gesehen'.",
    };
  }
  if (/projekt|planung|management|agil|scrum|prozess/.test(normalized)) {
    return {
      title: `Wie viel Verantwortung hast du mit ${name} schon übernommen?`,
      body: `Denk an echte Aufgaben, Projekte oder Abläufe, die du selbst gesteuert oder begleitet hast.`,
      signal: "Verantwortung und Selbstständigkeit helfen uns, dein Level besser einzuordnen.",
    };
  }
  if (/marketing|seo|content|social|kampagne|ads|branding/.test(normalized)) {
    return {
      title: `Hast du ${name} schon für echte Ergebnisse eingesetzt?`,
      body: `Zum Beispiel in Kampagnen, Projekten oder eigenen Vorhaben, die zu ${role} passen.`,
      signal: "Wir unterscheiden zwischen Kennen, Anwenden und sicherem Beherrschen.",
    };
  }
  return {
    title: `Wie vertraut bist du mit ${name}?`,
    body: `Denk an deine bisherige praktische Erfahrung und daran, wie selbstständig du damit in Richtung ${role} arbeiten könntest.`,
    signal: "Eine ehrliche Einschätzung ist hilfreicher als eine perfekte Selbstdarstellung.",
  };
}

function quizSkillScore(depth: SkillDepth | undefined | null): number {
  // Fallback (sollte in der neuen UI praktisch nie eintreten - jedes "Ja"
  // setzt depth im selben Tap): entspricht in etwa "Fortgeschritten,
  // aktuell", also einem soliden, aber nicht übertriebenen Treffer.
  if (!depth) return 80;
  const base = PROFICIENCY_BASE_SCORE[depth.proficiency];
  const factor = RECENCY_FACTOR[depth.recency];
  return Math.round(Math.max(0, Math.min(100, base * factor)));
}
/** Vereinfachter Default für "ergänzende" (nicht abgefragte Kern-)Skills, die
 *  jemand freiwillig über den "+ N weitere"-Link zusätzlich bestätigt (siehe
 *  FragebogenMethod) — dort bewusst EIN Tap statt der vollen 3×3-Matrix, weil
 *  es sich um optionale Zusatzangaben handelt und die Vorgabe "nicht zu viele
 *  Schritte" für echte Zusatzinteraktionen erst recht gilt. "Fortgeschritten,
 *  aktuell" ist eine ehrliche Mitte, keine Bestnote. */
const DEFAULT_EXTRA_SKILL_DEPTH: SkillDepth = { proficiency: "fortgeschritten", recency: "aktuell" };

/** Passt eine GapAnalysisResponse (API-Form, siehe core.ts) auf die von
 * rankCoursesForGap() (courseMatcher.ts) erwartete GapAnalysisResult-Form an
 * (Version 29) — der einzige Unterschied ist das zusätzliche `priority`-Feld
 * je Skill, das rankCoursesForGap() nachweislich nie liest (siehe dessen
 * Code: nur esco_uri/weight werden ausgewertet), hier also unbedenklich mit
 * einem neutralen Platzhalter aufgefüllt. Ermöglicht goToKurs() unten, die
 * BEREITS berechnete (und ggf. per Tiefenanalyse verfeinerte) gapResult-
 * Einordnung direkt weiterzuverwenden, statt sie über matchCoursesToGap()
 * blind aus dem Rohtext neu zu berechnen — genau das war bisher der Grund,
 * warum weder die Tiefenanalyse-Verfeinerung noch (im Fragebogen-Pfad) die
 * expliziten Checkbox-Angaben der Person zuverlässig in der Kursempfehlung
 * ankamen. */
function toGapAnalysisResultForRanking(g: GapAnalysisResponse): GapAnalysisResult {
  const withPriority = (s: RoleSkillStatus): GapRoleSkillStatus => ({ ...s, priority: "ergaenzend" });
  return {
    target_role_id: g.target_role_id,
    target_role_name: g.target_role_name,
    match_percentage: g.match_percentage,
    covered_skills: g.covered_skills.map(withPriority),
    gap_skills: g.gap_skills.map(withPriority),
    summary: "",
  };
}

/** Klassische Levenshtein-Distanz (Anzahl Einfuege-/Loesch-/Ersetz-
 * Operationen, um a in b zu ueberfuehren). Basis fuer die Tippfehler-
 * Toleranz der Rollen-Suche unten — bewusst eine schlanke eigene
 * Implementierung statt einer Abhaengigkeit, da sie nur fuers Ranking der
 * Vorschlagsliste im Frontend gebraucht wird (das Backend hat sein eigenes,
 * groesseres Fuzzy-Matching fuer Skills, siehe Edge Function). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Bewertet (0-100), wie gut eine getippte Anfrage zu einem vorhandenen
 * Rollennamen passt. Exakte Teilstring-Treffer ("Analyst" in "Data Analyst" —
 * der haeufigste Fall, wenn jemand seine Wunschrolle eintippt) bekommen einen
 * hohen Wert, alles andere faellt auf eine Levenshtein-Aehnlichkeit zurueck,
 * damit auch Tippfehler oder eigene Formulierungen ("Datenanalystin") noch
 * die naechstliegende ECHTE Rolle aus dem System finden. Es entsteht dabei
 * nie eine neue Rolle — nur eine Rangfolge der vorhandenen. */
function roleMatchScore(query: string, roleName: string): number {
  const q = query.trim().toLowerCase();
  const n = roleName.toLowerCase();
  if (!q) return 0;
  if (n === q) return 100;
  if (n.includes(q) || q.includes(n)) return 90;
  const dist = levenshtein(q, n);
  const maxLen = Math.max(q.length, n.length);
  return maxLen > 0 ? Math.max(0, (1 - dist / maxLen) * 100) : 0;
}

/** Rankt die vorhandenen Rollen nach Aehnlichkeit zur Eingabe im Suchfeld.
 * Faellt auf die 5 aehnlichsten Rollen zurueck, wenn keine gut genug trifft
 * (score >= 30) — so landet niemand vor einer leeren Liste, sondern bekommt
 * zumindest die naechstliegenden echten Angebote vorgeschlagen (die Person
 * "matched" so immer mit tatsaechlich vorhandenen Jobs/Rollen). */
function rankRolesByQuery(roles: TargetRole[], query: string): TargetRole[] {
  const scored = roles
    .map((role) => ({ role, score: roleMatchScore(query, role.role_name) }))
    .sort((a, b) => b.score - a.score);
  const good = scored.filter((x) => x.score >= 30);
  const pool = good.length > 0 ? good : scored.slice(0, 5);
  return pool.slice(0, 12).map((x) => x.role);
}

type Method = "cv" | "fragebogen" | null;
/** Erfahrungslevel-Stufen, sowohl für die KI-Einschätzung
 *  (DepthSkillAssessment.proficiency_level) als auch für die eigene Auswahl
 *  der Person im Gap-Schritt (siehe selfLevelByUri) - dieselben drei Stufen,
 *  damit der KI-Vorschlag 1:1 als Vorbelegung dienen kann. */
type ProficiencyLevel = "grundkenntnisse" | "fortgeschritten" | "experte";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * Version des Einwilligungstexts, dem eine Person beim Absenden des
 * Kontaktformulars zustimmt (Version 28, DSGVO-Nachweis, siehe
 * consent_text_version in orbit.ts). Von Hand hochzählen/umbenennen, sobald
 * der Wortlaut des Consent-Textes im LeadStep sich inhaltlich ändert — so
 * bleibt im Nachhinein nachvollziehbar, welcher genauen Formulierung ein
 * konkreter Lead damals zugestimmt hat.
 */
const CONSENT_TEXT_VERSION = "lead-consent-v1-2026-09";
/** Grobe Startzeitpunkt-Optionen, seit Version 24 im eigenen "Präferenzen"-
 * Schritt (siehe PraeferenzenStep) statt im Kurs-Schritt abgefragt. Bewusst
 * als kurze Auswahl statt freiem Datumsfeld — macht den Lead qualifizierter
 * (der Bildungsträger weiß, wie dringlich das Anliegen ist), ohne mit einem
 * zusätzlichen Pflichtfeld die Absprungrate zu erhöhen. */
const START_OPTIONS: { key: string; label: string }[] = [
  { key: "asap", label: "So schnell wie möglich" },
  { key: "4-wochen", label: "In den nächsten 4 Wochen" },
  { key: "1-3-monate", label: "In 1–3 Monaten" },
  { key: "offen", label: "Weiß noch nicht" },
];
/** Beschäftigungsart (Version 24, siehe PraeferenzenStep) — ebenfalls
 * optional, damit niemand im Funnel hängen bleibt. "egal" (Version 26) ist
 * eine ZUSAETZLICHE, ausdrueckliche Option neben dem einfachen Weiterklicken
 * ohne Auswahl — der Unterschied zaehlt fuer den Bildungstraeger: "hat
 * bewusst 'egal' angeklickt" ist eine andere Information als "hat die Frage
 * einfach uebersprungen". Wird beim Kurs-Matching wie "keine Angabe"
 * behandelt, siehe preferenceMatchScore() in courseMatcher.ts. */
const EMPLOYMENT_OPTIONS: { key: string; label: string }[] = [
  { key: "vollzeit", label: "Vollzeit" },
  { key: "teilzeit", label: "Teilzeit" },
  { key: "egal", label: "Egal" },
];
/** Gewünschter Arbeitsort (Version 24, siehe PraeferenzenStep) — "egal"
 *  (Version 26) siehe Kommentar bei EMPLOYMENT_OPTIONS oben. */
const LOCATION_OPTIONS: { key: string; label: string }[] = [
  { key: "remote", label: "Remote" },
  { key: "vor-ort", label: "Vor Ort" },
  { key: "egal", label: "Egal" },
];
/** Förderungs-Präferenz (Version 32, 14.09.) — bewusst grob gehalten ("ist
 *  dir eine Förderung wichtig", nicht "welcher Fördertyp genau"): die
 *  konkreten Fördertöpfe (Bildungsgutschein/AZAV, Aufstiegs-BAföG,
 *  Landesförderung, Bildungsurlaub, siehe FundingType in orbit.ts) haben zu
 *  unterschiedliche Voraussetzungen, um sie hier sinnvoll einzeln
 *  abzufragen — ein Kurs mit IRGENDEINER Förderung zählt für das Matching
 *  bereits als Treffer (siehe preferenceMatchScore in courseMatcher.ts).
 *  "egal" (analog zu EMPLOYMENT_OPTIONS/LOCATION_OPTIONS oben) ist eine
 *  ausdrueckliche "keine Praeferenz"-Antwort. */
const FUNDING_OPTIONS: { key: string; label: string }[] = [
  { key: "gefoerdert", label: "Ja, wichtig" },
  { key: "egal", label: "Egal" },
];
/** Einkategorisierung (Version 28, 17.09., "danach gefragt werden ob man
 *  schon weiss was man machen will, Zertifikat, Seminar, Weiterbildung,
 *  Studium") — die Keys entsprechen 1:1 CourseCategory in orbit.ts (siehe
 *  dort), damit kein separates Mapping gepflegt werden muss. "sonstiges"
 *  bekommt hier bewusst KEINE eigene Auswahl-Option (zu unspezifisch fuer
 *  eine bewusste Personen-Entscheidung) — "weiss-noch-nicht" ist analog zu
 *  "egal"/"offen" oben eine ausdrueckliche "keine Praeferenz"-Antwort. Die
 *  tatsaechlich ANGEZEIGTEN Optionen werden zusaetzlich in JourneyPage
 *  (categoryOptionsInPortfolio) auf das reduziert, was im Kurskatalog des
 *  Tenants ueberhaupt vorkommt — siehe Kommentar dort ("Bei der Auswahl
 *  soll ... nur das zur Auswahl stehen, was auch im Kurskatalog so angelegt
 *  wurde, wenn es gar nicht ausgewaehlt wurde, dann soll der Button auch
 *  nicht sichtbar sein"). */
const CATEGORY_OPTIONS: { key: string; label: string }[] = [
  { key: "zertifikat", label: "Zertifikat" },
  { key: "seminar", label: "Seminar" },
  { key: "weiterbildung", label: "Weiterbildung" },
  { key: "studium", label: "Studium" },
  { key: "weiss-noch-nicht", label: "Weiß noch nicht" },
];
/** Gewünschte Kursdauer (Version 28, 17.09., "die Dauer soll auch abgefragt
 *  werden") — bewusst grobe Buckets statt Wochenzahl-Eingabe, gleiches
 *  Prinzip wie START_OPTIONS oben. "lang" hat KEINE Obergrenze (siehe
 *  DURATION_PREFERENCE_MAX_WEEKS in courseMatcher.ts) und wird beim
 *  Matching wie "keine Praeferenz" behandelt — wer bewusst "lang" waehlt,
 *  fuer den ist Zeit kein Ausschlusskriterium, nur ein zu kurzer Kurs waere
 *  nie ein "Widerspruch". */
const DURATION_OPTIONS: { key: string; label: string }[] = [
  { key: "kurz", label: "Kurz (bis ca. 8 Wochen)" },
  { key: "mittel", label: "Mittel (bis ca. 6 Monate)" },
  { key: "lang", label: "Lang (auch länger)" },
];
/** Voraussetzungs-Auskunft der Person (Version 34, 22.09., "es muss auch auf
 *  Vorraussetzungen bei den Kursen drauf eingegangen werden") — drei neue,
 *  ebenfalls optionale Fragen im "Präferenzen"-Schritt, deren Antworten
 *  gegen die strukturierten Kurs-Voraussetzungen (min_qualification_level/
 *  min_experience_years/required_language_level an OrbitCourse, siehe
 *  orbit.ts) abgeglichen werden (checkPrerequisites() in courseMatcher.ts).
 *  Anders als bei EMPLOYMENT_OPTIONS/LOCATION_OPTIONS oben absichtlich KEINE
 *  extra "Egal"-Option: einfach nichts anklicken und weiterklicken ist hier
 *  bereits die "keine Angabe"-Antwort (bei QUALIFICATION_OPTIONS ist "keine
 *  formale Vorbildung" schon selbst eine echte, unterscheidbare Angabe —
 *  eine zusätzliche "Egal" wäre nur verwirrend).
 *
 *  QualificationLevel-Keys 1:1 wie in orbit.ts/courseMatcher.ts
 *  (QUALIFICATION_RANK) — kein separates Mapping. */
const QUALIFICATION_OPTIONS: { key: string; label: string }[] = [
  { key: "keine", label: "Keine formale Vorbildung" },
  { key: "berufsausbildung", label: "Abgeschlossene Berufsausbildung" },
  { key: "studium", label: "Hochschulabschluss" },
];
/** Grobe Berufserfahrungs-Buckets statt Jahreszahl-Eingabe (gleiches Prinzip
 *  wie START_OPTIONS/DURATION_OPTIONS oben). `years` ist bewusst die
 *  UNTERGRENZE des jeweiligen Buckets, nie die Obergrenze oder ein
 *  Mittelwert — checkPrerequisites() vergleicht damit direkt gegen
 *  min_experience_years, und im Zweifel wird der Person NIE mehr Erfahrung
 *  unterstellt, als sie sicher hat (keine erfundenen Fakten: "3–5 Jahre"
 *  zählt für einen Kurs, der 5 Jahre verlangt, ehrlich als "unklar", nicht
 *  faelschlich als "erfüllt"). */
const EXPERIENCE_OPTIONS: { key: string; label: string; years: number }[] = [
  { key: "keine", label: "Keine / unter 1 Jahr", years: 0 },
  { key: "1-3", label: "1–3 Jahre", years: 1 },
  { key: "3-5", label: "3–5 Jahre", years: 3 },
  { key: "5-plus", label: "Mehr als 5 Jahre", years: 5 },
];
/** Deutschkenntnisse in alltagssprachlichen Stufen statt direkter CEFR-Abfrage
 *  (die wenigsten kennen ihr eigenes CEFR-Niveau) — `level` ist die CEFR-
 *  UNTERGRENZE der jeweiligen Stufe (gleiches "keine erfundenen Fakten"-
 *  Prinzip wie bei EXPERIENCE_OPTIONS oben: "Gute Kenntnisse" deckt
 *  ehrlicherweise B1–B2 ab, gespeichert wird die Untergrenze B1). Siehe
 *  CEFR_RANK in courseMatcher.ts. */
const LANGUAGE_LEVEL_OPTIONS: { key: string; label: string; level: string }[] = [
  { key: "gering", label: "Grundkenntnisse", level: "A1" },
  { key: "gut", label: "Gute Kenntnisse", level: "B1" },
  { key: "fliessend", label: "Fließend", level: "C1" },
  { key: "muttersprache", label: "Muttersprachlich / verhandlungssicher", level: "C2" },
];
/** Labels für die KURS-eigenen location_mode/employment_mode-Werte (orbit.ts:
 * LocationMode/EmploymentMode) — bewusst eigene Maps statt
 * START_OPTIONS/EMPLOYMENT_OPTIONS/LOCATION_OPTIONS oben: unterschiedlicher
 * Wertebereich (Kurse kennen zusätzlich "hybrid"/"beides", location_mode
 * schreibt "vor_ort" mit Unterstrich). Dupliziert in DashboardPage.tsx als
 * COURSE_LOCATION_LABELS/COURSE_EMPLOYMENT_LABELS, siehe Kommentar dort. */
const COURSE_LOCATION_LABELS: Record<string, string> = {
  remote: "💻 Remote",
  vor_ort: "📍 Vor Ort",
  hybrid: "🔀 Hybrid",
};
const COURSE_EMPLOYMENT_LABELS: Record<string, string> = {
  vollzeit: "💼 Vollzeit",
  teilzeit: "🕐 Teilzeit",
  beides: "🔀 Vollzeit/Teilzeit",
};
/** Kurzlabels für die neuen Kurs-Fakten (Preis/Förderung/Abschluss, Version
 *  33, siehe die entsprechenden Felder an OrbitCourse in orbit.ts) auf der
 *  Kursempfehlungs-Kachel in KursStep unten — bewusst knapper als die
 *  Formular-Labels in DashboardPage.tsx (FUNDING_TYPE_OPTIONS/
 *  QUALIFICATION_TYPE_OPTIONS), da hier nur EIN Fakt pro Zeile Platz hat statt
 *  einer Auswahlliste im Formular. */
const FUNDING_TYPE_LABELS: Record<string, string> = {
  bildungsgutschein: "Bildungsgutschein",
  aufstiegs_bafoeg: "Aufstiegs-BAföG",
  laenderfoerderung: "Landesförderung",
  bildungsurlaub: "Bildungsurlaub",
};
const QUALIFICATION_TYPE_LABELS: Record<string, string> = {
  seminarzertifikat: "Seminarzertifikat",
  lehrgangszertifikat: "Lehrgangszertifikat",
  ihk_pruefung: "IHK-Prüfung",
  sonstiger_abschluss: "Abschlusszertifikat",
};
/** Formatiert einen Euro-Betrag ohne Nachkommastellen bei runden Beträgen
 *  (z.B. "2.590 €" statt "2.590,00 €") — konsistent mit der Preis-Anzeige in
 *  DashboardPage.tsx. */
function formatEuro(amount: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
/**
 * Einheitliches Dauer-Format (Rückmeldung 17.09., "Kosten Dauer in einem
 * einheitlichen Format") — bisher zeigte course-hero-meta nur "X Wochen",
 * course-hero-facts daneben zusätzlich "Y UE" als eigene Pille, und die
 * "Weitere passende Kurse"-Kachel gar keine UE. Jetzt eine Stelle, die beides
 * konsistent zu einem String zusammenzieht — nur reale Felder, teaching_units
 * bleibt weg, wenn der Bildungsträger es nicht gepflegt hat.
 */
function formatCourseDuration(course: { duration_weeks: number; teaching_units?: number | null }): string {
  const weeks = `${course.duration_weeks} Wochen`;
  return course.teaching_units != null ? `${weeks} · ${course.teaching_units} UE` : weeks;
}
/**
 * Einheitliches Preis-Format (siehe formatCourseDuration oben, gleicher
 * Anlass) — bisher hatte course-hero-facts USt.-Hinweis + Prüfungsgebühr,
 * course-hero-reveal-facts nur den USt.-Hinweis, die Kurskachel im Karussell
 * gar keinen Zusatz. Jetzt eine Stelle für alle drei. null, wenn kein Preis
 * gepflegt ist — keine Zeile statt einer erfundenen.
 */
function formatCoursePrice(course: {
  price_eur?: number | null;
  price_vat_exempt?: boolean | null;
  exam_fee_eur?: number | null;
}): string | null {
  if (course.price_eur == null) return null;
  let text = formatEuro(course.price_eur);
  if (course.price_vat_exempt) text += " · USt.-befreit";
  if (course.exam_fee_eur != null) text += ` (+ ${formatEuro(course.exam_fee_eur)} Prüfungsgebühr)`;
  return text;
}
/**
 * Rückmeldung 17.09. ("es sollen immer die Daten sichtbar sein und wenn
 * keine Hinterlegt worden sind, dann soll auf Anfrage kommen"): bisher
 * fielen Kosten/Ort/Niveau/Förderung/Start als ganze Zeile/Pille komplett
 * weg, wenn der Bildungsträger das jeweilige Feld nicht gepflegt hatte
 * (Projekt-Prinzip "keine erfundenen Fakten" — siehe formatCoursePrice
 * oben). Jetzt bleibt die Zeile/Pille IMMER sichtbar, zeigt bei einem
 * fehlenden Wert aber ehrlich "auf Anfrage" statt eines erfundenen Werts
 * oder eines stillschweigenden Wegfalls. Fünf kleine Wrapper statt eines
 * generischen "orAufAnfrage()"-Helpers, weil jedes Feld sein eigenes
 * Label-Lookup/Format mitbringt (COURSE_LOCATION_LABELS,
 * QUALIFICATION_TYPE_LABELS, FUNDING_TYPE_LABELS, formatCourseStartDate,
 * formatCoursePrice) — bewusst lose typisiert (wie formatCoursePrice/
 * formatCourseDuration oben) statt LocationMode/QualificationType/
 * FundingType hier zusätzlich zu importieren.
 */
const RAHMENDATEN_FALLBACK = "auf Anfrage";
function courseCostText(course: {
  price_eur?: number | null;
  price_vat_exempt?: boolean | null;
  exam_fee_eur?: number | null;
}): string {
  return formatCoursePrice(course) ?? RAHMENDATEN_FALLBACK;
}
/**
 * Session-bewusst (NEU, 18.09. — "Kurse auch mehrere Standorte ... haben
 * können"): ein Kurs mit mehreren bevorstehenden Terminen an
 * unterschiedlichen Standorten zeigt "Mehrere Standorte" statt eines
 * einzelnen, womöglich veralteten Formats — ein Kurs mit nur einem
 * bevorstehenden Termin (der Normalfall, auch bei bestehenden Kursen ohne
 * sessions) verhält sich unverändert.
 */
function courseLocationText(course: {
  location_mode?: string | null;
  sessions?: CourseSession[] | null;
  starts_at?: string | null;
  location?: string | null;
  is_remote?: boolean | null;
  seats_remaining?: number | null;
}): string {
  const upcoming = getCourseSessions(course).filter((s) => isSessionUpcoming(s));
  const distinctModes = new Set(upcoming.map((s) => s.location_mode).filter((m): m is string => Boolean(m)));
  if (upcoming.length > 1 && distinctModes.size > 1) {
    return "Mehrere Standorte";
  }
  const mode = upcoming[0]?.location_mode ?? course.location_mode ?? null;
  return (mode && COURSE_LOCATION_LABELS[mode]) || RAHMENDATEN_FALLBACK;
}
function courseQualificationText(course: { qualification_type?: string | null; dqr_level?: number | null }): string {
  if (course.qualification_type && QUALIFICATION_TYPE_LABELS[course.qualification_type]) {
    return (
      QUALIFICATION_TYPE_LABELS[course.qualification_type] +
      (course.dqr_level != null ? ` (DQR ${course.dqr_level})` : "")
    );
  }
  return RAHMENDATEN_FALLBACK;
}
function courseFundingText(course: { funding_types?: string[] | null }): string {
  if (course.funding_types && course.funding_types.length > 0) {
    const single = course.funding_types.length === 1 ? FUNDING_TYPE_LABELS[course.funding_types[0]] : null;
    return `Förderfähig${single ? ` (${single})` : ""}`;
  }
  return RAHMENDATEN_FALLBACK;
}
/** Session-bewusst wie courseLocationText oben: zeigt den NÄCHSTEN
 *  bevorstehenden Termin statt eines fixen starts_at, plus einen Hinweis auf
 *  weitere Termine, falls vorhanden. */
function courseStartText(course: {
  starts_at?: string | null;
  sessions?: CourseSession[] | null;
  location?: string | null;
  location_mode?: string | null;
  is_remote?: boolean | null;
  seats_remaining?: number | null;
}): string {
  const next = nextUpcomingSession(course);
  const base = formatCourseStartDate((next?.starts_at ?? course.starts_at) ?? null) ?? RAHMENDATEN_FALLBACK;
  const upcomingWithDate = getCourseSessions(course).filter((s) => isSessionUpcoming(s) && s.starts_at).length;
  return upcomingWithDate > 1 ? `${base} (+${upcomingWithDate - 1} weitere Termine)` : base;
}
/** Rechnet, wie in lead_service.py/index.ts (Backend), den projizierten
 * Match-Score aus: "wenn diese Person den empfohlenen Kurs abschließt, wie
 * nah wäre sie danach an der Zielrolle?" — hier client-seitig nachgebaut,
 * damit die Kursempfehlung schon VOR dem Absenden der Anfrage ehrlich
 * beziffert werden kann. */
function projectedMatchPct(currentMatch: number, coversGapPercentage: number): number {
  const closedFraction = coversGapPercentage / 100;
  const projected = currentMatch + closedFraction * (100 - currentMatch);
  return Math.round(Math.min(100, projected) * 10) / 10;
}
/** Kleines visuelles Icon je Zielrolle — rein kosmetisch, rät anhand des
 * Rollennamens (keine eigene Datenquelle nötig). */
function roleIcon(roleName: string): string {
  const n = roleName.toLowerCase();
  if (n.includes("engineer")) return "🛠️";
  if (n.includes("lead")) return "🚀";
  if (n.includes("analy") || n.includes("data")) return "📊";
  if (n.includes("hr") || n.includes("business partner") || n.includes("personal")) return "🤝";
  return "🎯";
}
/** Erlaubt anklickbaren <div>-Karten (Rollen, Methoden, Quiz-Items) dieselbe
 * Aktion auch per Tastatur (Enter/Leertaste) auszulösen — wichtig, weil diese
 * Seite öffentlich auf der Website eines Bildungsträgers eingebettet wird. */
function handleCardKeyDown(e: KeyboardEvent, action: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    action();
  }
}
/** Zeigt dem Endnutzer nie die rohe technische Fehlermeldung (Server-Status,
 * Netzwerk-Details) — das wirkt für eine Karriere-/Weiterbildungs-Zielgruppe
 * unprofessionell und verunsichert unnötig. Die echte Meldung geht stattdessen
 * ins Devtools-Log, für die eigene Fehlersuche. */
function reportError(context: string, err: unknown): string {
  console.error(`[JourneyPage] ${context}:`, err);
  return "Das hat gerade leider nicht geklappt — das liegt nicht an dir. Bitte versuch es gleich nochmal.";
}
/**
 * Öffentlicher API-Key für das Widget. Kommt aus der Konfiguration
 * (`VITE_ORBIT_PUBLIC_API_KEY`) und ist bewusst NICHT fest im Code hinterlegt:
 * alles, was diese Seite mitschickt, kann jeder Besucher im Browser mitlesen.
 * Deshalb darf hier ausschließlich ein Key mit der Rolle "public" stehen —
 * der kann Analysen durchführen und eine Anfrage abschicken, aber weder die
 * Lead-Liste noch die Auswertungen lesen und den Kurskatalog nicht ändern.
 */
const PUBLIC_API_KEY: string = (import.meta.env?.VITE_ORBIT_PUBLIC_API_KEY as string | undefined) ?? "";

// Server-Adresse aus VITE_SUPABASE_URL ableiten, statt localhost fest zu
// verdrahten -- sonst läuft die Journey im Production-Build für echte
// Besucher ins Leere (das Verbindungs-Panel ist dort ausgeblendet, es gäbe
// also keine Möglichkeit, die Adresse manuell zu korrigieren).
const SUPABASE_URL: string = (import.meta.env?.VITE_SUPABASE_URL as string | undefined) ?? "";
const DEFAULT_API_BASE: string = SUPABASE_URL
  ? `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/api`
  : "http://127.0.0.1:8000";

/** Separate deployment of cv-depth-analysis. In production this may be set
 * explicitly so the Journey never has to guess the function URL. */
const DEPTH_ANALYSIS_URL: string =
  (import.meta.env?.VITE_CV_DEPTH_ANALYSIS_URL as string | undefined)?.trim() || "";
/**
 * Version 26 — merkt sich die im Demo-Verbindungspanel (Zahnrad-Menü)
 * eingetragene Server-Adresse/API-Key in localStorage, damit sie einen
 * Seiten-Reload UEBERLEBEN (nur relevant, solange showConnectionPanel
 * sichtbar ist — für echte Endnutzer ohne Panel greift ohnehin nur
 * defaultBaseUrl/defaultApiKey). Vorher reiner useState: bei jedem Reload
 * (z.B. wenn die Bolt-Vorschau selbst neu startet, siehe "Restarting because
 * open event was not received in time..." im Devtools-Log) fiel der
 * eingetragene Key wieder auf defaultApiKey zurueck — musste also alle paar
 * Minuten neu eingetippt werden. try/catch, weil localStorage in manchen
 * Kontexten (privates Fenster, blockierter Storage-Zugriff) werfen kann —
 * dann faellt nur die Persistenz weg, nie die Funktion der Seite selbst. */
const JOURNEY_CONNECTION_STORAGE_KEY = "dyd-orbit-journey-connection";
function readStoredJourneyConnection(): { baseUrl?: string; apiKey?: string } {
  try {
    const raw = localStorage.getItem(JOURNEY_CONNECTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { baseUrl?: unknown; apiKey?: unknown };
    return {
      baseUrl: typeof parsed?.baseUrl === "string" ? parsed.baseUrl : undefined,
      apiKey: typeof parsed?.apiKey === "string" ? parsed.apiKey : undefined,
    };
  } catch {
    return {};
  }
}
function writeStoredJourneyConnection(baseUrl: string, apiKey: string) {
  try {
    localStorage.setItem(JOURNEY_CONNECTION_STORAGE_KEY, JSON.stringify({ baseUrl, apiKey }));
  } catch {
    // Storage blockiert/voll — Persistenz faellt still weg, Seite laeuft normal weiter.
  }
}
interface JourneyPageProps {
  /** Server-Adresse, mit der beim Laden automatisch verbunden wird. */
  defaultBaseUrl?: string;
  /** Öffentlicher API-Key (Rolle "public") des Bildungsträger-Tenants. */
  defaultApiKey?: string;
  /**
   * Zeigt das Zahnrad-Menü unten rechts (Server-Adresse/API-Key manuell
   * eintragen). MUSS für echte Endnutzer auf `false` stehen — sonst sieht
   * jeder Website-Besucher eine Einstellungs-Schublade mit rohem API-Key
   * und Server-Adresse, was auf einer öffentlichen Lead-Seite ein echtes
   * Sicherheits-/Professionalitätsproblem wäre. Default: an, solange im
   * Vite-Dev-Server (`npm run dev`) entwickelt wird.
   */
  showConnectionPanel?: boolean;
  /**
   * Zeigt den "Rundgang starten"-Button + JourneyTour (Version 26). Bis
   * Version 25 an dieselbe Bedingung wie showConnectionPanel gekoppelt (also
   * nur im Dev-/Demo-Modus sichtbar) — auf ausdrücklichen Wunsch jetzt ein
   * EIGENES, unabhängiges Flag, Default `true`: der Rundgang bleibt damit
   * auch im echten Production-Build sichtbar (wo showConnectionPanel wegen
   * eines gesetzten API-Keys `false` ist). Bewusst weiterhin abschaltbar
   * (auf `false` setzen), falls eine eingebettete Live-Version für einen
   * konkreten Bildungsträger den Rundgang NICHT zeigen soll — anders als
   * showConnectionPanel enthält der Rundgang selbst keine rohen
   * Zugangsdaten, ist also kein Sicherheitsproblem, nur eine Produktfrage.
   */
  showTour?: boolean;
  /**
   * Link zur echten Datenschutzerklärung dieses Bildungsträgers/Tenants
   * (Version 28). Bis jetzt gab es hier nur eine leere Modul-Konstante
   * (PRIVACY_POLICY_URL) ohne echten Wert — jetzt ein Prop, damit jeder
   * Tenant beim Einbinden seine eigene, echte Datenschutzerklärung verlinken
   * kann, sobald eine existiert (siehe mitgelieferten Entwurf
   * "Datenschutzerklaerung_ENTWURF.md" — bitte vor Live-Gang von einem
   * Anwalt/Datenschutzbeauftragten prüfen und final unter dieser URL
   * hosten). Leer/undefined = Hinweistexte zur Datenschutzerklärung bleiben
   * unverlinkter Fließtext, statt auf eine tote Seite zu zeigen.
   */
  privacyPolicyUrl?: string;
  /**
   * Avatar/Guide (22.09.2026, siehe ausführlichen Kommentar an
   * GuideAvatarBubble oben): eigenes, unabhängiges Tenant-Flag nach exakt
   * demselben Muster wie showTour — Default `true`, aber ausdrücklich
   * abschaltbar, falls ein White-Label-Partner den Guide nicht zeigen
   * möchte (z.B. weil er ein eigenes Beratungs-/Support-Konzept hat). */
  showAvatar?: boolean;
  /**
   * Name, mit dem sich der Guide vorstellt (siehe GuideAvatarBubble). Frei
   * durch den Tenant überschreibbar — z.B. der Name der realen
   * Beratungsperson eines Bildungsträgers, statt des DYD-Standardnamens. */
  avatarName?: string;
  /**
   * Optionale Akzentfarbe für den Guide-Orb (jeder gültige CSS-Farbwert,
   * z.B. Hex/RGB der Tenant-Marke). Leer/undefined = Standard-DYD-
   * Farbverlauf (Mint → Blau, dieselbe Familie wie MatchRing). */
  avatarAccentColor?: string;
}
/**
 * Interface B: der Endnutzer-/Lead-Assistent (React-Fassung von
 * orbit-user-journey.html). Jetzt als Berufsberatung + Weiterbildungsfinder:
 * zuerst wird gefragt, ob die Zielposition schon feststeht. Bei "Ja" laeuft
 * die urspruengliche 5-Schritte-Journey (Zielrolle -> Skills -> Skill-Gap ->
 * Kurs -> Anfrage). Bei "Nein" wird zuerst ein grober Berufsbereich
 * abgefragt, der die Zielrollen-Auswahl vorfiltert — danach ist der Ablauf
 * identisch. Simuliert, wie das eingebettet auf der Website eines
 * Bildungsträgers aussehen könnte.
 */
export function JourneyPage({
  defaultBaseUrl = DEFAULT_API_BASE,
  defaultApiKey = PUBLIC_API_KEY,
  showConnectionPanel = Boolean(import.meta.env?.DEV ?? true) || !defaultApiKey,
  showTour = true,
  privacyPolicyUrl = "",
  showAvatar = true,
  avatarName = "Mia",
  avatarAccentColor,
}: JourneyPageProps = {}) {
  // Demo-Verbindungseinstellungen (unten rechts im Zahnrad-Menü, nur im
  // Dev-Modus sichtbar) — Version 26: Startwert kommt zuerst aus
  // localStorage (siehe readStoredJourneyConnection oben), erst wenn dort
  // nichts hinterlegt ist, aus defaultBaseUrl/defaultApiKey.
  const [baseUrl, setBaseUrl] = useState(() => readStoredJourneyConnection().baseUrl ?? defaultBaseUrl);
  const [apiKey, setApiKey] = useState(() => readStoredJourneyConnection().apiKey ?? defaultApiKey);
  // Haelt beide Werte bei jeder Aenderung in localStorage nach (siehe
  // writeStoredJourneyConnection/Kommentar oben) — so uebersteht ein einmal
  // eingetragener Key auch einen Seiten-Reload.
  useEffect(() => {
    writeStoredJourneyConnection(baseUrl, apiKey);
  }, [baseUrl, apiKey]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Gefuehrter Rundgang (JourneyTour, siehe dort) - Version 26: eigenes
  // showTour-Flag (Default an), NICHT mehr an showConnectionPanel gekoppelt
  // wie bis Version 25 - der Rundgang soll ausdruecklich auch im echten
  // Production-Build sichtbar bleiben (siehe showTour in JourneyPageProps).
  const [tourOpen, setTourOpen] = useState(false);
  // true, solange targetRoleId/text/gapResult/courseResult noch exakt die
  // von runDemoAnalysis "aus dem Nichts" erzeugten Werte sind (kein echter
  // Klick/Upload hat sie seither ersetzt). Wird von JEDER echten
  // Nutzer-Aktion (selectGoal/selectArea/selectRole/handleFileChange/
  // submitTextMethod/submitQuizMethod) sofort auf false gesetzt - auch wenn
  // diese Aktion selbst wegen eines Guards (z.B. dieselbe Rolle nochmal
  // waehlen) sonst nichts tut. tourClose() nutzt das, um beim Schliessen
  // ungenutzte Demo-Daten wieder zu entfernen, BEVOR sie mit einem echten
  // Durchlauf kollidieren koennen (siehe Kommentar dort - das war die
  // Ursache dafuer, dass ein echter Durchlauf nach einem Tour-Vorschau-Blick
  // auf dieselbe Rolle staehende Demo-Ergebnisse zeigte statt frischer).
  const demoDataActiveRef = useRef(false);
  // Zaehler, der jeden runDemoAnalysis()-Aufruf eindeutig markiert - siehe
  // Kommentar dort. tourClose() erhoeht ihn zusaetzlich, um eine gerade
  // laufende Demo-Anfrage als "ueberholt" zu markieren.
  const demoRunIdRef = useRef(0);
  // Einstieg: weiss die Person schon, was ihre Traumposition ist? null = noch
  // nicht beantwortet (zeigt IntroStep statt Stepper/Panel-Schritten).
  const [knownRole, setKnownRole] = useState<boolean | null>(null);
  const knowsRole = knownRole;
  const setKnowsRole = setKnownRole;
  // Im RoleSuggestStep angeklickte Skills (nur relevant, wenn
  // knowsRole === false) — bewusst nicht auf den Schritt selbst beschraenkt
  // (JourneyPage-State statt lokalem Step-State), damit die Auswahl beim
  // spaeteren selectRole() zum Vorbelegen des Fragebogens (checkedSkills)
  // wiederverwendet werden kann, siehe dort.
  const [roleSuggestSkillIds, setRoleSuggestSkillIds] = useState<Set<string>>(new Set());
  function toggleRoleSuggestSkill(skillId: string) {
    setRoleSuggestSkillIds((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  }
  // Motivationale Qualifizierung (Version 16, siehe GOAL_OPTIONS) — direkt
  // nach der Einstiegsfrage abgefragt, gilt fuer die ganze restliche Journey.
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const careerGoal = selectedGoal;
  const setCareerGoal = setSelectedGoal;
  // Fortschritt. -1 = Einstiegsfrage (Intro), noch kein Schritt aktiv.
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(-1);
  const current = currentStepIndex;
  const setCurrent = setCurrentStepIndex;
  const [done, setDone] = useState(false);
  const widgetBodyRef = useRef<HTMLDivElement>(null);
  // Welche Schritt-Sequenz gerade gilt, haengt davon ab, ob die Zielrolle
  // schon bekannt ist (6 Schritte, inkl. Motivations-Zwischenseite) oder
  // erst per Bereich gefunden werden muss (7 Schritte, mit vorgeschaltetem
  // "Bereich"-Schritt).
  const steps = knowsRole === false ? WITH_BEREICH_STEPS : BASE_STEPS;
  const stepKey: StepKey | undefined = current >= 0 ? steps[current]?.key : undefined;
  /** Liefert den Index eines Schritts in der AKTUELL gueltigen Schritt-Folge
   * (`steps`) — so bleiben alle setCurrent(...)-Aufrufe korrekt, egal ob der
   * Nutzer im 5- oder 6-Schritte-Pfad unterwegs ist. */
  function stepIndex(key: StepKey): number {
    return steps.findIndex((s) => s.key === key);
  }
  /** Navigations-Callback fuer JourneyTour: holt den Rundgang notfalls aus
   * der Einstiegsfrage heraus (steps/stepIndex geben bei knowsRole===null
   * schon BASE_STEPS zurück, siehe Definition von `steps` oben - nur die
   * Bedingung fuers Rendern des Panels statt IntroStep braucht knowsRole
   * explizit gesetzt). Wird nur mit Schluesseln aufgerufen, die laut
   * availableKeys im aktuell gültigen Pfad ohnehin vorkommen. */
  function tourNavigate(key: StepKey) {
    if (knowsRole === null) setKnowsRole(true);
    setCurrent(stepIndex(key));
  }
  /** Fuer JourneyTour: sorgt dafuer, dass beim Start des Rundgangs echte
   * Skill-Gap-/Kursergebnisse vorliegen, statt diese beiden Schritte einfach
   * zu ueberspringen. Laeuft NICHT ueber runGapAnalysis/goToKurs (die sind
   * fest an die echten Formular-Buttons inkl. Test-Tracking gebunden - eine
   * reine Rundgang-Vorschau soll NICHT als echter Nutzer-Test in den
   * Bildungstraeger-Reports auftauchen, siehe createTest dort). Fuellt nur,
   * was wirklich fehlt: ist schon eine echte Zielrolle/Ergebnis vorhanden
   * (weil vorher real durchgeklickt wurde), wird das weiterverwendet statt
   * ueberschrieben. */
async function runDemoAnalysis() {
    const runId = ++demoRunIdRef.current;
    const roleId = targetRoleId ?? DEMO_ROLE_ID;
    const roleName = targetRoleName ?? DEMO_ROLE_NAME;
    const demoText = text.trim() || DEMO_CV_TEXT;

    if (!targetRoleId) {
      demoDataActiveRef.current = true;
      setTargetRoleId(roleId);
      setTargetRoleName(roleName);
    }

    setSkillsBusy(true);
    setSkillsError(null);

    try {
      // 1. Präzises Gap-Ergebnis mit klaren zu lernenden Skills (gap_skills)
      let gap = gapResult;
      if (!gap) {
        try {
          gap = await fetchGapAnalysis(baseUrl, apiKey, { text: demoText, target_role_id: roleId });
        } catch {
          gap = null;
        }

        if (demoRunIdRef.current !== runId) return;

        // Erzwinge aussagekräftige Daten, falls die API leer ist oder fehlschlägt
        if (!gap || !gap.gap_skills?.length) {
          gap = {
            tenant_id: "demo-tenant",
            target_role_id: roleId,
            target_role_name: roleName,
            match_percentage: 65.0,
            covered_skills: [
              {
                esco_uri: "http://data.europa.eu/esco/skill/demo-cov-1",
                preferred_label: "Grundlegende Programmierlogik",
                weight: 20,
                covered: true,
                matched_score: 95,
                description: "Fundiertes Verständnis durch Vorerfahrung vorhanden."
              }
            ],
            gap_skills: [
              {
                esco_uri: "http://data.europa.eu/esco/skill/demo-gap-1",
                preferred_label: "React.js & State Management",
                weight: 45,
                covered: false,
                matched_score: null,
                description: "Zentrale Anforderung für moderne Frontend-Architekturen."
              },
              {
                esco_uri: "http://data.europa.eu/esco/skill/demo-gap-2",
                preferred_label: "TypeScript Erweiterte Konzepte",
                weight: 35,
                covered: false,
                matched_score: null,
                description: "Wichtig für typsichere und skalierbare Webanwendungen."
              }
            ]
          };
        }

        setGapResult(gap);
        setText(demoText);
        setDepthByUri(new Map());
        setDepthOverallAssessment(null);
        setSelfLevelByUri(new Map());
        setManualSkillUris(new Set());
        manualSkillUrisRef.current = new Set();
      }

      // 2. Passende Weiterbildung mit starken Prozentwerten & Bezug zu den Gaps
      // 2. Echtes Kurs-Ergebnis im Stil des Screenshots (Data Engineering)
      if (!courseResult) {
        let courses;
        try {
          courses = await fetchCourseMatch(baseUrl, apiKey, { text: demoText, target_role_id: roleId });
        } catch {
          courses = null;
        }

        if (demoRunIdRef.current !== runId) return;

        if (!courses || !courses.recommended_courses?.length) {
          // Round 21, Bugfix ("bei der Journey sollen konkrete Kurse mit
          // allen vorhandenen Daten sichtbar sein"): hier stand vorher eine
          // komplett erfundene "DYD Akademie"-Kursliste mit falschen
          // Feldnamen (title/match_score/duration statt course_name/
          // duration_weeks) — dadurch blieb der Kurstitel auf der Kurskarte
          // im Rundgang leer (KursStep liest course.course_name, siehe
          // course-hero-name), UND es gab nie einen echten fullCourse-Treffer
          // im eigenen Katalog, wodurch Preis/Förderung/UE/Abschluss/
          // Buchungslink komplett fehlten. pickShowcaseCourses() greift
          // stattdessen auf ECHTE Kurse aus dem eigenen Katalog zurück, die
          // eigenen Fallback greift genau dann, wenn die echte
          // Matching-API für die Demo-Rolle (DEMO_ROLE_ID) keinen Treffer
          // liefert — z.B. wenn eigene Kurse noch keine passende Zielrolle
          // gepflegt haben, oder die in add-demo-courses.sql angelegten
          // Demo-Kurse noch auf der alten role_id stehen (siehe Kommentar an
          // DEMO_ROLE_ID oben).
          const showcase = pickShowcaseCourses(allCourses, 3);
          courses = {
            tenant_id: "demo-tenant",
            target_role_id: roleId,
            target_role_name: roleName,
            match_percentage: gap?.match_percentage ?? 0,
            gap_skill_count: gap?.gap_skills?.length ?? 0,
            recommended_courses: showcase,
          };
        }

        setCourseResult(courses);
        setSelectedCourseId(courses.recommended_courses?.[0]?.course_id ?? null);
        setDesiredStart(null);
      }
    } catch (err) {
      console.error("[JourneyPage] runDemoAnalysis:", err);
    } finally {
      setSkillsBusy(false);
    }
  }
  /** Schliesst den Rundgang und raeumt dabei ungenutzte Demo-Daten wieder
   * weg (siehe demoDataActiveRef oben) - sonst koennte ein direkt danach
   * gestarteter ECHTER Durchlauf mit derselben Zielrolle (bei DYD im Alltag
   * naheliegend, die Demo-Rolle ist "Junior Web Developer") auf
   * selectRole()s "schon ausgewaehlt"-Guard treffen und dadurch die stehen
   * gebliebenen Demo-Werte (Beispieltext, Beispiel-Ergebnis) unveraendert
   * weiterverwenden, statt neu zu rechnen. */
  function tourClose() {
    setTourOpen(false);
    demoRunIdRef.current++; // eine noch laufende Demo-Anfrage als ueberholt markieren
    if (!demoDataActiveRef.current) return;
    demoDataActiveRef.current = false;
    setKnowsRole(null);
    setInterestArea(null);
    setCareerGoal(null);
    setEmploymentType(null);
    setWorkLocation(null);
    setFundingPreference(null);
    setCurrent(-1);
    setTargetRoleId(null);
    setTargetRoleName(null);
    setMethod(null);
    setText("");
    setRoleSkills([]);
    setCheckedSkills(new Set());
    setSkillDepthByUri(new Map());
    setGapResult(null);
    setDepthByUri(new Map());
    setDepthOverallAssessment(null);
    setSelfLevelByUri(new Map());
    setManualSkillUris(new Set());
    manualSkillUrisRef.current = new Set();
    setCourseResult(null);
    setSelectedCourseId(null);
    setAdditionalCourseIds(new Set());
    setDesiredStart(null);
    setTestId(null);
    setConsultationBusy(false);
    setConsultationError(null);
    setConsultationSent(false);
  }
  // Zielrollen
  const [roles, setRoles] = useState<TargetRole[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [targetRoleId, setTargetRoleId] = useState<string | null>(null);
  const [targetRoleName, setTargetRoleName] = useState<string | null>(null);
  /** Gesetzt statt einer echten ROLES_CATALOG-Rolle, wenn der Bereichs-
   *  Kurzweg genutzt wurde (siehe selectBereich unten, 15.09., "ohne die
   *  Verknüpfung zu einer spezifischen Zielposition") — buildBereichRole()
   *  vereinigt die Skills aller Rollen der gewählten Bereiche zu einer
   *  Pseudo-Rolle. effectiveRoles hängt jede analyzeGap()/matchCoursesToGap()-
   *  Stelle daran, damit diese Pseudo-Rolle dort gefunden wird (Default
   *  ROLES_CATALOG kennt sie sonst nicht). */
  const [bereichRole, setBereichRole] = useState<CatalogRole | null>(null);
  const effectiveRoles = useMemo(
    () => (bereichRole ? [...ROLES_CATALOG, bereichRole] : ROLES_CATALOG),
    [bereichRole]
  );
  // Skills-Methode
  const [method, setMethod] = useState<Method>(null);
  const [text, setText] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ msg: string; kind: "ok" | "err" | "" }>({ msg: "", kind: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Berechnet die Rollen-Vorschlaege fuer RoleSuggestStep aus den
  // angeklickten Skills (roleSuggestSkillIds oben) — rein lokale
  // roleSuggestions (skill-basierte Rollenvorschlaege mit Match-%) entfiel
  // am 15.09. zusammen mit den Rollenkarten in RoleSuggestStep (siehe
  // Kommentar dort) - der Schritt bindet nicht mehr an eine einzelne Rolle,
  // suggestRolesForSkillIds() wird hier daher nicht mehr aufgerufen.
  const [roleSkills, setRoleSkills] = useState<RoleSkillStatus[]>([]);
  const [loadingRoleSkills, setLoadingRoleSkills] = useState(false);
  const [roleSkillsError, setRoleSkillsError] = useState<string | null>(null);
  // Bugfix 22.09.2026 (siehe ausführlicher Kommentar an pickCoreQuestionSkills
  // oben): die EINE Quelle der Wahrheit dafür, welche Skills im
  // Fragebogen-Pfad gefragt werden — FragebogenMethod (Anzeige) UND
  // buildQuizGapResult() (Berechnung) nutzen beide genau diese Liste, damit
  // "gefragt" und "gewertet" nie wieder auseinanderlaufen.
  const questionSkills = useMemo(() => pickCoreQuestionSkills(roleSkills), [roleSkills]);
  const [checkedSkills, setCheckedSkills] = useState<Set<string>>(new Set());
  // Teil 2 (22.09.2026, siehe ausführlicher Kommentar an SkillDepth/
  // quizSkillScore oben): Grad + Aktualität je Skill, parallel zu
  // checkedSkills geführt (checkedSkills bleibt die schnelle "vorhanden?"-
  // Abfrage, die an vielen Stellen im Datei schon genutzt wird — z.B.
  // submitQuizMethod weiter unten). Wird ausschließlich über
  // answerQuizSkill() unten verändert, damit beide States nie auseinander-
  // laufen können.
  const [skillDepthByUri, setSkillDepthByUri] = useState<Map<string, SkillDepth>>(new Map());
  const [skillsBusy, setSkillsBusy] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  // Gap / Kurs
  const [gapResult, setGapResult] = useState<GapAnalysisResponse | null>(null);
  const [gapBusy, setGapBusy] = useState(false);
  const [gapError, setGapError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  // KI-Tiefenanalyse (Version 19): reine Anreicherung der schnellen
  // Fuzzy-Gap-Analyse oben um woertliche Belege pro Skill - nach esco_uri
  // nachschlagbar. Laeuft NACH dem schnellen Gap-Ergebnis, bewusst
  // nicht-blockierend (siehe runDepthAnalysis) - schlaegt sie fehl oder
  // dauert laenger, sieht der Nutzer trotzdem sofort sein Fuzzy-Ergebnis.
  const [depthByUri, setDepthByUri] = useState<Map<string, DepthSkillAssessment>>(new Map());
  /** Ganzheitliche Experten-Einschätzung der KI-Tiefenanalyse (Version 3 der
   *  Edge Function, siehe overall_assessment in orbit.ts) — separat vom
   *  Skill-für-Skill depthByUri gehalten, da sie sich nicht auf einen
   *  einzelnen Skill bezieht, sondern auf den gesamten Lebenslauf. */
  const [depthOverallAssessment, setDepthOverallAssessment] = useState<string | null>(null);
  const [depthBusy, setDepthBusy] = useState(false);
  // Eigene Erfahrungslevel-Einschätzung der Person zu ihren "vorhanden"-Skills
  // (neu, siehe GapStep): unabhängig von depth?.proficiency_level (das ist die
  // Einschätzung der KI-Tiefenanalyse) - hier wählt die Person selbst, wird
  // beim Anzeigen aber mit dem KI-Vorschlag vorbelegt (siehe selfLevelFor()
  // in GapStep), solange sie noch nichts Eigenes gewählt hat. Nur nach
  // esco_uri, aus demselben Grund wie depthByUri (siehe dortigen Kommentar).
  const [selfLevelByUri, setSelfLevelByUri] = useState<Map<string, ProficiencyLevel>>(new Map());
  // Manuell von der Person im Gap-Schritt korrigierte Skills (siehe
  // handleMoveSkill/moveSkillManually) - "Möglichkeit die Skills am Ende zu
  // entfernen oder neu hinzufügen, also manuell". Zwei Dinge nach esco_uri:
  // WELCHE Skills angefasst wurden (fürs Anzeigen/für skillReasonInfo) UND
  // ein Ref-Spiegel davon (manualSkillUrisRef), damit runDepthAnalysis()
  // unten - das ja erst nach einem Await asynchron zurückkommt - beim
  // funktionalen setGapResult(current => ...) den JEWEILS AKTUELLEN Stand
  // sieht statt eines zum Zeitpunkt des API-Aufrufs eingefrorenen (dasselbe
  // Stale-Closure-Muster wie an anderer Stelle in dieser Datei, z.B.
  // demoDataActiveRef/consentGiven, siehe dortige Kommentare).
  const [manualSkillUris, setManualSkillUris] = useState<Set<string>>(new Set());
  const manualSkillUrisRef = useRef<Set<string>>(new Set());
  const [courseResult, setCourseResult] = useState<CourseMatchResponse | null>(null);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  // Aktive Kursauswahl im Kurs-Schritt (Version 15): standardmäßig die beste
  // Empfehlung, die Person kann aber bewusst einen der Alternativ-Kurse
  // wählen. Macht die spätere Anfrage konkreter als "irgendeine Empfehlung"
  // — der Bildungsträger sieht genau, für welchen Kurs sich die Person aktiv
  // entschieden hat.
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  // Zusätzlich ausgewählte Kurse (Version 19): im Kurs-Schritt kann die Person
  // über die "Auch anfragen"-Checkbox an den Kurskarten (siehe course-hero-also
  // in journey.css) neben ihrem Favoriten (selectedCourseId) weitere Kurse
  // markieren, die SEPARAT mit angefragt werden sollen — siehe submitLead
  // unten (ein Lead pro Kurs, keine Backend-Änderung nötig).
  const [additionalCourseIds, setAdditionalCourseIds] = useState<Set<string>>(new Set());
  // Gewünschter Startzeitpunkt, seit Version 24 im eigenen "Präferenzen"-
  // Schritt gleich nach dem Ziel-Schritt abgefragt (optional, um die Hürde
  // niedrig zu halten) — zusätzliches Qualifizierungsmerkmal für den Lead,
  // das der Bildungsträger direkt für die Priorisierung nutzen kann.
  const [desiredStart, setDesiredStart] = useState<string | null>(null);
  // Beschäftigungsart (Vollzeit/Teilzeit) und gewünschter Arbeitsort
  // (Remote/Vor Ort), Version 24: ebenfalls im "Präferenzen"-Schritt
  // abgefragt, beide optional wie desiredStart.
  const [employmentType, setEmploymentType] = useState<string | null>(null);
  const [workLocation, setWorkLocation] = useState<string | null>(null);
  // Förderungs-Präferenz (Version 32, 14.09. — "ob es förderfähig ist ...
  // soll auch ins Matching einfließen"), ebenfalls im "Präferenzen"-Schritt
  // abgefragt, gleiches Muster wie employmentType/workLocation oben: "egal"
  // ist eine ausdrueckliche "keine Praeferenz"-Antwort, unterscheidet sich
  // von einfachem Uebergehen der Frage (null).
  const [fundingPreference, setFundingPreference] = useState<string | null>(null);
  // Einkategorisierung (Zertifikat/Seminar/Weiterbildung/Studium) und
  // gewünschte Dauer, Version 28/17.09. ("danach gefragt werden ob man
  // schon weiss was man machen will ... und die Dauer soll auch abgefragt
  // werden"), ebenfalls im "Präferenzen"-Schritt abgefragt, gleiches Muster
  // wie oben: null = übersprungen, "weiss-noch-nicht"/"lang" = ausdrückliche
  // "keine Präferenz"-Antwort (siehe CATEGORY_OPTIONS/DURATION_OPTIONS).
  const [categoryPreference, setCategoryPreference] = useState<string | null>(null);
  const [desiredDuration, setDesiredDuration] = useState<string | null>(null);
  // Voraussetzungs-Auskunft (Version 34, 22.09., "es muss auch auf
  // Vorraussetzungen bei den Kursen drauf eingegangen werden"), ebenfalls im
  // "Präferenzen"-Schritt abgefragt, gleiches Muster wie oben: null =
  // übersprungen (siehe QUALIFICATION_OPTIONS/EXPERIENCE_OPTIONS/
  // LANGUAGE_LEVEL_OPTIONS — bewusst keine "egal"-Option, siehe Kommentar
  // dort). qualificationLevel/germanLevel speichern den gewählten Key
  // (orbit.ts-QualificationLevel bzw. CEFR-Untergrenze), experienceYears die
  // Untergrenze des gewählten Buckets in Jahren.
  const [qualificationLevel, setQualificationLevel] = useState<string | null>(null);
  const [experienceYears, setExperienceYears] = useState<number | null>(null);
  const [germanLevel, setGermanLevel] = useState<string | null>(null);
  // Test-Tracking (Version 14): merkt sich die id des zuletzt geloggten
  // Skill-Checks, damit wir ihr im Kurs-Schritt die Empfehlung nachtragen
  // können. Rein statistisch fürs Bildungsträger-Dashboard — schlägt das
  // Loggen fehl, bekommt der Endnutzer davon nichts mit.
  const [testId, setTestId] = useState<number | null>(null);
  // Vom Bildungsträger im Dashboard als "Top" markierte Kurse — werden
  // unten im Kurs-Schritt zusätzlich zur individuellen Empfehlung gezeigt.
  const [featuredCourses, setFeaturedCourses] = useState<OrbitCourse[]>([]);
  // Kompletter Kurskatalog (Version 20) — dieselbe Antwort wie featuredCourses,
  // nur ungefiltert. Wird für die Ziel-Personalisierung gebraucht (siehe
  // personalizeCourseOrder/goalFitReason unten): CourseRecommendation aus
  // /course-match kennt kein location_mode, nur der volle Katalog hier.
  // Kein zusätzlicher Request — derselbe fetchCourses()-Aufruf wie bisher.
  const [allCourses, setAllCourses] = useState<OrbitCourse[]>([]);
  const [courseCatalogError, setCourseCatalogError] = useState<string | null>(null);
  const [courseCatalogLoading, setCourseCatalogLoading] = useState(false);
  const [courseCatalogLoadedAt, setCourseCatalogLoadedAt] = useState<number | null>(null);
  // Portfolio-Filter, finale Fassung (15.09., Feedback "wir müssen am
  // Dashboard ansetzen und das als Fixpunkt hinterlegen"): Bereich ist im
  // Kursformular jetzt Pflichtfeld (siehe bereich_key in orbit.ts) — die
  // zuverlaessige Quelle dafuer, welche Bereiche/Rollen ein Bildungstraeger
  // ueberhaupt anbietet, statt wie zuvor aus optionalen Skill-/Zielrollen-
  // Zuordnungen zu raten.
  const coveredBereiche = useMemo(() => getCoveredBereiche(allCourses), [allCourses]);
  const rolesInPortfolio: CatalogRole[] = useMemo(
    () => rolesWithBereichCoverage(coveredBereiche),
    [coveredBereiche]
  );
  const bereicheInPortfolio: BereichOption[] = useMemo(() => listBereiche(rolesInPortfolio), [rolesInPortfolio]);
  // Einkategorisierung-Optionen, gefiltert auf das, was im Kurskatalog des
  // Tenants tatsächlich vorkommt (17.09., "Bei der Auswahl soll ... nur das
  // zur Auswahl stehen, was auch im Kurskatalog so angelegt wurde, wenn es
  // gar nicht ausgewählt wurde, dann soll der Button auch nicht sichtbar
  // sein") — exaktes Vorbild: bereicheInPortfolio oben (aus allCourses via
  // getCoveredBereiche). "weiss-noch-nicht" bleibt IMMER sichtbar (ist keine
  // Katalog-Kategorie, sondern die "keine Präferenz"-Antwort selbst — die
  // muss unabhängig vom Katalog wählbar bleiben, sonst gäbe es u.U. gar
  // keine Option mehr, falls der Katalog leer ist).
  const coveredCourseCategories = useMemo(() => {
    const keys = new Set<string>();
    for (const c of allCourses) {
      if (c.course_category) keys.add(c.course_category);
    }
    return keys;
  }, [allCourses]);
  const categoryOptionsInPortfolio = useMemo(
    () => CATEGORY_OPTIONS.filter((o) => o.key === "weiss-noch-nicht" || coveredCourseCategories.has(o.key)),
    [coveredCourseCategories]
  );
  // Bereich-Label der aktuell aktiven Zielrolle (15.09., fuer den
  // kombinierten Ziel+Bereich-Pitch in KursStep/buildCoursePitch) —
  // funktioniert fuer BEIDE Faelle: die synthetische Bereichs-Rolle
  // (bereichRole.bereich_label ist bereits die zusammengesetzte
  // Bereichs-Bezeichnung mehrerer gewählter Bereiche) und eine konkret vom
  // Nutzer gewaehlte einzelne Rolle (echtes bereich_label-Feld dieser Rolle
  // aus rolesInPortfolio) — in beiden Faellen ein echtes Katalog-Feld,
  // nichts erfunden.
  const targetBereichLabel = useMemo(
    () => bereichRole?.bereich_label ?? rolesInPortfolio.find((r) => r.role_id === targetRoleId)?.bereich_label ?? null,
    [bereichRole, rolesInPortfolio, targetRoleId]
  );
  // Lead
  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  // Telefonnummer (Version 27, siehe LeadStep) — optional wie leadName/
  // leadEmail selbst schon vorher, aus demselben Grund: ein zusätzliches
  // Pflichtfeld hier würde nur die Abbruchrate erhöhen.
  const [leadPhone, setLeadPhone] = useState("");
  // Freitext-Anliegen (Rückmeldung 17.09., "es soll da auch ein kleines
  // Freitextfeld geben in dem man schon konkrete Anliegen schildern kann") —
  // optional wie leadPhone, damit die Person schon beim Absenden konkret
  // werden kann (z.B. "Ich habe schon Excel-Grundkenntnisse" oder
  // "Kann ich das Modul auch abends machen?"), statt das erst im
  // Beratungsgespräch nachzuholen.
  const [leadMessage, setLeadMessage] = useState("");
  const [consent, setConsent] = useState(false);
  // DSGVO-Nachweis (Version 28): ISO-Zeitstempel, WANN die Person im CV-
  // Schritt (CvMethod) der Verarbeitung durch die KI zugestimmt hat — anders
  // als die lokale dsgvoConsent-Checkbox dort (die bewusst pro Aufenthalt im
  // Schritt zurückgesetzt wird, siehe Kommentar bei CvMethod) bleibt DIESER
  // Zeitstempel für den Rest der Sitzung erhalten, damit er beim Anlegen des
  // Leads mitgeschickt werden kann. null = Schritt in dieser Sitzung nie
  // erreicht/bestätigt (z.B. Fragebogen statt CV-Upload genutzt).
  const [cvProcessingConsentAt, setCvProcessingConsentAt] = useState<string | null>(null);
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);
  // "Ich möchte mich zusätzlich noch persönlich beraten lassen" (Version 20,
  // vorher ein eigener, von der Kursanfrage GETRENNTER Absende-Button mit
  // eigenem Lead — das erzeugte für dieselbe Person zwei getrennte
  // Lead-Datensätze im Dashboard und war leicht zu übersehen, weil der
  // Button erst UNTER der eigentlichen CTA stand). Jetzt eine einfache
  // Checkbox, prominent vor dem Absenden platziert (siehe LeadStep) — wird
  // beim normalen Absenden als consultation_requested MIT demselben Lead
  // gespeichert (siehe submitLead), kein separater Absende-Schritt mehr.
  const [wantsConsultation, setWantsConsultation] = useState(false);
  // E-Mail-Zwischenspeicherung (Version 18): erlaubt es, das Ergebnis schon im
  // Gap-Schritt per E-Mail zu sichern, statt es zu riskieren, dass jemand vor
  // dem eigentlichen Kontaktformular abspringt und der Bildungsträger nie
  // etwas von diesem Interessenten erfährt. Nutzt bewusst dieselben
  // leadEmail/consent-States wie der finale LeadStep weiter unten — wer hier
  // sichert, hat das Formular am Ende quasi schon ausgefüllt.
  const [earlyCaptureBusy, setEarlyCaptureBusy] = useState(false);
  const [earlyCaptureError, setEarlyCaptureError] = useState<string | null>(null);
  const [earlyLeadSaved, setEarlyLeadSaved] = useState(false);
  useEffect(() => {
    loadRoles();
    loadFeaturedCourses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Smoother Übergang zwischen den Schritten: springt beim Schrittwechsel an
  // den Anfang des Widgets, statt den Nutzer mitten im vorherigen Inhalt
  // (z.B. nach dem Scrollen durch eine lange Fragebogen-Liste) stehen zu
  // lassen. Harmlos, falls das Widget gar nicht scrollt.
  useEffect(() => {
    widgetBodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [current, done, knowsRole]);
  async function loadRoles() {
    if (!apiKey) {
      setRolesError(
        "Dieser Weiterbildungs-Finder ist noch nicht mit dem Kurssystem verbunden. Bitte wende dich an den Anbieter."
      );
      setLoadingRoles(false);
      return;
    }
    setLoadingRoles(true);
    setRolesError(null);
    try {
      const res = await fetchTargetRoles(baseUrl, apiKey);
      setRoles(res);
    } catch (err) {
      setRolesError(reportError("loadRoles", err));
    } finally {
      setLoadingRoles(false);
    }
  }
  /** Lädt den Kurskatalog und filtert auf die vom Bildungsträger im Dashboard
   * markierten "Top"-Kurse. Rein optionaler Zusatzinhalt — schlägt das fehl
   * (z.B. weil das Backend noch nicht auf Version 14 aktualisiert wurde),
   * bleibt die Sektion einfach leer, ohne die Journey zu stören. */
  async function loadFeaturedCourses() {
    if (!apiKey) {
      setFeaturedCourses([]);
      setAllCourses([]);
      setCourseCatalogError("API-Key fehlt.");
      return;
    }

    setCourseCatalogLoading(true);
    setCourseCatalogError(null);

    try {
      console.info("[JourneyPage] course_catalog_loading", {
        baseUrl,
        timestamp: new Date().toISOString(),
      });

      const res = await fetchCourses(baseUrl, apiKey);
      const rawCatalog = Array.isArray(res?.courses) ? res.courses : [];
      // NEU (18.09., Rückmeldung "wenn der Startzeitpunkt überschritten ist,
      // sollen die Kurse nicht angezeigt werden"): ein Kurs, bei dem ALLE
      // Termine bereits gestartet sind, taucht in der Endnutzer-Journey
      // konsequent gar nicht mehr auf (siehe isCourseActive() in orbit.ts).
      // Ein Kurs ohne jede Terminangabe gilt weiterhin als dauerhaft aktiv.
      const catalog = rawCatalog.filter((c) => isCourseActive(c));

      setFeaturedCourses(catalog.filter((c) => c.is_featured));
      setAllCourses(catalog);
      setCourseCatalogLoadedAt(Date.now());

      console.info("[JourneyPage] course_catalog_loaded", {
        course_count: catalog.length,
        featured_count: catalog.filter((c) => c.is_featured).length,
        hidden_past_count: rawCatalog.length - catalog.length,
      });

      if (catalog.length === 0) {
        setCourseCatalogError(
          "Der Kurskatalog hat keine veröffentlichten Weiterbildungen zurückgegeben."
        );
      }
    } catch (err) {
      console.error("[JourneyPage] course_catalog_failed:", err);
      setFeaturedCourses([]);
      setAllCourses([]);
      setCourseCatalogError(
        err instanceof Error
          ? err.message
          : "Der Kurskatalog konnte nicht geladen werden."
      );
    } finally {
      setCourseCatalogLoading(false);
    }
  }
  /** Ziel-Schritt (Version 16, ganz am Anfang der Journey): speichert die
   * Motivation und springt weiter zum neuen "Präferenzen"-Schritt (Version
   * 24, siehe PraeferenzenStep/continuePreferences). goalKey ist null, wenn
   * die Person die Frage bewusst uebersprungen hat (siehe GoalStep-Skip-Link)
   * — bleibt dann einfach ohne Personalisierung im Kurs-Schritt/Lead. */
  function selectGoal(goalKey: string | null) {
    demoDataActiveRef.current = false;
    setCareerGoal(goalKey);
    setCurrent(stepIndex("praeferenzen"));
  }
  /** Präferenzen-Schritt (Version 24): Beschäftigungsart/Arbeitsort/
   * Startzeitpunkt sind reine State-Updates (siehe PraeferenzenStep-Props),
   * dieser Callback übernimmt nur die Weiterleitung zum ursprünglichen Ziel
   * von selectGoal — "bereich" im "Ich weiss noch nicht"-Pfad, sonst direkt
   * "zielrolle". Alle drei Felder sind optional, es gibt daher keinen
   * eigenen Skip-Link — "Weiter" funktioniert immer, auch ohne Auswahl. */
  function continuePreferences() {
    demoDataActiveRef.current = false;
    setCurrent(stepIndex(knowsRole === false ? "bereich" : "zielrolle"));
  }
  /** Springt vom RoleSuggestStep aus per "Lieber selbst stoebern" in die
   *  vollstaendige, durchsuchbare Zielrollen-Liste (ZielrolleStep) — ohne
   *  Vorsortierung, siehe Kommentar bei der entfernten AREAS-Konstante
   *  weiter oben. */
  function browseAllRoles() {
    setCurrent(stepIndex("zielrolle"));
  }
  function selectRole(role: TargetRole) {
    // Vor dem Guard: eine echte Auswahl "entwertet" gegebenenfalls noch
    // stehende Demo-Daten aus dem Rundgang, auch wenn der Guard unten (bei
    // ohnehin schon gleicher Rolle) sonst nichts weiter tut.
    demoDataActiveRef.current = false;
    // Eine konkrete Rolle ersetzt eine evtl. noch gesetzte Bereichs-Pseudo-
    // Rolle (siehe selectBereich unten) wieder vollständig.
    setBereichRole(null);
    if (role.role_id === targetRoleId) return;
    setTargetRoleId(role.role_id);
    setTargetRoleName(role.role_name);
    // Rollenwechsel: alles, was von der Zielrolle abhängt, zurücksetzen.
    // NICHT mehr zurueckgesetzt: text (14.09., "Zielrolle noch smarter
    // loesen") — ein bereits hochgeladener Lebenslauf bleibt beim
    // Rollenwechsel erhalten, damit man mehrere vorgeschlagene Rollen
    // vergleichen kann, ohne jedes Mal neu hochzuladen; der Skills-Schritt
    // rechnet die Gap-Analyse fuer die neue Rolle ohnehin neu.
    setMethod(null);
    setRoleSkills([]);
    // Skills, die im Bereich-Schritt ausgewählt wurden, sind LERNZIELE,
    // nicht bereits vorhandene Skills. Der anschließende Skill-Check startet
    // deshalb bewusst ohne Vorbelegung.
    setCheckedSkills(new Set());
    setSkillDepthByUri(new Map());
    setGapResult(null);
    setCourseResult(null);
    setSelectedCourseId(null);
    setAdditionalCourseIds(new Set());
    setTestId(null);
  }
  /** Bereichs-Kurzweg aus RoleSuggestStep (15.09., "ich will nur, dass man
   *  den Bereich auswählt ... der Prozess muss aber danach weiterlaufen ohne
   *  die Verknüpfung zu einer spezifischen Zielposition") — Gegenstück zu
   *  selectRole() oben, bindet aber bewusst NICHT an eine einzelne
   *  ROLES_CATALOG-Rolle, sondern an eine synthetische "Bereichs-Rolle"
   *  (buildBereichRole(), gapAnalysis.ts), die die Skills aller Rollen der
   *  gewählten Bereiche vereinigt. Alle analyzeGap()/matchCoursesToGap()-
   *  Aufrufe unten nutzen effectiveRoles (oben), damit diese Pseudo-Rolle
   *  dort gefunden wird. */
  function selectBereich(bereichKeys: string[]) {
    demoDataActiveRef.current = false;
    // careerGoal (Ziel-Schritt, siehe GOAL_OPTIONS) fliesst seit 15.09. in
    // die Skill-Gewichtung der Bereichs-Rolle ein (siehe buildBereichRole()
    // in gapAnalysis.ts) — "es soll mehr nach dem allgemeinen Ziel gehen".
    const role = buildBereichRole(bereichKeys, rolesInPortfolio, careerGoal);
    setBereichRole(role);
    if (role.role_id === targetRoleId) return;
    setTargetRoleId(role.role_id);
    setTargetRoleName(role.role_name);
    setMethod(null);
    setRoleSkills([]);
    // Bereichs-Skills sind Lernziele. Der Skill-Check soll danach separat
    // ermitteln, welche dieser und weiteren Skills bereits vorhanden sind.
    setCheckedSkills(new Set());
    setSkillDepthByUri(new Map());
    setGapResult(null);
    setCourseResult(null);
    setSelectedCourseId(null);
    setAdditionalCourseIds(new Set());
    setTestId(null);
  }
  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    demoDataActiveRef.current = false;
    setUploadBusy(true);
    setUploadStatus({ msg: "", kind: "" });
    try {
      const res = await extractDocumentText(baseUrl, apiKey, file);
      setText(res.text);
      setUploadStatus({ msg: `✓ ${file.name} eingelesen (${res.char_count} Zeichen).`, kind: "ok" });
      // Version 26: direkt weiter zum Skill-Gap, kein zusaetzlicher manueller
      // "Skill-Gap berechnen"-Klick mehr noetig — sobald der Lebenslauf
      // erfolgreich eingelesen ist, landet man automatisch auf dem
      // Gap-Schritt (siehe runGapAnalysis). Der Button bleibt trotzdem
      // erhalten (siehe ActionsRow in CvMethod) als manueller Fallback, z.B.
      // falls runGapAnalysis selbst fehlschlaegt (setSkillsError) und man es
      // ohne erneuten Upload nochmal versuchen will.
      const trimmed = res.text.trim();
      if (trimmed) {
        runGapAnalysis(trimmed);
      }
    } catch (err) {
      console.error("[JourneyPage] extractDocumentText:", err);
      // Bewusst NICHT ueber reportError() (das wuerde die Meldung immer
      // durch einen generischen Text ersetzen) - extractDocumentText() in
      // core.ts liefert bei PDF-/Datei-Problemen bereits eine gezielt fuer
      // Endnutzer geschriebene Meldung (siehe Kommentar dort), die zeigen
      // wir hier direkt an, statt sie wegzuwerfen.
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "Das hat gerade leider nicht geklappt — das liegt nicht an dir. Bitte versuch es gleich nochmal.";
      setUploadStatus({ msg, kind: "err" });
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }
  /** Version 26 — ZWEISTUFIG, damit JEDE Zielrolle funktioniert, die in der
   *  Auswahl ueberhaupt auftaucht (siehe loadRoles/fetchTargetRoles oben —
   *  DIE kommt vom Backend, das auch selbst angelegte Zielrollen kennt),
   *  nicht nur die 74 im statischen lokalen Katalog (rolesCatalog.ts):
   *  zuerst der schnelle, netzwerklose lokale Fuzzy-Abgleich (analyzeGap) -
   *  kennt er die Rolle nicht (z.B. eine im Dashboard per "+ Neue Zielrolle"
   *  angelegte, rein backend-seitige Rolle), automatisch auf die ECHTE
   *  Backend-Gap-Analyse zurueckfallen, die jede Zielrolle kennt, die das
   *  Backend kennt. So bricht der Prozess nie mit "Zielrolle nicht gefunden"
   *  ab, nur weil die Rolle zufaellig nicht in den 74 vordefinierten steckt -
   *  vorher ein Sackgassen-Fehler (siehe Diagnose-Kommentar, der das erst
   *  aufgedeckt hat), nur noch ein (kaum merklicher) Umweg über einen echten
   *  API-Call. */
  async function loadRoleSkills() {
    if (!targetRoleId) return;
    setLoadingRoleSkills(true);
    setRoleSkillsError(null);
    try {
      const local = analyzeGap("", targetRoleId, { roles: effectiveRoles });
      if (local) {
        setRoleSkills([...local.gap_skills, ...local.covered_skills]);
      } else {
        const res = await fetchGapAnalysis(baseUrl, apiKey, {
          text: "",
          target_role_id: targetRoleId,
          lang: ESCO_LANG,
        });
        setRoleSkills([...res.gap_skills, ...res.covered_skills]);
      }
    } catch (err) {
      setRoleSkillsError(reportError("loadRoleSkills", err));
    } finally {
      setLoadingRoleSkills(false);
    }
  }
  useEffect(() => {
    if (method === "fragebogen" && roleSkills.length === 0 && !loadingRoleSkills && !roleSkillsError) {
      loadRoleSkills();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method]);
  function toggleSkill(uri: string) {
    setCheckedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
  }
  /** Teil 2 (22.09.2026): einziger Schreibpfad für Fragebogen-Antworten mit
   *  Tiefe — hält checkedSkills (schnelle "vorhanden?"-Abfrage, u.a. in
   *  buildQuizGapResult/submitQuizMethod genutzt) und skillDepthByUri (Grad +
   *  Aktualität) synchron. depth !== null → "vorhanden" mit dieser Tiefe;
   *  depth === null → "nicht vorhanden"/zurückgenommen, löscht eine evtl.
   *  vorherige Tiefen-Angabe vollständig (kein Rest-Zustand). Ersetzt
   *  toggleSkill() für den Fragebogen-Pfad (toggleSkill bleibt unverändert
   *  für alles andere, das binäres Setzen ohne Tiefe braucht). */
  function answerQuizSkill(uri: string, depth: SkillDepth | null) {
    setCheckedSkills((prev) => {
      const has = prev.has(uri);
      if (depth !== null ? has : !has) return prev;
      const next = new Set(prev);
      if (depth !== null) next.add(uri);
      else next.delete(uri);
      return next;
    });
    setSkillDepthByUri((prev) => {
      if (depth !== null) {
        const next = new Map(prev);
        next.set(uri, depth);
        return next;
      }
      if (!prev.has(uri)) return prev;
      const next = new Map(prev);
      next.delete(uri);
      return next;
    });
  }
  /** Markiert/entfernt einen weiteren Kurs für die Mehrfach-Kursanfrage
   * (Version 19, siehe additionalCourseIds oben) — unabhängig vom per Klick
   * gewählten Favoriten (selectedCourseId). */
  function toggleAdditionalCourse(courseId: string) {
    setAdditionalCourseIds((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  }
  /** Rückmeldung 17.09. ("wenn ich einen Kurs oben auswähle, dann darf der
   *  nicht weggehen, wenn ich auf den anderen klicke"): selectedCourseId ist
   *  ein EINZELNER Wert — bisher ersetzte ein Klick auf eine andere Karte den
   *  bisherigen Favoriten schlicht (setSelectedCourseId direkt als
   *  onSelectCourse), ohne ihn irgendwo festzuhalten. War er nicht zusätzlich
   *  per "Auch anfragen"-Haken markiert, verschwand er dadurch komplett aus
   *  der Anfrage — obwohl die Person ihn zuvor bewusst ausgewählt hatte.
   *  Jetzt: der bisherige Favorit wandert beim Wechsel automatisch in
   *  additionalCourseIds (dieselbe Menge wie "Auch anfragen"), statt verloren
   *  zu gehen — er bleibt Teil der Anfrage, nur nicht mehr der neue
   *  Hauptfavorit. Ein erneuter Wechsel zurück fügt ihn kein zweites Mal
   *  hinzu (Set), und solange er der aktuelle Hauptfavorit ist, blendet der
   *  bestehende ".filter((id) => id !== selectedCourseId)" (siehe
   *  additionalCourseNames/extraCourseIds) ihn ohnehin aus der "zusätzlich"-
   *  Liste aus. */
  function handleSelectCourse(courseId: string) {
    if (selectedCourseId && selectedCourseId !== courseId) {
      setAdditionalCourseIds((prev) => {
        const next = new Set(prev);
        next.add(selectedCourseId);
        return next;
      });
    }
    setSelectedCourseId(courseId);
  }
  /** KI-Tiefenanalyse (Version 19): NACH dem schnellen Fuzzy-Gap-Ergebnis
   * aufgerufen, nie davor/anstelle. Bewusst fire-and-forget wie createTest
   * oben - dauert der OpenAI-Call laenger oder schlaegt er fehl (z.B. Modell
   * noch nicht freigeschaltet), bleibt die Journey fuer den Nutzer trotzdem
   * nutzbar, es fehlen nur die zusaetzlichen Beleg-Zitate. NUR mit echtem
   * Freitext sinnvoll - der Fragebogen-Pfad (buildQuizGapResult) hat keinen
   * Lebenslauf-Text und ruft diese Funktion deshalb nie auf.
   *
   * Version 29: Sobald die Tiefenanalyse zurück ist, wird gapResult per
   * refineGapWithDepthAnalysis() NEU eingeordnet (siehe dortigen Kommentar)
   * — nicht mehr nur als Anzeige-Beiwerk. Bewusst über die funktionale
   * setGapResult(current => ...)-Form gelesen/geschrieben statt über einen
   * separat hereingereichten "baseGapResult"-Parameter: React garantiert,
   * dass "current" beim tatsächlichen Ausführen des Updaters (nach dem
   * Await von fetchDepthAnalysis) der dann aktuelle State ist, das übliche
   * Stale-Closure-Risiko (vgl. submitLead()/consentGiven) besteht hier also
   * nicht, ganz ohne einen zusätzlichen Parameter, der nur den Zustand von
   * VOR dem API-Call einfrieren würde. */
  async function runDepthAnalysis(
    textToUse: string,
    roleId: string,
    skillTargets: { esco_uri: string; weight: number }[] = []
  ): Promise<void> {
    const requestId = crypto.randomUUID();
    const depthUrl = DEPTH_ANALYSIS_URL || depthAnalysisBaseUrl(baseUrl);
    const isBereichAnalysis = roleId.startsWith("bereich:");
    const uniqueTargets = Array.from(
      new Map<string, { esco_uri: string; weight: number }>(
        skillTargets.map((s) => [s.esco_uri, s])
      ).values()
    ).slice(0, 40);

    console.info("[JourneyPage] depth_analysis_started", {
      request_id: requestId,
      role_id: roleId,
      cv_chars: textToUse.length,
      endpoint: depthUrl,
      mode: isBereichAnalysis ? "bereich_skill_set" : "target_role",
      skill_targets: uniqueTargets.length,
    });

    setDepthBusy(true);

    try {
      const res = await fetchDepthAnalysis(depthUrl, apiKey, {
        text: textToUse,
        target_role_id: roleId,
        target_role_name: targetRoleName || undefined,
        skill_uris: isBereichAnalysis
          ? uniqueTargets.map((s) => s.esco_uri)
          : undefined,
        skill_weights: isBereichAnalysis
          ? Object.fromEntries(uniqueTargets.map((s) => [s.esco_uri, s.weight]))
          : undefined,
      });

      const depthMap = new Map<string, DepthSkillAssessment>(
        (Array.isArray(res?.skills) ? res.skills : []).map((s) => [s.esco_uri, s])
      );

      console.info("[JourneyPage] depth_analysis_completed", {
        request_id: requestId,
        skills: depthMap.size,
        quality: res?.quality ?? null,
        overall_match_percentage: res?.overall_match_percentage ?? null,
      });

      setDepthByUri(depthMap);
      setDepthOverallAssessment(res?.overall_assessment ?? null);

      // Entscheidend: Das verifizierte Depth-Ergebnis wird VOR dem
      // anschließenden Kurs-Matching in den Gap-State übernommen.
      setGapResult((current) =>
        current && current.target_role_id === roleId
          ? refineGapWithDepthAnalysis(
              current,
              depthMap,
              manualSkillUrisRef.current
            )
          : current
      );
    } catch (err) {
      // Die Tiefenanalyse darf bei einem temporären Function-/Netzwerkfehler
      // niemals die Journey blockieren. Das schnelle Gap-Ergebnis bleibt gültig.
      console.error("[JourneyPage] depth_analysis_failed", {
        request_id: requestId,
        role_id: roleId,
        endpoint: depthUrl,
        error: err,
      });
      setDepthByUri(new Map<string, DepthSkillAssessment>());
      setDepthOverallAssessment(null);
    } finally {
      setDepthBusy(false);
    }
  }
  /** Von der Person im Gap-Schritt ausgelöst (siehe GapStep/onMoveSkill) —
   *  markiert einen Skill manuell als vorhanden oder entfernt ihn wieder
   *  (moveSkillManually() oben übernimmt die eigentliche Neuberechnung von
   *  covered_skills/gap_skills/match_percentage). Merkt sich zusätzlich die
   *  esco_uri als "manuell", damit (a) die Anzeige das als bewusste
   *  Korrektur der Person zeigt statt einer KI-/Fuzzy-Einschätzung, und (b)
   *  eine noch laufende oder später eintreffende Tiefenanalyse diese
   *  Korrektur nicht wieder überschreibt (siehe manualUris-Parameter an
   *  refineGapWithDepthAnalysis). */
  function handleMoveSkill(escoUri: string, toCovered: boolean) {
    setManualSkillUris((prev) => {
      const next = new Set(prev);
      next.add(escoUri);
      manualSkillUrisRef.current = next;
      return next;
    });
    setGapResult((current) => (current ? applyManualSkillMove(current, escoUri, toCovered) : current));
  }

  /**
   * Schaltet einen Skill mit genau einem Klick zwischen "Vorhanden" und
   * "Skill-Lücke" um. Die Funktion arbeitet bewusst nur mit der Skill-ID;
   * der Zielstatus wird aus dem aktuell gespeicherten Zustand abgeleitet.
   */
  function moveSkillManually(id: string): void {
    const currentSkill = skills.find((skill) => skill.id === id);
    if (!currentSkill) return;
    const nextMatched = !currentSkill.matched;
    handleMoveSkill(id, nextMatched);
  }
  /** Version 26 — zweistufig (lokal, dann Backend-Fallback), siehe
   *  ausfuehrlichen Kommentar an loadRoleSkills oben: derselbe Grund
   *  (Zielrolle evtl. nicht im statischen 74-Rollen-Katalog, aber sehr wohl
   *  im Backend, das die Auswahl ueberhaupt erst befuellt hat), dieselbe
   *  Loesung. */
  async function runGapAnalysis(textToUse: string) {
    if (!targetRoleId) return;
    setSkillsBusy(true);
    setSkillsError(null);
    try {
      const local = analyzeGap(textToUse, targetRoleId, { roles: effectiveRoles });
      const res: GapAnalysisResponse = local
        ? { tenant_id: "", ...local }
        : await fetchGapAnalysis(baseUrl, apiKey, {
            text: textToUse,
            target_role_id: targetRoleId,
            lang: ESCO_LANG,
          });
      setGapResult(res);
      setText(textToUse);
      // Erst die Motivations-Zwischenseite (siehe CORE_STEPS-Kommentar),
      // nicht direkt "gap" — die Person klickt dort selbst weiter.
      setCurrent(stepIndex("motivation"));
      setTestId(null);
      setDepthByUri(new Map());
      setDepthOverallAssessment(null);
      setSelfLevelByUri(new Map());
      setManualSkillUris(new Set());
      manualSkillUrisRef.current = new Set();
      // Test-Tracking (Version 14): loggt den Skill-Check JETZT, nicht erst
      // beim Absenden des Kontaktformulars — so zählt "Anzahl der Tests" im
      // Dashboard auch Leute, die ab hier abspringen. Bewusst fire-and-forget:
      // ein Fehler hier darf die Journey nicht unterbrechen.
      createTest(baseUrl, apiKey, {
        target_role_id: targetRoleId,
        target_role_name: res.target_role_name,
        match_percentage: res.match_percentage,
        gap_skill_count: res.gap_skills.length,
        gap_skill_labels: res.gap_skills.map((s) => s.preferred_label),
      })
        .then((t) => setTestId(t.test_id))
        .catch((err) => {
          // Test-Tracking ist reine Statistik fürs Dashboard, kein kritischer Pfad.
          console.error("[JourneyPage] createTest:", err);
        });
      // Tiefenanalyse erst NACH dem schnellen Ergebnis anstossen. Bei einer
      // echten Zielrolle nutzt das Backend deren serverseitige Skill-Liste.
      // Bei einem Bereich nutzt es stattdessen exakt die Skills des gerade
      // berechneten Bereichs-Ergebnisses — dadurch wird cv-depth-analysis auch
      // im offenen "Bereich"-Pfad tatsächlich angesprochen.
      const depthTargets = [...res.gap_skills, ...res.covered_skills].map((skill) => ({
        esco_uri: skill.esco_uri,
        weight: skill.weight,
      }));
      // Die Depth Analysis wird bewusst abgewartet. So ist garantiert, dass
      // verifizierte CV-Belege die Gap-Einordnung UND anschließend das
      // Kurs-Matching beeinflussen. Währenddessen zeigt die UI depthBusy.
      await runDepthAnalysis(textToUse, targetRoleId, depthTargets);
    } catch (err) {
      setSkillsError(reportError("runGapAnalysis", err));
    } finally {
      setSkillsBusy(false);
    }
  }
  function submitTextMethod() {
    const trimmed = text.trim();
    if (!trimmed) return;
    demoDataActiveRef.current = false;
    runGapAnalysis(trimmed);
  }
  /** Baut das Gap-Ergebnis für den Fragebogen-Pfad DIREKT aus den
   * angeklickten Checkboxen, statt (wie vorher) einen Freitext-Satz aus den
   * gewählten Skill-Namen zu bauen und ihn zur erneuten Fuzzy-Erkennung ans
   * Backend zu schicken. Der Rückweg über den Fuzzy-Matcher war fehleranfällig
   * (kurze/mehrdeutige Skill-Namen wurden im Rückschluss nicht zuverlässig
   * wiedererkannt) — das fühlte sich für die Person an, als würden gerade
   * angeklickte Skills in der Gap-Auswertung wieder verschwinden. Die
   * Checkbox-Auswahl IST die Ground Truth, es gibt nichts zu "erkennen".
   * (Der Freitext-Methode bleibt weiterhin backend-seitig, da es dort keine
   * explizite Skill-Liste gibt, aus der man direkt ablesen könnte.) */
  /**
   * Fragebogen / Lernziel-Pfad:
   * Die Auswahl aus dem vorherigen Bereichsschritt beschreibt explizit,
   * WAS die Person lernen möchte. Deshalb werden ausgewählte Skills als
   * Gap/Lernziel geführt und NICHT als bereits vorhandene Skills.
   *
   * Wenn keine konkreten Skills ausgewählt wurden, bleibt der Pfad bewusst
   * auf Bereichsebene: dann gelten alle für die gewählte Bereichs-Rolle
   * hinterlegten Skills als mögliche Lernziele.
   */
  function buildQuizGapResult(): GapAnalysisResponse | null {
    if (!targetRoleId || !targetRoleName) return null;

    let totalWeight = 0;
    let coveredWeight = 0;
    const covered: RoleSkillStatus[] = [];
    const gap: RoleSkillStatus[] = [];

    // Bugfix 22.09.2026 (siehe pickCoreQuestionSkills-Kommentar oben): NUR
    // über Skills iterieren, zu denen die Person tatsächlich eine Angabe
    // gemacht hat — nie über das komplette roleSkills — sonst zählen nie
    // gefragte Skills automatisch als Lücke, und 100% bleibt unerreichbar,
    // egal wie geantwortet wird.
    //
    // Teil 2 (22.09.2026): dieses "tatsächlich gefragt" ist jetzt nicht mehr
    // nur questionSkills (die Kern-Skills), sondern zusätzlich jeder
    // "ergänzende" Skill, den die Person freiwillig über den "+ N weitere"-
    // Link in FragebogenMethod mitbeantwortet hat (checkedSkills enthält
    // dann auch dessen URI, siehe answerQuizSkill oben) — bewusst genauso
    // strikt wie beim Kern-Fix: ein nie angezeigter/angetippter Zusatz-Skill
    // zählt weiterhin nicht als Lücke.
    const extraAnsweredSkills = roleSkills.filter(
      (s) => checkedSkills.has(s.esco_uri) && !questionSkills.some((q) => q.esco_uri === s.esco_uri)
    );
    const quizUniverse = [...questionSkills, ...extraAnsweredSkills];

    for (const s of quizUniverse) {
      totalWeight += s.weight;
      if (checkedSkills.has(s.esco_uri)) {
        // Teil 2: statt eines pauschalen Volltreffers (100) fließt jetzt der
        // deterministische Score aus Grad + Aktualität ein (siehe
        // quizSkillScore/SkillDepth oben) — dieselbe gewichtete
        // Teil-Konfidenz-Formel wie in moveSkillManually.
        const score = quizSkillScore(skillDepthByUri.get(s.esco_uri));
        coveredWeight += s.weight * (score / 100);
        covered.push({ ...s, covered: true, matched_score: score });
      } else {
        gap.push({ ...s, covered: false, matched_score: null });
      }
    }

    // Explizit gewünschte Lernziele aus dem Bereich-Schritt zuerst zeigen.
    // Sie bleiben trotzdem nur dann "Lücke", wenn der Skill im Skill-Check
    // nicht als vorhanden bestätigt wurde.
    const learningGoalIds = new Set(roleSuggestSkillIds);
    gap.sort((a, b) => {
      const aGoal = learningGoalIds.has(a.esco_uri) ? 0 : 1;
      const bGoal = learningGoalIds.has(b.esco_uri) ? 0 : 1;
      if (aGoal !== bGoal) return aGoal - bGoal;
      return b.weight - a.weight;
    });

    const matchPercentage =
      totalWeight > 0 ? Math.round((coveredWeight / totalWeight) * 1000) / 10 : 0;

    return {
      tenant_id: "",
      target_role_id: targetRoleId,
      target_role_name: targetRoleName,
      match_percentage: matchPercentage,
      covered_skills: covered,
      gap_skills: gap,
    };
  }
  function submitQuizMethod() {
    const result = buildQuizGapResult();
    if (!result) return;
    demoDataActiveRef.current = false;
    // Freitext wird weiterhin mitgeführt (u.a. für submitLead/goToKurs, die
    // ihre eigene serverseitige Kursempfehlung auf Basis von Text berechnen)
    // — reine Kontext-Information, beeinflusst die HIER angezeigte
    // Gap-Auswertung aber nicht mehr.
    const known = roleSkills
      .filter((s) => checkedSkills.has(s.esco_uri))
      .map((s) => s.preferred_label);
    const learningGoals = roleSkills
      .filter((s) => roleSuggestSkillIds.has(s.esco_uri))
      .map((s) => s.preferred_label);
    const syntheticParts = [
      learningGoals.length ? `Ich möchte folgende Fähigkeiten gezielt lernen: ${learningGoals.join(", ")}.` : "",
      known.length ? `Ich bringe bereits folgende Fähigkeiten mit: ${known.join(", ")}.` : "",
    ].filter(Boolean);
    const synthetic =
      syntheticParts.join(" ") ||
      `Ich möchte mich im Bereich „${targetRoleName}“ gezielt weiterentwickeln.`;
    setText(synthetic);
    setGapResult(result);
    // Erst die Motivations-Zwischenseite (siehe CORE_STEPS-Kommentar), dann
    // erst der Gap-Schritt — Person klickt sich jeweils selbst weiter.
    setCurrent(stepIndex("motivation"));
    setTestId(null);
    // Nutzer landet jetzt wie im Lebenslauf-Pfad zuerst auf der
    // Motivations-Zwischenseite und danach auf dem Gap-Schritt, klickt sich
    // von dort jeweils selbst weiter zu "Kursempfehlung ansehen →" (siehe
    // ActionsRow in GapStep, onForward={goToKurs}) — vorher sprang der
    // Fragebogen-Pfad hier automatisch nach 240ms weiter, wodurch der
    // Gap-Schritt nur kurz aufblitzte, statt sichtbar/lesbar zu sein
    // (Rückmeldung 17.09.). Dieselbe Lektion gilt jetzt auch für die neue
    // Motivations-Zwischenseite — deshalb dort ebenfalls kein Auto-Advance.
    // Der Fragebogen-Pfad hat keine eigene KI-Tiefenanalyse (siehe Kommentar
    // an buildQuizGapResult) - eine evtl. noch von einer vorherigen
    // Freitext-Analyse (selbe Sitzung, zurück + Methode gewechselt) übrig
    // gebliebene depthByUri/selfLevelByUri würde sonst falsche Begründungen
    // zu Skills zeigen, die hier rein über die Checkbox-Auswahl entschieden
    // wurden - deshalb bei jeder neuen Quiz-Auswertung zurückgesetzt, genau
    // wie in runGapAnalysis().
    setDepthByUri(new Map());
    setDepthOverallAssessment(null);
    setSelfLevelByUri(new Map());
    setManualSkillUris(new Set());
    manualSkillUrisRef.current = new Set();
    // Test-Tracking bleibt wie gehabt fire-and-forget, jetzt mit dem lokal
    // berechneten Ergebnis statt einer Server-Antwort.
    createTest(baseUrl, apiKey, {
      target_role_id: result.target_role_id,
      target_role_name: result.target_role_name,
      match_percentage: result.match_percentage,
      gap_skill_count: result.gap_skills.length,
      gap_skill_labels: result.gap_skills.map((s) => s.preferred_label),
    })
      .then((t) => setTestId(t.test_id))
      .catch((err) => {
        console.error("[JourneyPage] createTest:", err);
      });
  }
  async function goToKurs(
    gapOverride?: GapAnalysisResponse,
    textOverride?: string
  ) {
    if (!targetRoleId) return;

    demoDataActiveRef.current = false;
    setGapBusy(true);
    setGapError(null);

    try {
      const sourceText = textOverride ?? text;
      const effectiveGapResult = gapOverride ?? gapResult;

      // Harte Runtime-Absicherung: ein alter/teilweise gemergter Journey-Stand
      // darf den Kursfluss niemals mit "undefined.length" crashen.
      const courseCatalog: OrbitCourse[] = Array.isArray(allCourses) ? allCourses : [];
      if (!Array.isArray(allCourses)) {
        console.warn("[JourneyPage] course_catalog_state_invalid", {
          received_type: typeof courseCatalog,
        });
      }

      let matchedCourses: CourseRecommendation[] = [];

      const localRoleKnown =
        analyzeGap(sourceText, targetRoleId, {
          roles: effectiveRoles,
        }) !== null;

      // A. Existing local ranking path.
      if (
        localRoleKnown &&
        effectiveGapResult &&
        effectiveGapResult.target_role_id === targetRoleId
      ) {
        matchedCourses = rankCoursesForGap(
          toGapAnalysisResultForRanking(effectiveGapResult),
          courseCatalog,
          {
            employmentType,
            workLocation,
            desiredStart,
            fundingPreference,
            categoryPreference,
            desiredDuration,
            qualificationLevel,
            experienceYears,
            germanLevel,
            roles: effectiveRoles,
          }
        );
      }

      let res: CourseMatchResponse = {
        tenant_id: "",
        target_role_id: targetRoleId,
        target_role_name:
          effectiveGapResult?.target_role_name ??
          targetRoleName ??
          targetRoleId,
        match_percentage: effectiveGapResult?.match_percentage ?? 0,
        // Fix (17.09.): fehlendes zweites "?." — effectiveGapResult war hier
        // zwar bereits optional verkettet, .gap_skills selbst aber nicht,
        // wodurch genau die Art von Crash passierte, vor der der Kommentar
        // "Harte Runtime-Absicherung" oben eigentlich schützen sollte
        // ("Cannot read properties of undefined (reading 'length')",
        // ausgelöst über den Kursempfehlung-Button im Gap-Schritt).
        gap_skill_count: effectiveGapResult?.gap_skills?.length ?? 0,
        recommended_courses: matchedCourses,
      };

      // B. Existing backend matcher if local ranking produced no course.
      if (matchedCourses.length === 0) {
        console.info("[JourneyPage] course_match_backend_started", {
          target_role_id: targetRoleId,
          local_role_known: localRoleKnown,
          catalog_count: courseCatalog.length,
        });

        try {
          res = await fetchCourseMatch(baseUrl, apiKey, {
            text: sourceText,
            target_role_id: targetRoleId,
          });

          console.info("[JourneyPage] course_match_backend_completed", {
            target_role_id: targetRoleId,
            recommended_count: res.recommended_courses?.length ?? 0,
          });
        } catch (backendError) {
          console.error(
            "[JourneyPage] course_match_backend_failed:",
            backendError
          );
        }
      }

      // C. Final safety net: real tenant courses only.
      // Never fabricate a course. If the catalog contains courses, the UX
      // must not end on an empty result merely because the matcher missed.
      if (
        (!res.recommended_courses ||
          res.recommended_courses.length === 0) &&
        courseCatalog.length > 0
      ) {
        const fallbackCourses: CourseRecommendation[] = allCourses
          .filter((course) => Boolean(course.course_id && course.course_name))
          .slice()
          .sort((a, b) => {
            const featuredDelta =
              Number(Boolean(b.is_featured)) -
              Number(Boolean(a.is_featured));

            if (featuredDelta !== 0) return featuredDelta;

            const aStart = a.starts_at
              ? new Date(a.starts_at).getTime()
              : Number.MAX_SAFE_INTEGER;
            const bStart = b.starts_at
              ? new Date(b.starts_at).getTime()
              : Number.MAX_SAFE_INTEGER;

            return aStart - bStart;
          })
          .slice(0, 6)
          .map((course) => ({
            course_id: course.course_id,
            course_name: course.course_name,
            provider: course.provider,
            match_score: 0,
            covers_gap_percentage: 0,
            covers_gap_count: 0,
            duration_weeks: course.duration_weeks,
            matched_skills: [],
            missing_skills: [],
            is_role_fallback: true,
            covers_role_count: 0,
          }));

        res = {
          ...res,
          recommended_courses: fallbackCourses,
        };

        console.info("[JourneyPage] course_catalog_fallback_used", {
          catalog_count: courseCatalog.length,
          fallback_count: fallbackCourses.length,
        });
      }

      const personalizedCourses = personalizeCourseOrder(
        res.recommended_courses ?? [],
        careerGoal
      );

      console.info("[JourneyPage] course_result_ready", {
        target_role_id: targetRoleId,
        matched_count: personalizedCourses.length,
        catalog_count: courseCatalog.length,
        catalog_error: courseCatalogError,
      });

      setCourseResult({
        ...res,
        recommended_courses: personalizedCourses,
      });

      setCurrent(stepIndex("kurs"));
      setSelectedCourseId(personalizedCourses[0]?.course_id ?? null);
      setAdditionalCourseIds(new Set());

      const bestCourse = personalizedCourses[0];
      if (testId !== null && bestCourse) {
        attachTestRecommendation(
          baseUrl,
          apiKey,
          testId,
          bestCourse.course_id,
          bestCourse.course_name
        ).catch((err) => {
          console.error(
            "[JourneyPage] attachTestRecommendation:",
            err
          );
        });
      }
    } catch (err) {
      console.error("[JourneyPage] goToKurs:", err);
      setGapError(reportError("goToKurs", err));
    } finally {
      setGapBusy(false);
    }
  }
  /** Version 27: nimmt consultationRequested jetzt als expliziten PARAMETER
   *  statt ihn aus dem wantsConsultation-State zu lesen — LeadStep hat keine
   *  Checkbox mehr, sondern eigene Buttons je Absicht, die den Wert beim
   *  Klick direkt mitgeben. Würde submitLead() stattdessen weiter aus State
   *  lesen, könnte ein Button-Klick, der setWantsConsultation() und
   *  onSubmit() im selben Handler aufruft, noch den ALTEN (nicht neu
   *  gerenderten) State-Wert erwischen — der explizite Parameter macht das
   *  unabhängig vom React-Render-Timing.
   *  Version 37 (17.09., "Kurs direkt buchen, Anfragen für mehr
   *  Informationen oder persönliches Beratungsgespräch"): drittes Intent
   *  "info" ergänzt — eine neutrale Anfrage ohne "asap"-Startwunsch und ohne
   *  Beratungswunsch, für alle, die weder sofort buchen noch vorab telefonisch
   *  beraten werden wollen. Technisch weiterhin EIN einziger Lead-Datensatz
   *  (siehe consultation_requested/desired_start unten), kein neues
   *  Backend-Feld nötig. */
  /** Backend-Workaround, erstmals 17.09. (Rückmeldung: "POST .../orbit/leads
   *  404 ... Unbekannte target_role_id 'bereich:wirtschaft:knowhow'. Siehe
   *  GET /api/v1/target-roles.") — am selben Tag NOCH EINMAL erweitert, weil
   *  derselbe 404 auch bei einer ganz gewöhnlichen ROLES_CATALOG-ID auftrat
   *  ("Unbekannte target_role_id
   *  'wirtschaft-fachwirt-buero-projektorganisation-ihk'"), obwohl das laut
   *  der ursprünglichen Diagnose nicht hätte passieren dürfen.
   *
   *  Root Cause (jetzt vollständig verstanden): Es gibt zwei komplett
   *  getrennte Rollen-Kataloge. ROLES_CATALOG (rolesCatalog.ts) ist der
   *  große, statisch im Frontend eingebaute ESCO-Katalog, den die Journey
   *  fürs client-seitige Skill-Gap-Matching benutzt. Der Rollen-Katalog, den
   *  das Lead-Backend kennt (roles-State hier, geladen per fetchTargetRoles()
   *  von GET /api/v1/target-roles), ist dagegen ein pro Tenant im Dashboard
   *  SELBST angelegter, meist deutlich kleinerer Satz an Zielrollen. Eine
   *  ROLES_CATALOG-Rolle ist dem Backend deshalb nur dann bekannt, wenn der
   *  Bildungsträger im Dashboard zufällig eine Zielrolle MIT DERSELBEN ID
   *  angelegt hat — das betrifft "bereich:..."-Pseudo-IDs praktisch nie und
   *  ganz normale Rollen-IDs eben auch nicht zuverlässig, wie die zweite
   *  Rückmeldung zeigt.
   *
   *  Der eigentlich saubere Fix (beide Kataloge zusammenführen, oder das
   *  Backend "bereich:"/unbekannte IDs tolerieren lassen) gehört ins Backend
   *  bzw. ins Dashboard-Zielrollen-Management — außerhalb dieses Frontend-
   *  Repos. Bis dahin: robuster mehrstufiger Abgleich gegen den TATSÄCHLICHEN
   *  Backend-Katalog (roles), bevor überhaupt gesendet wird —
   *  1) ID direkt im Backend-Katalog bekannt → unverändert übernehmen,
   *  2) sonst über den (normalisierten) Rollennamen eine exakt passende
   *     Backend-Rolle suchen — hält die im Dashboard sichtbare Bezeichnung
   *     korrekt, auch wenn intern eine andere ID verwendet wird,
   *  3) beim Bereichs-Kurzweg zusätzlich über buildBereichRole()'s
   *     zugrunde liegende ROLES_CATALOG-Rolle denselben Namensabgleich,
   *  4) weicher Namensabgleich (gemeinsame, aussagekräftige Wörter) als
   *     letzte inhaltliche Näherung,
   *  5) ALLERLETZTER Ausweg, nur damit der Lead überhaupt gespeichert wird
   *     statt komplett verloren zu gehen: die erste beim Backend bekannte
   *     Rolle — in diesem Fall aber `nameConfirmed: false`, damit der Aufruf
   *     das ehrlich im Freitext-Anliegen vermerkt (siehe submitLead unten),
   *     statt dem Bildungsträger eine möglicherweise falsche Zielrolle ohne
   *     jeden Hinweis anzuzeigen. Kein Backend-Katalog bekannt → Original-ID
   *     unverändert lassen wie bisher (kein Rätselraten ins Leere). */
  function normalizeRoleNameForMatch(name: string): string {
    return name
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .replace(/[^a-zäöüß0-9]+/gi, " ")
      .trim()
      .replace(/\s+/g, " ");
  }
  function backendRoleNameOverlapScore(normalizedWanted: string, normalizedCandidate: string): number {
    const wordsWanted = new Set(normalizedWanted.split(" ").filter((w) => w.length >= 4));
    const wordsCandidate = new Set(normalizedCandidate.split(" ").filter((w) => w.length >= 4));
    if (wordsWanted.size === 0 || wordsCandidate.size === 0) return 0;
    let shared = 0;
    wordsWanted.forEach((w) => {
      if (wordsCandidate.has(w)) shared += 1;
    });
    return shared;
  }
  function resolveLeadTargetRoleId(
    rawTargetRoleId: string,
    rawTargetRoleName: string | null,
    catalogRoles: CatalogRole[],
    backendRoles: TargetRole[]
  ): { id: string; nameConfirmed: boolean } {
    // 1. ID direkt im Backend-Katalog bekannt — der Normalfall.
    if (backendRoles.some((r) => r.role_id === rawTargetRoleId)) {
      return { id: rawTargetRoleId, nameConfirmed: true };
    }
    const wantedName = rawTargetRoleName ? normalizeRoleNameForMatch(rawTargetRoleName) : "";
    // 2. Exakter Namensabgleich gegen den Backend-Katalog.
    if (wantedName) {
      const exactByName = backendRoles.find((r) => normalizeRoleNameForMatch(r.role_name) === wantedName);
      if (exactByName) return { id: exactByName.role_id, nameConfirmed: true };
    }
    // 3. Bereichs-Kurzweg: zugrunde liegende echte ROLES_CATALOG-Rolle
    //    bestimmen (bisheriges Verhalten) und deren Namen erneut exakt gegen
    //    den Backend-Katalog abgleichen.
    if (rawTargetRoleId.startsWith("bereich:")) {
      const bereichKeys = rawTargetRoleId.slice("bereich:".length).split(":")[0].split(",");
      const realRole = catalogRoles.find((r) => !r.role_id.startsWith("bereich:") && bereichKeys.includes(r.bereich_key));
      if (realRole) {
        const realName = normalizeRoleNameForMatch(realRole.role_name);
        const byRealName = backendRoles.find((r) => normalizeRoleNameForMatch(r.role_name) === realName);
        if (byRealName) return { id: byRealName.role_id, nameConfirmed: true };
      }
    }
    // 4. Weicher Namensabgleich (gemeinsame, aussagekräftige Wörter).
    if (wantedName && backendRoles.length > 0) {
      let best: TargetRole | null = null;
      let bestScore = 0;
      for (const r of backendRoles) {
        const score = backendRoleNameOverlapScore(wantedName, normalizeRoleNameForMatch(r.role_name));
        if (score > bestScore) {
          bestScore = score;
          best = r;
        }
      }
      if (best) return { id: best.role_id, nameConfirmed: true };
    }
    // 5. Letzter Ausweg, siehe Erklärung oben — Lead retten statt verlieren,
    //    aber ehrlich als nicht bestätigt markieren.
    if (backendRoles.length > 0) {
      console.warn(
        `[JourneyPage] resolveLeadTargetRoleId: keine passende Backend-Zielrolle für "${rawTargetRoleName ?? rawTargetRoleId}" gefunden — verwende ersatzweise "${backendRoles[0].role_name}", Hinweis geht mit ins Freitext-Anliegen.`
      );
      return { id: backendRoles[0].role_id, nameConfirmed: false };
    }
    return { id: rawTargetRoleId, nameConfirmed: false };
  }
  async function submitLead(intent: "start" | "info" | "consultation") {
    const consultationRequested = intent === "consultation";
    // "Kurs direkt buchen" ist eine qualifizierte Startanfrage. Wir nutzen
    // das bereits vorhandene desired_start-Feld und setzen es für diesen CTA
    // bewusst auf "asap", ohne einen neuen Backend-Endpunkt zu erfinden.
    // "info" lässt den im Präferenzen-Schritt genannten Startwunsch
    // unverändert, statt fälschlich "asap" zu behaupten.
    const requestedStart = intent === "start" ? "asap" : desiredStart;
    const trimmedEmail = leadEmail.trim();
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      setLeadError("Bitte gib eine gültige E-Mail-Adresse an — nur so kann dich dein Bildungsträger erreichen.");
      return;
    }
    if (!consent) {
      setLeadError("Bitte stimme der Speicherung deiner Angaben zu.");
      return;
    }
    if (!targetRoleId) {
      setLeadError("Dein Ziel konnte gerade nicht übernommen werden. Bitte geh einen Schritt zurück und versuch es erneut.");
      return;
    }
    if (!baseUrl || !apiKey) {
      setLeadError("Die Verbindung zum Bildungsträger ist gerade nicht eingerichtet. Bitte versuch es später erneut.");
      return;
    }
    setLeadBusy(true);
    setLeadError(null);
    try {
      // Siehe ausführlichen Kommentar an resolveLeadTargetRoleId oben — bei
      // nameConfirmed:false konnte die Zielrolle nicht sauber im
      // Backend-Katalog wiedergefunden werden; damit das nicht wortlos
      // untergeht, wird es dem Freitext-Anliegen vorangestellt (Version 38,
      // 17.09.), statt dem Bildungsträger stillschweigend eine evtl. falsche
      // Zielrolle anzuzeigen.
      const resolvedTargetRole = resolveLeadTargetRoleId(targetRoleId, targetRoleName, effectiveRoles, roles);
      const combinedMessage = [
        !resolvedTargetRole.nameConfirmed && targetRoleName
          ? `[Automatischer Hinweis: Zielrolle „${targetRoleName}“ konnte im System nicht eindeutig zugeordnet werden — bitte manuell prüfen.]`
          : null,
        leadMessage.trim() || null,
      ]
        .filter(Boolean)
        .join("\n\n");
      const created = await createLead(baseUrl, apiKey, {
        text,
        target_role_id: resolvedTargetRole.id,
        lead_name: leadName.trim() || null,
        contact_email: trimmedEmail,
        // Telefonnummer (Version 27, siehe leadPhone oben), optional.
        contact_phone: leadPhone.trim() || null,
        // Freitext-Anliegen (Version 38, 17.09., siehe leadMessage oben) —
        // optional, damit der Bildungsträger schon vor dem ersten Kontakt
        // weiß, worum es der Person konkret geht. Siehe combinedMessage oben
        // für den zusätzlichen Zielrollen-Hinweis bei nameConfirmed:false.
        message: combinedMessage || null,
        // Zusätzliche Qualifizierungsmerkmale (Version 15): welchen Kurs die
        // Person aktiv gewählt hat und wann sie starten möchte. Bewusst als
        // optionale Zusatzfelder verschickt — ein Backend, das sie noch nicht
        // kennt, ignoriert sie einfach, statt die Anfrage abzulehnen.
        selected_course_id: selectedCourseId,
        // Bei Bereich-Flows ist targetRoleId synthetisch (bereich:*).
        // Die bereits berechnete Journey-Auswertung wird deshalb mitgesendet,
        // damit das Backend keinen nicht existierenden target_role-Datensatz
        // erneut analysieren muss.
        journey_snapshot: gapResult ? {
          target_role_name: gapResult.target_role_name,
          match_percentage: gapResult.match_percentage,
          matched_skills: gapResult.covered_skills.map((s) => s.preferred_label),
          gap_skills: gapResult.gap_skills.map((s) => s.preferred_label),
          selected_course_id: selectedCourseId,
        } : null,
        desired_start: requestedStart,
        // Motivationale Qualifizierung aus dem Ziel-Schritt (Version 16),
        // ebenfalls optional (null, wenn übersprungen).
        career_goal: careerGoal,
        // Beschäftigungsart/Arbeitsort aus dem "Präferenzen"-Schritt
        // (Version 24), ebenfalls optional (null, wenn übersprungen).
        employment_type: employmentType,
        work_location: workLocation,
        // Förderungs-Präferenz aus dem "Präferenzen"-Schritt (Version 32,
        // 14.09.), ebenfalls optional (null, wenn übersprungen) — damit der
        // Bildungsträger beim Nachfassen weiß, ob Förderung ein Thema ist.
        funding_preference: fundingPreference,
        // Voraussetzungs-Auskunft aus dem "Präferenzen"-Schritt (Version 34,
        // 22.09.), ebenfalls optional (null, wenn übersprungen) — der
        // Bildungsträger sieht damit beim Nachfassen direkt, welche
        // Vorbildung/Erfahrung/Sprachkenntnisse die Person selbst angibt,
        // ohne im Skill-Profil danach suchen zu müssen.
        qualification_level: qualificationLevel,
        experience_years: experienceYears,
        german_level: germanLevel,
        // Beratungswunsch (Version 20, seit Version 27 ueber den gewaehlten
        // CTA-Button mitgegeben statt ueber eine Checkbox, siehe Kommentar
        // an der Funktionssignatur oben).
        consultation_requested: consultationRequested,
        // DSGVO-Nachweis (Version 28, Art. 7 Abs. 1 DSGVO): WANN genau und zu
        // welcher Textversion die Person zugestimmt hat — vorher wurde die
        // Checkbox nur geprüft, aber nie mitgeschickt (siehe consent_given_at
        // in orbit.ts). consent_given ist hier immer true, weil ohne Haken
        // (Check oben) gar nicht abgeschickt würde.
        consent_given: true,
        consent_given_at: new Date().toISOString(),
        consent_text_version: CONSENT_TEXT_VERSION,
        // Separater Nachweis für die frühere Einwilligung im CV-Schritt (siehe
        // cvProcessingConsentAt oben) — null, falls die Person z.B. über den
        // Fragebogen ohne CV-Upload zur Zielrolle gekommen ist.
        cv_processing_consent_given: cvProcessingConsentAt ? true : null,
        cv_processing_consent_at: cvProcessingConsentAt,
      });
      if (!created?.lead_id) {
        throw new Error("Lead wurde ohne lead_id zurückgegeben");
      }
      // Mehrfach-Kursanfrage (siehe additionalCourseIds oben): früher wurde
      // hier pro zusätzlich markiertem Kurs ein EIGENER Lead angelegt — das
      // ließ dieselbe Person im Dashboard als mehrere separate Karten
      // auftauchen. Jetzt genau wie beim manuellen Anlegen eines Leads im
      // Dashboard (siehe handleCreateLead/setLeadLinkedCourses dort): EIN
      // Lead, alle zusätzlich gewählten Kurse hängen als linked_course_ids
      // dran, damit sie auf DERSELBEN Kachel erscheinen (siehe
      // linked-course-chips in DashboardPage.tsx). Fire-and-forget-tauglich:
      // schlägt das Verlinken fehl, ist der Haupt-Lead trotzdem sicher
      // angelegt und die Person sieht ganz normal den Erfolgs-Screen.
      const extraCourseIds = Array.from(additionalCourseIds).filter((id) => id !== selectedCourseId);
      if (extraCourseIds.length > 0) {
        try {
          await setLeadLinkedCourses(baseUrl, apiKey, created.lead_id, [
            ...(selectedCourseId ? [selectedCourseId] : []),
            ...extraCourseIds,
          ]);
        } catch (err) {
          console.error("[JourneyPage] submitLead (Kurse verlinken):", err);
        }
      }
      setDone(true);
    } catch (err) {
      setLeadError(reportError("submitLead", err));
    } finally {
      setLeadBusy(false);
    }
  }
  /** Sichert das Gap-Ergebnis vorzeitig per E-Mail (siehe earlyLeadSaved oben) —
   * erzeugt technisch bereits einen vollwertigen Lead, genau wie submitLead().
   * Bewusster Kompromiss: Es gibt aktuell keinen "Lead aktualisieren"-Endpunkt
   * im Backend (nur create/list/booked-Status), daher entsteht ein ZWEITER
   * Lead-Datensatz, falls dieselbe Person später im Anfrage-Schritt erneut
   * absendet. Für den Bildungsträger ist das unproblematisch (beide Einträge
   * zeigen dieselbe Zielrolle/E-Mail und lassen sich leicht zuordnen), aber
   * bewusst dokumentiert für den Fall, dass später ein Upsert-Endpunkt ergänzt
   * wird — dann kann dieser zweite create-Aufruf durch ein Update ersetzt werden. */
  async function saveResultEarly() {
    const trimmedEmail = leadEmail.trim();
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      setEarlyCaptureError("Bitte gib eine gültige E-Mail-Adresse an.");
      return;
    }
    if (!consent) {
      setEarlyCaptureError("Bitte stimme der Speicherung deiner Angaben zu.");
      return;
    }
    if (!targetRoleId) return;
    setEarlyCaptureBusy(true);
    setEarlyCaptureError(null);
    try {
      // Siehe resolveLeadTargetRoleId oben — hier gibt es kein Freitextfeld
      // wie in submitLead(), daher landet ein nameConfirmed:false-Hinweis
      // ersatzweise direkt im message-Feld (additiv, siehe orbit.ts).
      const resolvedTargetRole = resolveLeadTargetRoleId(targetRoleId, targetRoleName, effectiveRoles, roles);
      await createLead(baseUrl, apiKey, {
        text,
        target_role_id: resolvedTargetRole.id,
        message:
          !resolvedTargetRole.nameConfirmed && targetRoleName
            ? `[Automatischer Hinweis: Zielrolle „${targetRoleName}“ konnte im System nicht eindeutig zugeordnet werden — bitte manuell prüfen.]`
            : null,
        lead_name: leadName.trim() || null,
        contact_email: trimmedEmail,
        career_goal: careerGoal,
        desired_start: desiredStart,
        employment_type: employmentType,
        work_location: workLocation,
        funding_preference: fundingPreference,
        qualification_level: qualificationLevel,
        experience_years: experienceYears,
        german_level: germanLevel,
        // Siehe gleichnamige Felder in submitLead() oben — derselbe DSGVO-
        // Nachweis gilt auch für die vorzeitige Sicherung per E-Mail.
        consent_given: true,
        consent_given_at: new Date().toISOString(),
        consent_text_version: CONSENT_TEXT_VERSION,
        cv_processing_consent_given: cvProcessingConsentAt ? true : null,
        cv_processing_consent_at: cvProcessingConsentAt,
      });
      setEarlyLeadSaved(true);
    } catch (err) {
      setEarlyCaptureError(reportError("saveResultEarly", err));
    } finally {
      setEarlyCaptureBusy(false);
    }
  }
  useEffect(() => {
    const nextSkills: SkillItem[] = gapResult
      ? [...gapResult.covered_skills, ...gapResult.gap_skills].map((skill) => ({
          id: skill.esco_uri,
          label: skill.preferred_label,
          matched: skill.covered,
          weight: skill.weight,
          matchedScore: skill.matched_score,
          source: manualSkillUris.has(skill.esco_uri) ? "manual" : "gap",
        }))
      : [];
    setSkills(nextSkills);
  }, [gapResult, manualSkillUris]);

  useEffect(() => {
    if (!courseResult?.recommended_courses?.length) {
      setCourses([]);
      return;
    }

    const ordered = personalizeCourseOrder(
      courseResult.recommended_courses,
      selectedGoal,
      allCourses,
    );

    const nextCourses: CourseItem[] = ordered.map((course) => {
      const fullCourse = allCourses.find((item) => item.course_id === course.course_id);
      return {
        id: course.course_id,
        name: course.course_name,
        provider: course.provider ?? fullCourse?.provider ?? null,
        durationWeeks: course.duration_weeks,
        gapPercentage: course.covers_gap_percentage,
        gapCount: course.covers_gap_count,
        richnessScore: fullCourse ? courseRichnessScore(fullCourse) : 0,
      };
    });

    setCourses(nextCourses);

    const currentIds = courseResult.recommended_courses.map((course) => course.course_id).join("|");
    const nextIds = ordered.map((course) => course.course_id).join("|");
    if (currentIds !== nextIds) {
      setCourseResult((currentResult) =>
        currentResult
          ? { ...currentResult, recommended_courses: ordered }
          : currentResult,
      );
    }
  }, [courseResult, selectedGoal, allCourses]);

  const topCourse: CourseRecommendation | undefined = courseResult?.recommended_courses?.[0];
  // Die Person kann im Kurs-Schritt bewusst einen Alternativ-Kurs statt der
  // Top-Empfehlung wählen (siehe selectedCourseId) — ab hier zählt für Pitch,
  // Anfrage und Abschluss-Screen diese aktive Auswahl, nicht mehr blind die
  // algorithmische Bestempfehlung.
  const selectedCourse: CourseRecommendation | undefined =
    courseResult?.recommended_courses?.find((c) => c.course_id === selectedCourseId) ?? topCourse;
  // Nachschlage-Map für die Namen zusätzlich angefragter Kurse (Version 19):
  // sowohl die individuell empfohlenen als auch die "beliebten" Kurse können
  // per Checkbox zusätzlich markiert werden (siehe additionalCourseIds), also
  // beide Quellen zusammenführen.
  const allCourseById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of courseResult?.recommended_courses ?? []) map.set(c.course_id, c.course_name);
    for (const c of featuredCourses) map.set(c.course_id, c.course_name);
    return map;
  }, [courseResult, featuredCourses]);
  const additionalCourseNames = useMemo(
    () =>
      Array.from(additionalCourseIds)
        .filter((id) => id !== selectedCourseId)
        .map((id) => allCourseById.get(id))
        .filter((n): n is string => Boolean(n)),
    [additionalCourseIds, selectedCourseId, allCourseById]
  );
  return (
    <>
      {depthBusy && (
        <div className="dyd-analysis-progress" role="status" aria-live="polite">
          <div className="dyd-analysis-progress-orbit" aria-hidden="true">
            <span />
          </div>
          <div>
            <span className="dyd-analysis-progress-kicker">DYD ANALYSE</span>
            <strong>Wir lesen gerade zwischen den Zeilen.</strong>
            <p>
              Wir prüfen deine Erfahrungen nicht nur auf Begriffe, sondern darauf,
              was du tatsächlich schon mitbringst.
            </p>
          </div>
        </div>
      )}

      <div className="host-chrome">
        <div className="host-logo-placeholder">
          <span className="box">?</span> Ihr Website-Logo hier
        </div>
        <div className="host-nav">
          <span>Kurse</span>
          <span>Über uns</span>
          <span>Kontakt</span>
        </div>
      </div>
      <div className="stage">
        <div className="widget">
          <div
            className="powered-badge"
            title="Ingredient Branding: DYD bleibt sichtbar, während die Website drumherum dem Bildungsträger gehört."
          >
            <span className="mark" />
            Powered by DYD ORBIT
          </div>
          <div className="widget-head">
            <div className="widget-eyebrow">Berufsberatung &amp; Weiterbildungs-Finder · ca. 2 Minuten</div>
            <h1 className="display">Finde die Weiterbildung, die dich wirklich weiterbringt</h1>
            <div className="sub">
              Ob du schon ein klares Ziel hast oder erst noch die passende Richtung finden willst: Wir gleichen dein
              Profil in Echtzeit ab und zeigen dir genau, welcher nächste Schritt dich deinem Traumjob näherbringt.
            </div>
            <div className="trust-row">
              <span>✓ EU-ESCO-Standard</span>
              {/* Bewusst nicht mehr "✓ DSGVO-konform" (Version 28): eine
                  pauschale Compliance-Behauptung ohne verlinkte
                  Datenschutzerklärung, nachweisbare Einwilligung und
                  Löschmöglichkeit wäre nicht nur ein DSGVO-Risiko, sondern
                  zusätzlich eine angreifbare Werbeaussage (§5 UWG). Die
                  technischen Bausteine dafür sind jetzt da (siehe
                  consent_given_at in orbit.ts, "Lead löschen" im Dashboard) —
                  sobald privacyPolicyUrl gesetzt UND das Backend die neuen
                  Consent-Felder tatsächlich speichert, kann hier wieder eine
                  stärkere Aussage stehen. Bis dahin bewusst zurückhaltender
                  formuliert. */}
              <span>✓ Datenschutz nach EU-Standard</span>
              <span>✓ Kostenlos &amp; unverbindlich</span>
            </div>
          </div>
          {!done && knowsRole !== null && (
            <>
              <div className="progress-track" aria-hidden="true">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.min(100, ((current + 1) / steps.length) * 100)}%` }}
                />
              </div>
              <div className="stepper" data-tour="tour-stepper">
                {steps.map((s, i) => (
                  <div key={s.key} className={`step-node ${i < current ? "done" : i === current ? "active" : ""}`}>
                    <div className="step-circle">{i < current ? "✓" : i + 1}</div>
                    <div className="step-label">{s.label}</div>
                    {i < steps.length - 1 && <div className={`step-line ${i < current ? "done" : ""}`} />}
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="widget-body" ref={widgetBodyRef}>
            {done ? (
              <FinalScreen
                leadName={leadName}
                targetRoleName={targetRoleName}
                courseName={selectedCourse?.course_name}
                additionalCourseNames={additionalCourseNames}
                wantsConsultation={wantsConsultation}
              />
            ) : knowsRole === null ? (
              <div className="panel-step">
                <IntroStep
                  onKnowsRole={() => {
                    setKnowsRole(true);
                    setCurrent(0); // erster Schritt von BASE_STEPS ("ziel")
                  }}
                  onUnsure={() => {
                    setKnowsRole(false);
                    setCurrent(0); // erster Schritt von WITH_BEREICH_STEPS ("ziel")
                  }}
                />
              </div>
            ) : (
              <div className="panel-step" data-tour="tour-panel">
                {stepKey === "ziel" && (
                  <GoalStep
                    selected={careerGoal}
                    onSelect={selectGoal}
                    onSkip={() => selectGoal(null)}
                    onBack={() => {
                      setKnowsRole(null);
                      setCurrent(-1);
                    }}
                  />
                )}
                {stepKey === "praeferenzen" && (
                  <PraeferenzenStep
                    employmentType={employmentType}
                    onSelectEmploymentType={setEmploymentType}
                    workLocation={workLocation}
                    onSelectWorkLocation={setWorkLocation}
                    desiredStart={desiredStart}
                    onSelectStart={setDesiredStart}
                    fundingPreference={fundingPreference}
                    onSelectFunding={setFundingPreference}
                    categoryPreference={categoryPreference}
                    onSelectCategory={setCategoryPreference}
                    categoryOptions={categoryOptionsInPortfolio}
                    desiredDuration={desiredDuration}
                    onSelectDuration={setDesiredDuration}
                    qualificationLevel={qualificationLevel}
                    onSelectQualification={setQualificationLevel}
                    experienceYears={experienceYears}
                    onSelectExperience={setExperienceYears}
                    germanLevel={germanLevel}
                    onSelectGermanLevel={setGermanLevel}
                    onForward={continuePreferences}
                    onBack={() => setCurrent(stepIndex("ziel"))}
                  />
                )}
                {stepKey === "bereich" && (
                  <RoleSuggestStep
                    selectedSkillIds={roleSuggestSkillIds}
                    onToggleSkill={toggleRoleSuggestSkill}
                    onSelectBereich={selectBereich}
                    onForward={() => setCurrent(stepIndex("skills"))}
                    onBrowseAll={browseAllRoles}
                    onBack={() => setCurrent(stepIndex("praeferenzen"))}
                    bereicheOptions={bereicheInPortfolio}
                    rolesInPortfolio={rolesInPortfolio}
                  />
                )}
                {stepKey === "zielrolle" && (
                  <ZielrolleStep
                    roles={rolesInPortfolio.map(toTargetRoleSummary)}
                    loading={loadingRoles}
                    error={rolesError}
                    onRetry={loadRoles}
                    selectedRoleId={targetRoleId}
                    onSelect={selectRole}
                    onForward={() => setCurrent(stepIndex("skills"))}
                    onBack={() => setCurrent(stepIndex(knowsRole === false ? "bereich" : "praeferenzen"))}
                  />
                )}
                {stepKey === "skills" && (
                  <SkillsMethodStep
                    method={method}
                    setMethod={setMethod}
                    targetRoleName={targetRoleName}
                    text={text}
                    setText={setText}
                    onSubmitText={submitTextMethod}
                    uploadBusy={uploadBusy}
                    uploadStatus={uploadStatus}
                    fileInputRef={fileInputRef}
                    onFileChange={handleFileChange}
                    roleSkills={roleSkills}
                    questionSkills={questionSkills}
                    loadingRoleSkills={loadingRoleSkills}
                    roleSkillsError={roleSkillsError}
                    checkedSkills={checkedSkills}
                    toggleSkill={toggleSkill}
                    skillDepthByUri={skillDepthByUri}
                    onAnswerSkill={answerQuizSkill}
                    onSubmitQuiz={submitQuizMethod}
                    skillsBusy={skillsBusy}
                    skillsError={skillsError}
                    onBack={() => setCurrent(stepIndex("zielrolle"))}
                    onCvConsentGiven={() => setCvProcessingConsentAt(new Date().toISOString())}
                    privacyPolicyUrl={privacyPolicyUrl}
                    showAvatar={showAvatar}
                    avatarName={avatarName}
                    avatarAccentColor={avatarAccentColor}
                  />
                )}
                {stepKey === "motivation" && gapResult && (
                  <MotivationStep
                    gapResult={gapResult}
                    goalLabel={GOAL_OPTIONS.find((g) => g.key === careerGoal)?.label}
                    onForward={() => setCurrent(stepIndex("gap"))}
                    onBack={() => setCurrent(stepIndex("skills"))}
                  />
                )}
                {stepKey === "gap" && gapResult && (
                  <GapStep
                    gapResult={gapResult}
                    method={method}
                    cvText={text}
                    depthByUri={depthByUri}
                    depthOverallAssessment={depthOverallAssessment}
                    depthBusy={depthBusy}
                    selfLevelByUri={selfLevelByUri}
                    onSetSelfLevel={(uri, level) =>
                      setSelfLevelByUri((prev) => {
                        const next = new Map(prev);
                        next.set(uri, level);
                        return next;
                      })
                    }
                    manualSkillUris={manualSkillUris}
                    onMoveSkill={handleMoveSkill}
                    busy={gapBusy}
                    error={gapError}
                    goalLabel={GOAL_OPTIONS.find((g) => g.key === careerGoal)?.label}
                    onForward={goToKurs}
                    onBack={() => setCurrent(stepIndex("skills"))}
                    leadEmail={leadEmail}
                    setLeadEmail={setLeadEmail}
                    consent={consent}
                    setConsent={setConsent}
                    earlyCaptureBusy={earlyCaptureBusy}
                    earlyCaptureError={earlyCaptureError}
                    earlyLeadSaved={earlyLeadSaved}
                    onSaveEarly={saveResultEarly}
                  />
                )}
                {stepKey === "kurs" && (
                  <KursStep
                    courseResult={courseResult}
                    targetRoleName={targetRoleName}
                    bereichLabel={targetBereichLabel}
                    gapSkillLabels={gapResult?.gap_skills.map((s) => s.preferred_label) ?? []}
                    gapSkills={gapResult?.gap_skills ?? []}
                    coveredSkills={gapResult?.covered_skills ?? []}
                    featuredCourses={featuredCourses}
                    allCourses={allCourses}
                    courseCatalogLoading={courseCatalogLoading}
                    courseCatalogError={courseCatalogError}
                    careerGoal={careerGoal}
                    selectedCourseId={selectedCourseId}
                    // Rückmeldung 17.09.: der Auto-Scroll zum Kontaktformular
                    // nach Kursauswahl (kurz zuvor eingeführt) kam nicht gut an
                    // ("das mit dem Scrolling finde ich nicht gut") — wieder
                    // entfernt. Auswahl wirkt jetzt wieder ausschließlich lokal
                    // an der Karte selbst (siehe course-hero-reveal in
                    // KursStep) statt die Seite zu bewegen.
                    onSelectCourse={handleSelectCourse}
                    additionalCourseIds={additionalCourseIds}
                    onToggleAdditional={toggleAdditionalCourse}
                    employmentType={employmentType}
                    workLocation={workLocation}
                    desiredStart={desiredStart}
                    fundingPreference={fundingPreference}
                    categoryPreference={categoryPreference}
                    desiredDuration={desiredDuration}
                    qualificationLevel={qualificationLevel}
                    experienceYears={experienceYears}
                    germanLevel={germanLevel}
                    goalLabel={GOAL_OPTIONS.find((g) => g.key === careerGoal)?.label}
                    leadName={leadName}
                    setLeadName={setLeadName}
                    leadEmail={leadEmail}
                    setLeadEmail={setLeadEmail}
                    leadPhone={leadPhone}
                    setLeadPhone={setLeadPhone}
                    leadMessage={leadMessage}
                    setLeadMessage={setLeadMessage}
                    consent={consent}
                    setConsent={setConsent}
                    leadBusy={leadBusy}
                    leadError={leadError}
                    onSubmitLead={submitLead}
                    desiredStartLabel={START_OPTIONS.find((o) => o.key === desiredStart)?.label}
                    employmentTypeLabel={EMPLOYMENT_OPTIONS.find((o) => o.key === employmentType)?.label}
                    workLocationLabel={LOCATION_OPTIONS.find((o) => o.key === workLocation)?.label}
                    wantsConsultation={wantsConsultation}
                    setWantsConsultation={setWantsConsultation}
                    privacyPolicyUrl={privacyPolicyUrl}
                    onBack={() => setCurrent(stepIndex("gap"))}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {showTour && (
        <button className="tour-trigger-btn" onClick={() => setTourOpen(true)} type="button">
          <span aria-hidden="true">🧭</span>
          <span className="tour-trigger-label">Rundgang starten</span>
        </button>
      )}
      {showTour && (
        <JourneyTour
          open={tourOpen}
          onClose={tourClose}
          currentKey={knowsRole === null ? "intro" : (stepKey as JourneyStepKey) ?? "intro"}
          availableKeys={steps.map((s) => s.key) as JourneyStepKey[]}
          hasGapResult={Boolean(gapResult)}
          hasCourseResult={Boolean(courseResult)}
          onNavigate={(key) => tourNavigate(key as StepKey)}
          onEnsureDemoResults={runDemoAnalysis}
        />
      )}
      {showConnectionPanel && (
        <button className="settings-toggle" onClick={() => setSettingsOpen((v) => !v)} title="Demo-Einstellungen">
          ⚙
        </button>
      )}
      {showConnectionPanel && (
        <div className={`settings-drawer ${settingsOpen ? "open" : ""}`}>
          <div className="conn-title">Demo-Verbindung</div>
          <label htmlFor="journeyBaseUrl">API-Adresse</label>
          <input id="journeyBaseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <label htmlFor="journeyApiKey">API-Key (Bildungsträger)</label>
          <input id="journeyApiKey" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <button className="conn-btn" onClick={loadRoles}>
            Neu laden
          </button>
        </div>
      )}
    </>
  );
}
// ---------- Schritt-Komponenten ----------
function ActionsRow({
  onBack,
  forwardLabel,
  onForward,
  forwardDisabled,
  hideForward,
  busy,
}: {
  onBack?: () => void;
  forwardLabel?: string;
  onForward?: () => void;
  forwardDisabled?: boolean;
  hideForward?: boolean;
  /** Zeigt einen kleinen Spinner vor dem Label, waehrend eine Anfrage laeuft
   * (unterscheidet "wartet auf Server" optisch von "Auswahl fehlt noch"). */
  busy?: boolean;
}) {
  return (
    <div className="widget-actions">
      {onBack ? (
        <button className="btn-back" onClick={onBack}>
          ← Zurück
        </button>
      ) : (
        <span />
      )}
      {!hideForward && (
        <button className={`btn-forward ${busy ? "loading" : ""}`} onClick={onForward} disabled={forwardDisabled}>
          {busy && <span className="btn-spinner" aria-hidden="true" />}
          {forwardLabel}
        </button>
      )}
    </div>
  );
}
/** Einheitliche Heading-Komponente für jeden Journey-Schritt. */
function JourneyStepHeading({ step, kicker, title, description, className = "" }: { step: string; kicker: string; title: string; description?: string; className?: string }) {
  return (
    <header className={`journey-step-heading ${className}`.trim()} data-step={step}>
      <div className="journey-step-meta">
        <span className="journey-step-number">{step}</span>
        <span className="journey-step-kicker">{kicker}</span>
      </div>
      <h1 className="journey-step-title">{title}</h1>
      {description ? <p className="journey-step-description">{description}</p> : null}
    </header>
  );
}

/** Match-Ring für den Gap-Schritt (ARCS: Attention) — zeigt den bereits
 * berechneten gapResult.match_percentage (siehe buildQuizGapResult/
 * runGapAnalysis) erstmals überhaupt visuell an, statt ihn nur intern
 * mitzuführen. Reine Anzeige, keine eigene Berechnung/erfundene Zahl.
 * Nutzt dieselben .ring-box/.ring-value-Klassen, die schon in journey.css
 * für einen früheren Ring-Stand vorbereitet waren (siehe Kommentar an
 * .gap-method-note), nur der Kreis selbst ist hier inline gestylt. */
function MatchRing({ percent, size = 96 }: { percent: number; size?: number }) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - safePercent / 100);
  return (
    <div className="ring-box" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border-soft)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#dydMatchRingGradient)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(.4,0,.2,1)" }}
        />
        <defs>
          <linearGradient id="dydMatchRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--dyd-mint)" />
            <stop offset="100%" stopColor="var(--dyd-blue)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="ring-value">{safePercent}%</div>
    </div>
  );
}

/**
 * Avatar/Guide (22.09.2026, "kriegen wir noch einen kleinen Avatar mit dazu
 * hin, der Erklärungen bringt ... soll sich am Anfang auch kurz vorstellen"):
 * bewusst KEIN gezeichneter Charakter/Maskottchen, sondern eine abstrakte,
 * animierte Marken-Form (Farbverlauf-Orb) mit Sprechblase — aus zwei Gründen,
 * beide mit dem Nutzer abgestimmt:
 *
 * 1. White-Label (dieses Projekt ist explizit "API/White Label"!): das
 *    zentrale Versprechen an Bildungsträger/Berater-Partner ist "DYD läuft
 *    im Hintergrund, Ihre Kundinnen und Kunden sehen ausschließlich Ihr
 *    Branding" (siehe claude/whitelabel-api-strategie.md). Ein fest
 *    gezeichneter DYD-Charakter würde dem widersprechen. Eine abstrakte Form
 *    lässt sich dagegen pro Tenant einfärben (accentColor-Prop) oder ganz
 *    abschalten (showAvatar in JourneyPageProps, siehe dort — exakt
 *    dasselbe Muster wie das bereits vorhandene showTour-Flag), ohne dass
 *    irgendwo eine neue Illustration beauftragt werden müsste.
 * 2. Positionierung: DYD tritt bewusst seriös auf (DSGVO-konform,
 *    ESCO-Standard, Kooperationspartner Hochschule Fresenius). Ein
 *    Cartoon-Gesicht hätte dazu einen spürbaren Stilbruch riskiert, ein
 *    ruhiger, glasig schimmernder Orb in den Marken-Farben nicht.
 *
 * Reine Anzeige-Komponente, hält keinen eigenen Zustand — Sichtbarkeit/
 * Dismiss wird von der aufrufenden Stelle gesteuert (siehe avatarDismissed
 * in SkillsMethodStep / tipDismissed in FragebogenMethod unten), damit jede
 * Einsatzstelle selbst entscheiden kann, wann/wie oft sie erscheint. */
function GuideAvatarBubble({
  name,
  message,
  accentColor,
  onDismiss,
}: {
  name: string;
  message: string;
  accentColor?: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      className="guide-avatar-row"
      style={accentColor ? ({ "--guide-accent": accentColor } as CSSProperties) : undefined}
    >
      <div className="guide-avatar-orb" aria-hidden="true">
        <span className="guide-avatar-orb-sheen" />
      </div>
      <div className="guide-avatar-bubble">
        {onDismiss && (
          <button type="button" className="guide-avatar-bubble-close" onClick={onDismiss} aria-label="Schließen">
            ×
          </button>
        )}
        <div className="guide-avatar-bubble-name">{name}</div>
        <div className="guide-avatar-bubble-text">{message}</div>
      </div>
    </div>
  );
}

/** Einstieg: Nicht mit "Traumposition" starten, sondern den Nutzer dort abholen,
 * wo er bei Weiterbildung typischerweise steht: klares Ziel vs. Richtung suchen. */
function IntroStep({ onKnowsRole, onUnsure }: { onKnowsRole: () => void; onUnsure: () => void }) {
  return (
    <div>
      <JourneyStepHeading
        step="01"
        kicker="ORIENTIERUNG"
        title="Wo soll es beruflich für dich hingehen?"
        description="Kein Problem, wenn du noch keine konkrete Position kennst. Wir starten dort, wo du gerade stehst."
      />
      <div className="method-grid">
        <div className="method-card" onClick={onKnowsRole} role="button" tabIndex={0} onKeyDown={(e) => handleCardKeyDown(e, onKnowsRole)}>
          <div className="method-icon" aria-hidden="true">🎯</div>
          <div className="method-title">Ja, ich weiß ziemlich genau, was ich möchte</div>
          <div className="method-sub">Ich möchte direkt mit einer konkreten Zielrolle starten.</div>
        </div>
        <div className="method-card" onClick={onUnsure} role="button" tabIndex={0} onKeyDown={(e) => handleCardKeyDown(e, onUnsure)}>
          <div className="method-icon" aria-hidden="true">🧭</div>
          <div className="method-title">Ich kenne eher die Richtung</div>
          <div className="method-sub">Zeig mir passende Bereiche und Skills, bevor wir eine konkrete Rolle festlegen.</div>
        </div>
      </div>
    </div>
  );
}
/** Ziel-Schritt: fragt nach der beruflichen Entwicklung statt nach einem einzelnen
 * Ergebnis wie "mehr Geld". Das Signal kann später sinnvoll für die Empfehlung genutzt werden. */
function GoalStep({ selected, onSelect, onSkip, onBack }: { selected: string | null; onSelect: (goalKey: string) => void; onSkip: () => void; onBack: () => void }) {
  return (
    <div>
      <JourneyStepHeading
        step="02"
        kicker="ZIELBILD"
        title="Was soll sich für dich beruflich verändern?"
        description="Wähle, was gerade am besten zu dir passt. Daraus bauen wir deinen nächsten beruflichen Schritt."
      />
      <div className="role-grid">
        {GOAL_OPTIONS.map((g) => (
          <div key={g.key} className={`role-card ${selected === g.key ? "selected" : ""}`} onClick={() => onSelect(g.key)} role="button" tabIndex={0} aria-pressed={selected === g.key} onKeyDown={(e) => handleCardKeyDown(e, () => onSelect(g.key))}>
            <div className="role-card-icon" aria-hidden="true">{g.icon}</div>
            <div className="role-card-name">{g.label}</div>
          </div>
        ))}
      </div>
      <div className="hint" style={{ marginTop: "12px", textAlign: "center" }}>
        Das ist nur für die Personalisierung — es gibt keine falsche Antwort.
      </div>
      <div className="method-switch" onClick={onSkip} role="button" tabIndex={0} onKeyDown={(e) => handleCardKeyDown(e, onSkip)} style={{ marginTop: "8px" }}>
        Überspringen
      </div>
      <ActionsRow onBack={onBack} hideForward />
    </div>
  );
}
/** Fünfte Iteration (15.09., "der User soll nicht die Rollen selber
 *  auswählen müssen, weil das ist einfach ein zu großer Showstopper"): die
 *  optionale Rollenkarten-Zwischenauswahl aus der Vorrunde ist komplett
 *  wieder raus — gerade Personen ohne klare Zielrolle sollen NIE mit
 *  Rollennamen konfrontiert werden, auch nicht als freiwilliges Extra.
 *  Dieser Schritt fragt jetzt ausschliesslich Bereich (Pflicht, mehrere
 *  moeglich) + optionale Skill-Checkliste ab. Die eigentliche "Verbindung"
 *  von Ziel (aus dem allerersten GoalStep) und Bereich passiert komplett
 *  unsichtbar im Hintergrund: buildBereichRole() in gapAnalysis.ts nimmt
 *  BEIDE entgegen und leitet daraus die Skill-Basis fuer Gap-Analyse und
 *  Kursempfehlung ab (siehe selectBereich() in JourneyPage) — hier in der UI
 *  taucht davon nichts auf. Wer eine konkrete Rolle kennt, nutzt weiterhin
 *  den expliziten Ausweg "Lieber selbst durch alle Rollen stöbern"
 *  (ZielrolleStep) — das ist eine bewusste Wahl, kein erzwungener Schritt. */
function RoleSuggestStep({
  selectedSkillIds, onToggleSkill, onSelectBereich, onForward, onBrowseAll, onBack, bereicheOptions, rolesInPortfolio,
}: {
  selectedSkillIds: Set<string>;
  onToggleSkill: (skillId: string) => void;
  onSelectBereich: (bereichKeys: string[]) => void;
  onForward: () => void;
  onBrowseAll: () => void;
  onBack: () => void;
  bereicheOptions: BereichOption[];
  rolesInPortfolio: CatalogRole[];
}) {
  const [selectedBereich, setSelectedBereich] = useState<Set<string>>(new Set());
  const [showLearningGoals, setShowLearningGoals] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  function toggleBereich(key: string) {
    setSelectedBereich((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const bereichFilteredRoles = useMemo(
    () =>
      selectedBereich.size > 0
        ? rolesInPortfolio.filter((r) => selectedBereich.has(r.bereich_key))
        : rolesInPortfolio,
    [selectedBereich, rolesInPortfolio]
  );

  const learningSkills = useMemo(
    () => topSkillsForRoles(bereichFilteredRoles, ROLE_SUGGEST_SKILL_CHIP_LIMIT),
    [bereichFilteredRoles]
  );

  function goWithBereich() {
    if (advancing || selectedBereich.size === 0) return;
    setAdvancing(true);
    onSelectBereich([...selectedBereich]);
    window.setTimeout(onForward, 220);
  }

  const selectedLabels = [...selectedBereich]
    .map((k) => bereicheOptions.find((b) => b.key === k)?.label ?? k)
    .join(" · ");

  const selectedLearningLabels = learningSkills
    .filter((s) => selectedSkillIds.has(s.skill_id))
    .map((s) => s.name);

  return (
    <div>
      <JourneyStepHeading
        step="04"
        kicker="ENTDECKUNG"
        title="In welche Richtung möchtest du dich entwickeln?"
        description="Wähle einen oder mehrere Bereiche. Wir nutzen deine Auswahl später als Kontext für deinen persönlichen Skill-Abgleich."
      />

      <div className="role-grid" style={{ marginBottom: "8px" }}>
        {bereicheOptions.map((b) => {
          const active = selectedBereich.has(b.key);
          return (
            <div
              key={b.key}
              className={`role-card ${active ? "selected" : ""}`}
              onClick={() => toggleBereich(b.key)}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              onKeyDown={(e) => handleCardKeyDown(e, () => toggleBereich(b.key))}
            >
              {active && <span className="role-card-check" aria-hidden="true">✓</span>}
              <div className="role-card-icon" aria-hidden="true">{BEREICH_ICONS[b.key] ?? "🧭"}</div>
              <div className="role-card-name">{b.label}</div>
            </div>
          );
        })}
      </div>

      {selectedBereich.size > 0 && (
        <div style={{ marginTop: "16px" }}>
          <button
            type="button"
            onClick={() => setShowLearningGoals((v) => !v)}
            style={{
              width: "100%",
              border: "1px solid var(--border-soft)",
              borderRadius: "16px",
              padding: "15px 17px",
              background: showLearningGoals ? "var(--surface-soft, rgba(95,220,153,.08))" : "var(--surface, #fff)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "14px",
              textAlign: "left",
              boxShadow: showLearningGoals ? "0 8px 24px rgba(0,0,0,.06)" : "none",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "11px" }}>
              <span
                aria-hidden="true"
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "10px",
                  display: "grid",
                  placeItems: "center",
                  background: "linear-gradient(135deg, rgba(95,220,153,.18), rgba(47,143,214,.14))",
                  fontSize: "18px",
                }}
              >
                ✦
              </span>
              <span>
                <strong style={{ display: "block", fontSize: "15px" }}>
                  Konkrete Skills festlegen
                </strong>
                <span className="hint">
                  {selectedSkillIds.size > 0
                    ? `${selectedSkillIds.size} Lernziel${selectedSkillIds.size === 1 ? "" : "e"} ausgewählt`
                    : "Optional — wenn du schon weißt, was du lernen möchtest"}
                </span>
              </span>
            </span>
            <span aria-hidden="true" style={{ fontSize: "18px", opacity: 0.65 }}>
              {showLearningGoals ? "⌃" : "→"}
            </span>
          </button>

          {showLearningGoals && (
            <div
              style={{
                marginTop: "10px",
                padding: "15px",
                borderRadius: "16px",
                background: "rgba(127,127,127,.035)",
                border: "1px solid var(--border-soft)",
              }}
            >
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontWeight: 700, fontSize: "15px" }}>
                  Was möchtest du in {selectedLabels} lernen?
                </div>
                <div className="hint" style={{ marginTop: "4px" }}>
                  Wähle nur das aus, was dich gerade wirklich interessiert. Wir priorisieren diese Lernziele später bei der Weiterbildungssuche.
                </div>
              </div>

              <div className="quiz-list">
                {learningSkills.map((s) => {
                  const active = selectedSkillIds.has(s.skill_id);
                  return (
                    <div
                      key={s.skill_id}
                      className={`quiz-item ${active ? "checked" : ""}`}
                      onClick={() => onToggleSkill(s.skill_id)}
                      role="checkbox"
                      aria-checked={active}
                      tabIndex={0}
                      onKeyDown={(e) => handleCardKeyDown(e, () => onToggleSkill(s.skill_id))}
                    >
                      <div className="check-box" aria-hidden="true">✓</div>
                      <div className="quiz-item-label">{s.name}</div>
                    </div>
                  );
                })}
              </div>

              {selectedLearningLabels.length > 0 && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "10px 12px",
                    borderRadius: "12px",
                    background: "rgba(95,220,153,.08)",
                    fontSize: "13px",
                  }}
                >
                  <strong>Deine Lernziele:</strong>{" "}
                  {selectedLearningLabels.slice(0, 4).join(" · ")}
                  {selectedLearningLabels.length > 4 ? ` +${selectedLearningLabels.length - 4}` : ""}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {selectedBereich.size > 0 && (
        <div className="cta-block" style={{ marginTop: "18px" }}>
          <button
            type="button"
            className={`btn-cta-primary ${advancing ? "loading" : ""}`}
            onClick={goWithBereich}
          >
            {advancing ? (
              <>
                <span className="btn-spinner" aria-hidden="true" /> Lernweg wird vorbereitet…
              </>
            ) : (
              <>
                {selectedSkillIds.size > 0 ? "Mit meinen Lernzielen weiter" : "Mit diesem Bereich weiter"}
                <span className="arrow">→</span>
              </>
            )}
          </button>
          <div className="hint" style={{ textAlign: "center", marginTop: "9px" }}>
            {selectedSkillIds.size > 0
              ? `${selectedSkillIds.size} Lernziel${selectedSkillIds.size === 1 ? "" : "e"} fließen in deine Empfehlungen ein.`
              : "Du kannst später noch genauer angeben, was du bereits kannst."}
          </div>
        </div>
      )}

      <div
        className="method-switch"
        onClick={onBrowseAll}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => handleCardKeyDown(e, onBrowseAll)}
        style={{ marginTop: "14px", display: "block", textAlign: "center" }}
      >
        🎯 Ich kenne meine genaue Zielrolle bereits
      </div>

      <ActionsRow onBack={onBack} hideForward />
    </div>
  );
}
function ZielrolleStep({
  roles,
  loading,
  error,
  onRetry,
  selectedRoleId,
  onSelect,
  onForward,
  onBack,
}: {
  roles: TargetRole[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selectedRoleId: string | null;
  onSelect: (role: TargetRole) => void;
  onForward: () => void;
  onBack?: () => void;
}) {
  // Freitext-Suche: eigene Wunschrolle eintippen, statt nur aus Karten zu
  // waehlen. Es kann dabei keine neue Rolle "erfunden" werden (das Backend
  // braucht fuer Skill-Gap/Kursmatching zwingend eine bekannte
  // target_role_id) — stattdessen wird die Eingabe per rankRolesByQuery()
  // gegen die vorhandenen Rollen "gematcht" und als sortierte Vorschlagsliste
  // angezeigt. So bekommt man auch bei abweichender Formulierung
  // ("Datenanalystin" statt "Data Analyst") die naechstliegenden echten Jobs.
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  // Direkt-Weiter beim Anklicken einer Rolle (statt Auswahl + separatem
  // Scrollen zum "Weiter"-Button, der bei einer langen Rollenliste erst nach
  // dem Scrollen sichtbar ist). pendingId haelt kurz den geklickten Karten-
  // Zustand fest, damit der Haken sichtbar aufploppt (siehe .role-card-check,
  // popIn-Animation), bevor automatisch zum naechsten Schritt gesprungen
  // wird — fuehlt sich dadurch bestaetigt statt abrupt an.
  const [pendingId, setPendingId] = useState<string | null>(null);
  function pickRole(role: TargetRole) {
    if (pendingId) return;
    onSelect(role);
    setPendingId(role.role_id);
    window.setTimeout(() => onForward(), 320);
  }

  if (loading) return <div className="hint">Lade Zielrollen…</div>;
  if (error) {
    return (
      <div>
        <div className="status-line err" aria-live="polite">
          {error}
        </div>
        <ActionsRow forwardLabel="Erneut versuchen" onForward={onRetry} />
      </div>
    );
  }

  let visible: TargetRole[];
  let weakMatch = false;
  if (trimmedQuery) {
    visible = rankRolesByQuery(roles, trimmedQuery);
    const bestScore = visible.length > 0 ? roleMatchScore(trimmedQuery, visible[0].role_name) : 0;
    weakMatch = bestScore < 55;
  } else {
    visible = roles;
  }

  return (
    <div>
      <JourneyStepHeading
        step="05"
        kicker="ZIELROLLE"
        title="Welche Rolle möchtest du als Nächstes erreichen?"
        description="Wähle eine konkrete Zielrolle oder suche nach dem Job, der dich interessiert."
      />
      <input
        id="roleSearchInput"
        className="big-input"
        style={{ marginBottom: trimmedQuery ? "6px" : "14px" }}
        placeholder="Rolle suchen oder selbst eintragen (z. B. „Data Analyst“)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {trimmedQuery && (
        <div className="hint" style={{ marginBottom: "10px" }}>
          {weakMatch
            ? "Keine exakte Übereinstimmung — hier die ähnlichsten Rollen aus unserem Angebot:"
            : `Treffer für „${trimmedQuery}“:`}
        </div>
      )}
      {visible.length === 0 ? (
        <div className="hint">Keine Rollen gefunden.</div>
      ) : (
        <>
          {!trimmedQuery && (
            <div className="hint" style={{ marginBottom: "10px" }}>
              {visible.length} Zielrolle{visible.length === 1 ? "" : "n"} verfügbar
            </div>
          )}
          <div className={`role-grid ${pendingId ? "picking" : ""}`}>
            {visible.map((r) => {
              const isSelected = selectedRoleId === r.role_id;
              const isPending = pendingId === r.role_id;
              return (
                <div
                  key={r.role_id}
                  className={`role-card ${isSelected ? "selected" : ""} ${isPending ? "advancing" : ""}`}
                  onClick={() => pickRole(r)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onKeyDown={(e) => handleCardKeyDown(e, () => pickRole(r))}
                >
                  {isSelected && (
                    <span className="role-card-check" aria-hidden="true">
                      ✓
                    </span>
                  )}
                  <div className="role-card-icon" aria-hidden="true">
                    {roleIcon(r.role_name)}
                  </div>
                  <div className="role-card-name">{r.role_name}</div>
                  <div className="role-card-meta">{r.required_skill_count} Kern-Skills</div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {/* "Weiter"-Button bleibt als Fallback erhalten (z.B. falls jemand die
         Rolle schon aus einem vorherigen Besuch vorausgewählt hat) — im
         Normalfall navigiert pickRole() aber automatisch weiter, sodass er
         praktisch nie mehr gebraucht wird. */}
      <ActionsRow onBack={onBack} forwardLabel="Weiter →" forwardDisabled={!selectedRoleId} onForward={onForward} />
    </div>
  );
}
interface SkillsMethodStepProps {
  method: Method;
  setMethod: (m: Method) => void;
  targetRoleName: string | null;
  text: string;
  setText: (t: string) => void;
  onSubmitText: () => void;
  uploadBusy: boolean;
  uploadStatus: { msg: string; kind: "ok" | "err" | "" };
  fileInputRef: RefObject<HTMLInputElement>;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  roleSkills: RoleSkillStatus[];
  /** Die tatsächlich abgefragte Teilmenge von roleSkills (siehe
   *  pickCoreQuestionSkills() in JourneyPage) — einzige Quelle der Wahrheit
   *  dafür, welche Skills FragebogenMethod stellt UND buildQuizGapResult()
   *  auswertet. */
  questionSkills: RoleSkillStatus[];
  loadingRoleSkills: boolean;
  roleSkillsError: string | null;
  checkedSkills: Set<string>;
  toggleSkill: (uri: string) => void;
  /** Teil 2 (22.09.2026, siehe SkillDepth-Kommentar in JourneyPage): Grad +
   *  Aktualität je bestätigtem Skill — parallel zu checkedSkills. */
  skillDepthByUri: Map<string, SkillDepth>;
  /** Einziger Schreibpfad im Fragebogen-Pfad für Teil 2 (ersetzt toggleSkill
   *  dort) — siehe answerQuizSkill() in JourneyPage. */
  onAnswerSkill: (uri: string, depth: SkillDepth | null) => void;
  onSubmitQuiz: () => void;
  skillsBusy: boolean;
  skillsError: string | null;
  onBack: () => void;
  /** DSGVO-Nachweis (Version 28): wird von CvMethod aufgerufen, sobald die
   *  dortige Einwilligungs-Checkbox angehakt wird — hält in JourneyPage einen
   *  Zeitstempel fest, unabhängig davon, dass die Checkbox selbst beim
   *  erneuten Betreten des Schritts zurückgesetzt wird (siehe Kommentar bei
   *  dsgvoConsent in CvMethod). */
  onCvConsentGiven: () => void;
  /** Siehe privacyPolicyUrl in JourneyPageProps (Version 28). */
  privacyPolicyUrl: string;
  /** Avatar/Guide (22.09.2026, siehe GuideAvatarBubble-Kommentar) — alle drei
   *  1:1 aus JourneyPageProps durchgereicht, kein eigener Zustand hier. */
  showAvatar: boolean;
  avatarName: string;
  avatarAccentColor: string | undefined;
}
function SkillsMethodStep(props: SkillsMethodStepProps) {
  const { method, setMethod, onBack, targetRoleName, showAvatar, avatarName, avatarAccentColor } = props;
  // Avatar-Vorstellung (siehe GuideAvatarBubble-Kommentar): erscheint einmal
  // auf dem allerersten Bildschirm des Skills-Schritts — dem natürlichen
  // "Anfang" der Kompetenzerhebung, noch vor der Wahl zwischen CV-Upload und
  // Fragebogen, also unabhängig vom später gewählten Pfad. Lokaler State
  // (nicht in JourneyPage gehoben): reine Anzeige-Entscheidung, kein Wert,
  // der irgendwo sonst gebraucht wird — bleibt bewusst auch beim Wechsel
  // zwischen CvMethod/FragebogenMethod erhalten, weil SkillsMethodStep dabei
  // nicht neu gemountet wird (nur method wechselt).
  const [avatarDismissed, setAvatarDismissed] = useState(false);
  if (!method) {
    return (
      <div>
        {showAvatar && !avatarDismissed && (
          <GuideAvatarBubble
            name={avatarName}
            message={`Hi, ich bin ${avatarName} — dein digitaler Guide für den Skill-Check. Ich zeig dir kurz, worauf es ankommt, und melde mich, wenn's wichtig wird.`}
            accentColor={avatarAccentColor}
            onDismiss={() => setAvatarDismissed(true)}
          />
        )}
        <JourneyStepHeading
          step="06"
          kicker="DEIN PROFIL"
          title="Was bringst du heute schon mit?"
          description="Wir gleichen deine Erfahrungen mit den Anforderungen deiner Zielrolle ab."
        />
        <div className="method-grid">
          <div
            className="method-card"
            onClick={() => setMethod("cv")}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => handleCardKeyDown(e, () => setMethod("cv"))}
          >
            <div className="method-icon" aria-hidden="true">📄</div>
            <div className="method-title">Lebenslauf hochladen</div>
            <div className="method-sub">
              Lade deinen Lebenslauf hoch — wir gleichen ihn mit{" "}
              <b>{targetRoleName || "deiner Zielrolle"}</b> ab.
            </div>
          </div>
          <div
            className="method-card"
            onClick={() => setMethod("fragebogen")}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => handleCardKeyDown(e, () => setMethod("fragebogen"))}
          >
            <div className="method-icon" aria-hidden="true">☑️</div>
            <div className="method-title">Fragebogen</div>
            <div className="method-sub">
              Wir zeigen dir die Skills für <b>{targetRoleName || "deine Zielrolle"}</b> — du hakst ab, was du schon
              kannst.
            </div>
          </div>
        </div>
        <ActionsRow onBack={onBack} hideForward />
      </div>
    );
  }
  if (method === "fragebogen") {
    return <FragebogenMethod {...props} />;
  }
  return <CvMethod {...props} />;
}
// (Version 28) PRIVACY_POLICY_URL ist keine feste Modul-Konstante mehr,
// sondern kommt jetzt als privacyPolicyUrl-Prop von JourneyPage (siehe
// JourneyPageProps) — jeder Tenant kann so seine eigene, echte
// Datenschutzerklärung verlinken. Der Hinweis bleibt trotzdem wichtig:
// Wortlaut unten ist ein erster Entwurf, keine Rechtsberatung — bitte vor dem
// Live-Gang mit einem Anwalt/Datenschutzbeauftragten gegenchecken
// (insbesondere: reicht eine einfache Checkbox als Einwilligung für die
// Verarbeitung durch OpenAI als Drittland-Auftragsverarbeiter?). Ein erster
// Entwurf der eigentlichen Datenschutzerklärung liegt als eigene Datei bei
// (Datenschutzerklaerung_ENTWURF.md).

/** Individualisierte (per Zielrollen-Name), aber bewusst NICHT mit
 * erfundenen Zahlen/Statistiken angereicherte Begleittexte fuer die
 * Warteanimation beim Hochladen/Analysieren (siehe Kommentar bei
 * skillImportance oben: gleiches Prinzip "keine erfundenen Fakten" gilt
 * auch hier). Bleiben bewusst bei allgemeingueltigen, ehrlichen Aussagen
 * ueber Weiterbildung/Berufsentwicklung, personalisiert nur durch Einsetzen
 * des Zielrollen-Namens. */
function cvLoadingMessages(roleName: string | null) {
  const role = roleName || "deine Zielrolle";
  return [
    {
      title: "Lebenslauf wird eingelesen",
      body: "Wir lesen gerade den Text aus deinem Dokument aus — bei umfangreicheren Lebensläufen kann das ein paar Sekunden dauern.",
    },
    {
      title: "Warum Weiterbildung zählt",
      body: `Anforderungen an Rollen wie „${role}“ entwickeln sich laufend weiter. Gezielte Weiterbildung hilft dir, mit diesen Entwicklungen Schritt zu halten, statt hinterherzulaufen.`,
    },
    {
      title: "Individueller Abgleich",
      body: `Wir gleichen deine bisherigen Erfahrungen konkret mit den Kompetenzen ab, die für „${role}“ gefragt sind — nicht mit einer generischen Checkliste.`,
    },
    {
      title: "Gleich geht's weiter",
      body: `Du siehst gleich genau, welche Fähigkeiten du für „${role}“ schon mitbringst — und an welcher Stelle eine Weiterbildung den größten Unterschied machen würde.`,
    },
  ];
}
/** Warte-Animation waehrend Lebenslauf-Extraktion (uploadBusy) bzw.
 * Skill-Gap-Berechnung (skillsBusy) — siehe Anfrage "Nutzer waehrend der
 * Analyse an den Prozess binden". Fortschrittsbalken ist bewusst simuliert
 * (naehert sich 92% an, ohne "fertig" zu behaupten): der Server liefert
 * keinen echten Fortschritts-Prozentsatz fuer einen einzelnen Fetch-Call,
 * und ein erfundener exakter Wert waere irrefuehrend. Springt beim
 * tatsaechlichen Abschluss (Elternkomponente haengt diese Komponente dann
 * aus) nicht mehr weiter, statt eine falsche Endzeit vorzutaeuschen. */
function CvAnalysisLoader({ roleName, phase }: { roleName: string | null; phase: "extracting" | "analyzing" }) {
  const messages = useMemo(() => cvLoadingMessages(roleName), [roleName]);
  const [msgIndex, setMsgIndex] = useState(0);
  const [progress, setProgress] = useState(6);
  useEffect(() => {
    const msgTimer = setInterval(() => setMsgIndex((i) => (i + 1) % messages.length), 4200);
    return () => clearInterval(msgTimer);
  }, [messages.length]);
  useEffect(() => {
    const tick = setInterval(() => setProgress((p) => (p >= 92 ? 92 : p + (92 - p) * 0.08 + 0.4)), 220);
    return () => clearInterval(tick);
  }, []);
  const current = messages[msgIndex];
  return (
    <div className="cv-loading" role="status" aria-live="polite">
      <div className="cv-loading-spinner" aria-hidden="true">
        <div className="cv-loading-spinner-ring" />
        <div className="cv-loading-spinner-icon">📄</div>
      </div>
      <div className="cv-loading-phase">
        {phase === "extracting" ? "Lebenslauf wird eingelesen…" : "Skill-Abgleich läuft…"}
      </div>
      <div className="cv-loading-bar-track">
        <div className="cv-loading-bar-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="cv-loading-message" key={msgIndex}>
        <div className="cv-loading-message-title">{current.title}</div>
        <div className="cv-loading-message-body">{current.body}</div>
      </div>
    </div>
  );
}
function CvMethod({
  setMethod,
  targetRoleName,
  text,
  uploadBusy,
  uploadStatus,
  fileInputRef,
  onFileChange,
  onSubmitText,
  skillsBusy,
  skillsError,
  onCvConsentGiven,
  privacyPolicyUrl,
}: SkillsMethodStepProps) {
  // Eigener, lokaler State (nicht in JourneyPage gehoben): die Einwilligung
  // gilt nur fuer den aktuellen Aufenthalt in diesem Schritt - verlaesst man
  // die Methode und kommt zurueck (setMethod(null) -> setMethod("cv")), wird
  // die Checkbox bewusst wieder zurueckgesetzt, statt sich etwas zu merken,
  // das der Nutzer so nie bestaetigt hat.
  const [dsgvoConsent, setDsgvoConsent] = useState(false);
  // Waehrend Extraktion ODER Gap-Berechnung: komplette Warte-Animation statt
  // Formular, damit der Nutzer waehrend der (teils 10-25s dauernden)
  // Wartezeit inhaltlich abgeholt wird statt nur einen Spinner-Button zu sehen.
  if (uploadBusy || skillsBusy) {
    return <CvAnalysisLoader roleName={targetRoleName} phase={uploadBusy ? "extracting" : "analyzing"} />;
  }
  return (
    <div>
      <div
        className="method-switch"
        onClick={() => setMethod(null)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => handleCardKeyDown(e, () => setMethod(null))}
      >
        ← Andere Methode wählen
      </div>
      <label className="field-label">
        Lade deinen Lebenslauf hoch — wir gleichen ihn mit{" "}
        <b>{targetRoleName || "deiner Zielrolle"}</b> ab.
      </label>
      <label className="dsgvo-consent-row">
        <input
          type="checkbox"
          checked={dsgvoConsent}
          onChange={(e) => {
            setDsgvoConsent(e.target.checked);
            // DSGVO-Nachweis (Version 28): Zeitstempel nur beim Setzen auf
            // "zugestimmt" festhalten — ein Zurücknehmen des Hakens löscht den
            // bereits erfolgten Nachweis nicht rückwirkend, es wird nur kein
            // neuer Upload/keine neue Analyse mehr zugelassen (siehe disabled
            // am Upload-Button unten).
            if (e.target.checked) onCvConsentGiven();
          }}
        />
        <span>
          Ich bin damit einverstanden, dass der Inhalt meines Lebenslaufs zur Skill-Analyse verarbeitet wird — auch durch OpenAI Ireland Ltd als KI-Dienstleister im Rahmen einer Auftragsverarbeitung (Art. 28 DSGVO). Eine Übermittlung an OpenAI-Konzerngesellschaften außerhalb der EU erfolgt dabei ausschließlich auf Grundlage der EU-Standardvertragsklauseln.
          {privacyPolicyUrl ? (
            <>
              {" "}
              Mehr dazu in der{" "}
              <a href={privacyPolicyUrl} target="_blank" rel="noreferrer">
                Datenschutzerklärung
              </a>
              .
            </>
          ) : (
            " Mehr dazu in der Datenschutzerklärung."
          )}
        </span>
      </label>
      <div className="upload-row">
        <input type="file" accept=".pdf,.docx,.txt" style={{ display: "none" }} ref={fileInputRef} onChange={onFileChange} />
        <button
          type="button"
          className={`upload-btn ${uploadBusy ? "busy" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          disabled={!dsgvoConsent || uploadBusy}
          title={!dsgvoConsent ? "Bitte zuerst der Verarbeitung zustimmen." : undefined}
        >
          {uploadBusy ? "⏳ Lese Datei…" : "📄 Lebenslauf hochladen"}
        </button>
        {uploadStatus.msg && (
          <span className={`upload-status ${uploadStatus.kind}`} aria-live="polite">
            {uploadStatus.msg}
          </span>
        )}
      </div>
      {uploadStatus.kind === "err" && (
        // Seit dem Wegfall der freien Texteingabe gibt es in diesem Schritt
        // keinen manuellen Fallback mehr - bei einem fehlgeschlagenen Upload
        // (egal aus welchem Grund: kein Text erkannt, falscher Dateityp,
        // Datei zu gross, ...) waere sonst kein Weiter mehr moeglich. Der
        // Fragebogen bleibt in jedem Fall eine funktionierende Alternative.
        <div
          className="method-switch"
          onClick={() => setMethod("fragebogen")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => handleCardKeyDown(e, () => setMethod("fragebogen"))}
        >
          → Stattdessen Fragebogen nutzen
        </div>
      )}
      <div className="hint">Unterstützt: PDF, Word, TXT.</div>
      {skillsError && (
        <div className="status-line err" aria-live="polite">
          {skillsError}
        </div>
      )}
      <ActionsRow
        forwardLabel={skillsBusy ? "Berechne…" : "Skill-Gap berechnen →"}
        onForward={onSubmitText}
        forwardDisabled={skillsBusy || !text.trim() || !dsgvoConsent}
        busy={skillsBusy}
      />
    </div>
  );
}
/**
 * Teil 2 (22.09.2026) — vollständig neu gegenüber der Ja/Nein-Karte:
 *
 * - Statt zwei Buttons eine 3×3-Matrix (Grad × Aktualität, siehe
 *   PROFICIENCY_ROWS/RECENCY_COLS oben) — EIN Tap auf eine Zelle beantwortet
 *   "Ja" UND erfasst Grad + Aktualität gleichzeitig. Genau ein Tap pro Skill,
 *   wie vorher — nur mit neun statt zwei möglichen, aussagekräftigeren
 *   Antworten. Ein separater Button bleibt für "Noch nicht".
 * - Ein kleiner, live mitwachsender Match-Ring ersetzt/ergänzt die reine
 *   "Frage X von Y"-Zählung — macht sichtbar, wie sich jede Antwort direkt
 *   auf das Ergebnis auswirkt, statt es bis zur Motivations-Zwischenseite
 *   komplett zu verstecken.
 * - Nach der letzten Kern-Frage kein sofortiges Auto-Submit mehr, sondern ein
 *   kurzer "erfasst"-Zwischenstand INNERHALB desselben Schritts (kein neuer
 *   Stepper-Eintrag!) mit einem optionalen "+ N weitere (ergänzend)"-Link für
 *   Skills außerhalb der Kern-Auswahl — bewusst als einfacher Ein-Tap-Chip
 *   (nicht die volle Matrix), weil es sich um freiwillige Zusatzangaben
 *   handelt und Vorgabe "nicht zu viele Schritte" für Zusatzinteraktionen
 *   erst recht gilt.
 */
function FragebogenMethod({
  setMethod,
  targetRoleName,
  roleSkills,
  questionSkills,
  loadingRoleSkills,
  roleSkillsError,
  checkedSkills,
  onAnswerSkill,
  onSubmitQuiz,
  skillsBusy,
  skillsError,
  showAvatar,
  avatarName,
  avatarAccentColor,
}: SkillsMethodStepProps) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, SkillDepth | "no">>({});
  const [phase, setPhase] = useState<"asking" | "done">("asking");
  const [extraOpen, setExtraOpen] = useState(false);
  // Avatar-Tipp (22.09.2026, siehe GuideAvatarBubble-Kommentar): erklärt
  // gezielt die neue 3×3-Matrix (Teil 2 desselben Tages) — genau die Stelle
  // im Prozess, an der eine kurze Erklärung den größten Nutzen hat, weil die
  // Interaktion neu/ungewohnt ist. Erscheint nur bei der ersten Frage, nicht
  // bei jeder — sonst würde sie schnell nerven statt zu helfen.
  const [tipDismissed, setTipDismissed] = useState(false);

  useEffect(() => {
    setIndex(0);
    setAnswers({});
    setPhase("asking");
    setExtraOpen(false);
    setTipDismissed(false);
  }, [questionSkills.length]);

  // Bugfix 22.09.2026: questionSkills kommt fertig aus JourneyPage
  // (pickCoreQuestionSkills() — Pareto-Kern-Skills statt fixer "erste 8",
  // siehe dortiger Kommentar), nicht mehr lokal hier berechnet. Wichtig:
  // buildQuizGapResult() in JourneyPage wertet dieselbe Kern-Liste (plus
  // freiwillig beantwortete Zusatz-Skills, siehe extraSkills unten) aus —
  // "gefragt" und "gewertet" dürfen nie wieder auseinanderlaufen.

  // Teil 2: alle Rollen-Skills außerhalb der Kern-Auswahl — Kandidaten für
  // den "+ N weitere"-Link im "done"-Zwischenstand unten.
  const extraSkills = useMemo(
    () => roleSkills.filter((s) => !questionSkills.some((q) => q.esco_uri === s.esco_uri)),
    [roleSkills, questionSkills]
  );

  // Live-Match: exakt dieselbe gewichtete Formel wie buildQuizGapResult()
  // in JourneyPage, aber laufend über den lokalen answers-State statt über
  // das erst am Ende gebaute gapResult — jede beantwortete Frage lässt den
  // Ring sofort sichtbar wachsen, bis er am Ende exakt dem Wert entspricht,
  // den die Motivations-Zwischenseite direkt danach zeigt.
  const liveMatch = useMemo(() => {
    let totalWeight = 0;
    let coveredWeight = 0;
    for (const s of questionSkills) {
      totalWeight += s.weight;
      const a = answers[s.esco_uri];
      if (a && a !== "no") coveredWeight += s.weight * (quizSkillScore(a) / 100);
    }
    return totalWeight > 0 ? Math.round((coveredWeight / totalWeight) * 1000) / 10 : 0;
  }, [answers, questionSkills]);

  if (loadingRoleSkills) {
    return (
      <div style={{ textAlign: "center", padding: "28px 10px" }}>
        <div style={{ fontSize: "28px", marginBottom: "10px" }}>🧭</div>
        <div className="field-label" style={{ marginBottom: "6px" }}>Deinen Skill-Check vorbereiten…</div>
        <div className="hint">Wir stellen dir nur Fragen, die zu deinem Ziel passen.</div>
      </div>
    );
  }

  if (roleSkillsError) {
    return <div className="status-line err" aria-live="polite">{roleSkillsError}</div>;
  }

  if (questionSkills.length === 0) {
    return (
      <div>
        <div className="field-label">Dein Skill-Check</div>
        <div className="hint">Für dieses Ziel sind aktuell keine Skills hinterlegt. Du kannst trotzdem fortfahren.</div>
        <ActionsRow
          forwardLabel="Zum Ergebnis →"
          onForward={onSubmitQuiz}
          forwardDisabled={skillsBusy}
          busy={skillsBusy}
          onBack={() => setMethod(null)}
        />
      </div>
    );
  }

  const safeIndex = Math.min(index, questionSkills.length - 1);
  const skill = questionSkills[safeIndex];
  const answered = answers[skill.esco_uri];
  const answeredCount = Object.keys(answers).length;
  const remaining = questionSkills.length - answeredCount;
  const isLast = safeIndex === questionSkills.length - 1;

  function advance() {
    if (safeIndex < questionSkills.length - 1) {
      window.setTimeout(() => setIndex((i) => Math.min(questionSkills.length - 1, i + 1)), 260);
    } else {
      // Nach der letzten Kern-Frage: kurzer Zwischenstand statt sofortigem
      // Auto-Submit (siehe Funktionskommentar oben) — die Person sieht ihr
      // Ergebnis wachsen und kann optional noch ergänzende Skills angeben,
      // statt direkt weitergerissen zu werden.
      window.setTimeout(() => setPhase("done"), 320);
    }
  }

  function selectDepth(proficiency: ProficiencyBucket, recency: RecencyBucket) {
    const depth: SkillDepth = { proficiency, recency };
    setAnswers((prev) => ({ ...prev, [skill.esco_uri]: depth }));
    onAnswerSkill(skill.esco_uri, depth);
    advance();
  }

  function markNotYet() {
    setAnswers((prev) => ({ ...prev, [skill.esco_uri]: "no" }));
    onAnswerSkill(skill.esco_uri, null);
    advance();
  }

  function previous() {
    setIndex((i) => Math.max(0, i - 1));
  }

  function toggleExtra(uri: string) {
    if (checkedSkills.has(uri)) onAnswerSkill(uri, null);
    else onAnswerSkill(uri, DEFAULT_EXTRA_SKILL_DEPTH);
  }

  if (phase === "done") {
    return (
      <div>
        <button
          type="button"
          className="method-switch"
          onClick={() => setMethod(null)}
          style={{ marginBottom: "10px" }}
        >
          ← Andere Methode wählen
        </button>

        <div className="quiz-done">
          <div className="quiz-done-ring">
            <MatchRing percent={liveMatch} size={88} />
          </div>
          <div className="quiz-done-headline">Kern-Skills erfasst ✓</div>
          <div className="quiz-done-sub">
            Du hast alle {questionSkills.length} wichtigsten Skills für{" "}
            {targetRoleName || "deine Zielrolle"} beantwortet — mit Grad und Aktualität statt
            nur Ja/Nein.
          </div>
          <button
            type="button"
            className="quiz-edit-answers"
            onClick={() => {
              setPhase("asking");
              setIndex(questionSkills.length - 1);
            }}
          >
            ← Antworten noch anpassen
          </button>

          {extraSkills.length > 0 && (
            <div className="quiz-extra-section">
              {!extraOpen ? (
                <button type="button" className="quiz-extra-toggle" onClick={() => setExtraOpen(true)}>
                  + {extraSkills.length} weitere (ergänzend) auch angeben
                </button>
              ) : (
                <div className="quiz-extra-list">
                  <div className="quiz-extra-hint">
                    Optional — zählt zusätzlich mit, sobald du eine Fähigkeit antippst.
                  </div>
                  <div className="quiz-extra-chips">
                    {extraSkills.map((s) => {
                      const isChecked = checkedSkills.has(s.esco_uri);
                      return (
                        <button
                          key={s.esco_uri}
                          type="button"
                          className={`quiz-extra-chip ${isChecked ? "checked" : ""}`}
                          onClick={() => toggleExtra(s.esco_uri)}
                          aria-pressed={isChecked}
                        >
                          <span className="quiz-extra-chip-check" aria-hidden="true">
                            {isChecked ? "✓" : ""}
                          </span>
                          {s.preferred_label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {skillsError && <div className="status-line err" aria-live="polite">{skillsError}</div>}

        <ActionsRow
          forwardLabel={skillsBusy ? "Ergebnis wird erstellt…" : "Mein Skill-Profil ansehen →"}
          onForward={onSubmitQuiz}
          forwardDisabled={skillsBusy}
          busy={skillsBusy}
        />
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="method-switch"
        onClick={() => setMethod(null)}
        style={{ marginBottom: "10px" }}
      >
        ← Andere Methode wählen
      </button>

      <JourneyStepHeading
        step="06"
        kicker="DEIN PROFIL"
        title="Was bringst du bereits mit?"
        description={`Wir haben die für ${targetRoleName || "dein Ziel"} wichtigsten Fähigkeiten herausgefiltert. Du beantwortest nur ${questionSkills.length} kurze Praxisfragen — daraus entsteht dein persönliches Skill-Profil.`}
      />

      {showAvatar && !tipDismissed && safeIndex === 0 && (
        <GuideAvatarBubble
          name={avatarName}
          message="Tipp: Ein Antippen genügt — wähle einfach die Zelle, die am besten zu deinem Grad und deiner Aktualität passt. 'Noch nicht' bleibt als eigener Button darunter."
          accentColor={avatarAccentColor}
          onDismiss={() => setTipDismissed(true)}
        />
      )}

      <div className="quiz-progress-row">
        <div className="quiz-live-ring">
          <MatchRing percent={liveMatch} size={52} />
        </div>
        <div className="quiz-progress-text">
          <div className="quiz-progress-count">
            Skill {safeIndex + 1} von {questionSkills.length}
          </div>
          <div className="hint">{remaining > 0 ? `${remaining} offen` : "Kern-Check abgeschlossen"}</div>
        </div>
      </div>

      {(() => {
        const context = skillQuestionContext(skill, targetRoleName);
        return (
          <div key={skill.esco_uri} className="quiz-depth-card" style={{ padding: "24px", borderRadius: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", marginBottom: "18px" }}>
              <div>
                <div className="quiz-depth-card-kicker">SKILL {safeIndex + 1} · DEIN PROFIL</div>
                <div className="quiz-depth-card-title" style={{ fontSize: "28px", lineHeight: 1.12 }}>{skill.preferred_label}</div>
              </div>
              <div style={{ fontSize: "12px", fontWeight: 750, padding: "8px 11px", borderRadius: "999px", background: "rgba(47,143,214,.08)", whiteSpace: "nowrap" }}>
                {Math.round(skill.weight * 100)}% Relevanz
              </div>
            </div>

            <div style={{ fontSize: "20px", fontWeight: 820, lineHeight: 1.25, marginBottom: "8px" }}>{context.title}</div>
            <div className="hint" style={{ fontSize: "14px", lineHeight: 1.55, marginBottom: "6px" }}>{context.body}</div>
            <div style={{ fontSize: "12px", opacity: .62, marginBottom: "20px" }}>{context.signal}</div>

            <div style={{ display: "grid", gap: "10px" }}>
              {[
                { key: "strong", title: "Ich kann das selbstständig", body: "Ich setze es aktuell praktisch ein.", depth: { proficiency: "experte" as ProficiencyBucket, recency: "aktuell" as RecencyBucket } },
                { key: "solid", title: "Ich habe damit gearbeitet", body: "Ich kann Aufgaben damit selbstständig lösen, aber nicht regelmäßig.", depth: { proficiency: "fortgeschritten" as ProficiencyBucket, recency: "letzte_jahre" as RecencyBucket } },
                { key: "basic", title: "Ich kenne die Grundlagen", body: "Ich habe erste Erfahrung oder theoretisches Wissen.", depth: { proficiency: "grundkenntnisse" as ProficiencyBucket, recency: "letzte_jahre" as RecencyBucket } },
                { key: "gap", title: "Das ist für mich neu", body: "Genau hier könnte eine Weiterbildung ansetzen.", depth: null },
              ].map((option) => {
                const selected = option.key === "gap"
                  ? answered === "no"
                  : !!answered && answered !== "no" && answered.proficiency === option.depth?.proficiency && answered.recency === option.depth?.recency;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => option.depth ? selectDepth(option.depth.proficiency, option.depth.recency) : markNotYet()}
                    aria-pressed={selected}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "16px 17px",
                      borderRadius: "16px",
                      border: selected ? "2px solid var(--accent, #2f8fd6)" : "1px solid var(--border-soft)",
                      background: selected ? "rgba(47,143,214,.07)" : "var(--surface, #fff)",
                      cursor: "pointer",
                      transition: "transform .16s ease, border-color .16s ease, background .16s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ width: "28px", height: "28px", borderRadius: "50%", display: "grid", placeItems: "center", flex: "0 0 auto", border: selected ? "0" : "1px solid var(--border-soft)", background: selected ? "var(--accent, #2f8fd6)" : "transparent", color: selected ? "#fff" : "inherit", fontWeight: 850 }}>{selected ? "✓" : ""}</span>
                      <span style={{ flex: 1 }}>
                        <span style={{ display: "block", fontWeight: 800, fontSize: "15px" }}>{option.title}</span>
                        <span style={{ display: "block", marginTop: "3px", fontSize: "12px", opacity: .68, lineHeight: 1.45 }}>{option.body}</span>
                      </span>
                      <span aria-hidden="true" style={{ opacity: .42, fontSize: "18px" }}>→</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid var(--border-soft)", fontSize: "12px", opacity: .65 }}>
              Deine Antwort verändert direkt, welche Lernfelder ORBIT dir anschließend zeigt.
            </div>
          </div>
        );
      })()}

      <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", marginTop: "12px" }}>
        <button type="button" className="btn-back" onClick={previous} disabled={safeIndex === 0}>
          ← Zurück
        </button>
        {!isLast && answered && (
          <button
            type="button"
            className="btn-forward"
            onClick={() => setIndex((i) => Math.min(questionSkills.length - 1, i + 1))}
          >
            Nächster Skill →
          </button>
        )}
      </div>

      <div
        style={{
          marginTop: "14px",
          padding: "11px 13px",
          borderRadius: "12px",
          background: "rgba(127,127,127,.045)",
          fontSize: "13px",
        }}
      >
        <strong>Wichtig:</strong> Hier geht es nur darum, was du schon kannst.
        Deine Lernziele und dein Bereich werden separat berücksichtigt.
      </div>

      {skillsError && <div className="status-line err" aria-live="polite">{skillsError}</div>}
    </div>
  );
}
/** Ordnet das reale ESCO-Gewicht eines Skills (0.6–1.0, vom Backend geliefert)
 * einer verständlichen Kurz-Erklärung zu. Bewusst KEINE frei erfundenen
 * "warum ist das wichtig"-Texte pro Skill — dafür gibt es keine Datengrundlage,
 * und das widerspräche dem Projekt-Prinzip "keine erfundenen Zahlen/Fakten".
 * Die drei Stufen sind grobe, aber ehrliche Einordnungen der echten Gewichtung. */
function skillImportance(weight: number): { label: string; cls: string } {
  if (weight >= 0.9) return { label: "Kernkompetenz", cls: "core" };
  if (weight >= 0.75) return { label: "Wichtig", cls: "important" };
  return { label: "Hilfreich", cls: "helpful" };
}
/** Kurzlabel für proficiency_level aus der KI-Tiefenanalyse (Version 3 der
 *  Edge Function) — reine Anzeige-Übersetzung, keine eigene Einschätzung. */
const PROFICIENCY_LABELS: Record<string, string> = {
  grundkenntnisse: "Grundkenntnisse",
  fortgeschritten: "Fortgeschritten",
  experte: "Experte",
};
/** Auswahloptionen für die Pill-Leiste, mit der die Person im Gap-Schritt ihr
 *  eigenes Erfahrungslevel zu einem "Vorhanden"-Skill wählt (siehe
 *  selfLevelByUri in JourneyPage) - dieselben drei Stufen wie
 *  PROFICIENCY_LABELS/proficiency_level, damit ein KI-Vorschlag 1:1 als
 *  Vorbelegung übernommen werden kann. */
const LEVEL_OPTIONS: { key: ProficiencyLevel; label: string }[] = [
  { key: "grundkenntnisse", label: "Grundkenntnisse" },
  { key: "fortgeschritten", label: "Fortgeschritten" },
  { key: "experte", label: "Experte" },
];
/** Grobe, rein anzeige-seitige Erkennung der Lebenslauf-ABSCHNITTE anhand
 *  typischer deutscher Überschriften ("Berufserfahrung", "Ausbildung",
 *  "Kenntnisse" o.ä.) — Antwort auf die Rückmeldung "Skills sollen immer mit
 *  Berufsstationen/Ausbildungsstationen/Kenntnissen aus dem Lebenslauf
 *  enthalten sein, nicht mit einem abstrakten %-Wert". Rührt bewusst NICHT
 *  an der eigentlichen Matching-Pipeline (skillMatcher.ts/gapAnalysis.ts) -
 *  reine Zusatz-Auswertung des ohnehin schon vorliegenden Freitexts für die
 *  Anzeige in skillReasonInfo() unten. Eine Zeile zählt nur dann als
 *  Überschrift, wenn sie kurz ist (<=45 Zeichen) UND eines der Muster
 *  enthält - lange Fließtext-Sätze, die zufällig "Ausbildung" erwähnen
 *  (z.B. "Ausbildung zum Kfz-Mechatroniker" als Station), lösen dadurch
 *  KEINEN neuen Abschnitt aus. */
type CvSection = "beruf" | "ausbildung" | "kenntnisse";
const CV_SECTION_PATTERNS: { section: CvSection; re: RegExp }[] = [
  {
    section: "beruf",
    re: /\b(berufserfahrung|beruflicher werdegang|werdegang|praxiserfahrung|arbeitserfahrung|t[aä]tigkeiten|stationen|praktika)\b/i,
  },
  {
    section: "ausbildung",
    re: /\b(ausbildung|bildungsweg|schulbildung|studium|akademische ausbildung|hochschulbildung|schulischer werdegang)\b/i,
  },
  {
    section: "kenntnisse",
    re: /\b(kenntnisse|f[aä]higkeiten|skills|kompetenzen|it-kenntnisse|weiterbildung(en)?|zertifikate|qualifikationen|sprachen)\b/i,
  },
];
const CV_SECTION_LABELS: Record<CvSection, string> = {
  beruf: "deiner Berufserfahrung",
  ausbildung: "deiner Ausbildung",
  kenntnisse: "deinen Kenntnissen/Fähigkeiten",
};
interface CvSectionHeader {
  index: number;
  section: CvSection;
}
function detectCvSectionHeaders(cvText: string): CvSectionHeader[] {
  const headers: CvSectionHeader[] = [];
  let offset = 0;
  for (const rawLine of cvText.split("\n")) {
    const line = rawLine.trim();
    if (line.length > 0 && line.length <= 45) {
      for (const { section, re } of CV_SECTION_PATTERNS) {
        if (re.test(line)) {
          headers.push({ index: offset, section });
          break;
        }
      }
    }
    offset += rawLine.length + 1;
  }
  return headers;
}
/** Sucht eine der Alias-Formen eines Skills WÖRTLICH (case-insensitiv) im
 *  echten Lebenslauftext und liefert - falls gefunden - den Abschnitt (siehe
 *  oben) plus einen kurzen ECHTEN Ausschnitt drumherum (reines Zitat, nichts
 *  umformuliert oder erfunden). Liefert null, wenn sich der ursprüngliche
 *  Treffer (z.B. ein reiner Tippfehler-Fuzzy-Match) nicht wörtlich
 *  wiederfinden lässt - dann bleibt die Anzeige bewusst allgemeiner, statt
 *  einen falschen Ausschnitt zu behaupten (keine erfundenen Fakten). */
function findSkillEvidenceInText(
  cvText: string,
  escoUri: string,
  headers: CvSectionHeader[]
): { section: CvSection | null; snippet: string } | null {
  const catalogSkill = SKILLS_CATALOG.find((sk) => sk.skill_id === escoUri);
  const terms = catalogSkill ? (catalogSkill.aliases.length > 0 ? catalogSkill.aliases : [catalogSkill.name]) : [];
  for (const term of terms) {
    if (term.trim().length < 2) continue;
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const match = cvText.match(re);
    if (match && match.index != null) {
      const idx = match.index;
      let section: CvSection | null = null;
      for (const h of headers) {
        if (h.index <= idx) section = h.section;
        else break;
      }
      const start = Math.max(0, idx - 35);
      const end = Math.min(cvText.length, idx + term.length + 35);
      let snippet = cvText.slice(start, end).replace(/\s+/g, " ").trim();
      if (start > 0) snippet = "…" + snippet;
      if (end < cvText.length) snippet = snippet + "…";
      return { section, snippet };
    }
  }
  return null;
}
/** Sichtbare Begründung + optionales Beleg-Zitat pro Skill im Gap-Schritt —
 *  macht sichtbar, WARUM ein Skill als "vorhanden" oder "noch zu lernen"
 *  eingestuft wurde, statt das (wie bisher) nur im Hover-Tooltip des Chips
 *  zu verstecken.
 *
 *  Reihenfolge der Quellen (jede folgende nur, wenn die vorherige nichts
 *  liefert): (1) eine manuelle Korrektur der Person selbst (höchste
 *  Priorität - überschreibt sogar eine bereits vorhandene KI-Einschätzung,
 *  siehe manualSkillUris/handleMoveSkill); (2) depth.explanation, falls die
 *  KI-Tiefenanalyse (Version 4 der cv-depth-analysis Edge Function, Assessor-
 *  + Kontrolleur-Durchgang) bereits zurück ist — eine für GENAU diesen Skill
 *  erzeugte und gegen den echten Lebenslauftext geprüfte Begründung (siehe
 *  sanitizeQuotes dort), kein generischer Text; (3) solange die noch fehlt
 *  UND die Tiefenanalyse noch läuft, ein Lade-Hinweis; (4) sonst eine
 *  ehrliche, aus dem echten Lebenslauftext selbst abgeleitete Kurzfassung —
 *  bewusst KEIN abstrakter %-Score mehr (siehe findSkillEvidenceInText
 *  oben), sondern konkret WELCHER Lebenslauf-Abschnitt (Berufserfahrung/
 *  Ausbildung/Kenntnisse) den Skill enthält, mit echtem Zitat als Beleg.
 *  Bewusst KEINE frei erfundenen Gründe, siehe Projekt-Prinzip an
 *  skillImportance() oben. */
function skillReasonInfo(
  covered: boolean,
  s: RoleSkillStatus,
  depth: DepthSkillAssessment | undefined,
  depthBusy: boolean,
  method: Method,
  cvText: string,
  cvHeaders: CvSectionHeader[],
  isManual: boolean
): { text: string; quote?: string } {
  if (isManual) {
    return covered
      ? { text: "Von dir manuell als vorhanden markiert." }
      : { text: "Von dir entfernt — zählt jetzt wieder als Lücke." };
  }
  if (depth?.explanation) {
    const showQuote = covered || depth.evidence_found;
    return { text: depth.explanation, quote: showQuote ? depth.evidence_quote ?? undefined : undefined };
  }
  if (depthBusy && method === "cv") {
    return { text: "Die KI-Tiefenanalyse prüft diesen Skill gerade im Detail …" };
  }
  if (covered) {
    if (method === "fragebogen") return { text: "Von dir im interaktiven Skill-Check als vorhanden bestätigt." };
    const evidence = findSkillEvidenceInText(cvText, s.esco_uri, cvHeaders);
    if (evidence) {
      const where = evidence.section ? CV_SECTION_LABELS[evidence.section] : "deinen Angaben";
      return { text: `Gefunden in ${where}.`, quote: evidence.snippet };
    }
    return { text: "In deinen Angaben erkannt." };
  }
  if (method === "fragebogen") return { text: "Von dir noch nicht als vorhanden bestätigt." };
  return { text: "In deinen bisherigen Angaben konnten wir dazu keinen klaren Beleg finden." };
}

/**
 * Kurze Motivations-Zwischenseite direkt nach der Profil-/Skill-Eingabe,
 * bevor die dichte Match-Auswertung (GapStep) kommt — nach dem Vorbild von
 * Taxfix & Co.: ein bewusster, ruhiger Moment mit einer einzigen klaren
 * Botschaft ("das hast du geschafft"), statt direkt in die nächste
 * Informationsdichte zu fallen. Bewusst NICHT mit JourneyStepHeading
 * (Kicker/Titel/Beschreibung wie ein normaler Formular-Schritt), sondern
 * eigenständig zentriert gehalten — genau das soll den Unterschied zu einem
 * "Schritt mit Arbeit" spürbar machen.
 *
 * Verwendet bewusst dieselben Daten wie GapStep (gapResult), damit direkt
 * dahinter keine zweite, leicht abweichende Berechnung entsteht — hier wird
 * nichts neu bewertet, nur das bereits vorliegende Ergebnis gefeiert.
 *
 * Kein Auto-Advance (siehe Kommentar an runGapAnalysis/submitQuizMethod):
 * die Person klickt sich über onForward selbst weiter.
 */
function MotivationStep({
  gapResult,
  goalLabel,
  onForward,
  onBack,
}: {
  gapResult: GapAnalysisResponse;
  goalLabel?: string;
  onForward: () => void;
  onBack: () => void;
}) {
  const coveredCount = gapResult.covered_skills.length;
  const gapCount = gapResult.gap_skills.length;
  const totalCount = coveredCount + gapCount;

  const headline =
    coveredCount === 0
      ? `Alles klar — jetzt kennen wir deinen Startpunkt für ${gapResult.target_role_name}.`
      : gapCount === 0
        ? `Stark! Du bringst schon alle wichtigen Kompetenzen für ${gapResult.target_role_name} mit.`
        : `Stark! Dein Profil für ${gapResult.target_role_name} steht.`;

  const sub =
    totalCount === 0
      ? "Wir werten deine Angaben jetzt aus."
      : coveredCount === 0
        ? `Wir haben ${totalCount} zentrale Kompetenzen für diese Rolle im Blick — als Nächstes zeigen wir dir, wie du sie gezielt aufbaust.`
        : gapCount === 0
          ? "Eine gezielte Vertiefung kann dein Profil trotzdem noch schärfen — wir zeigen dir gleich, wie."
          : `Du bringst bereits ${coveredCount} von ${totalCount} zentralen Kompetenzen mit. Wir zeigen dir jetzt genau, was noch fehlt${goalLabel ? ` auf dem Weg zu „${goalLabel}"` : ""}.`;

  return (
    <div className="motivation-step">
      <div className="motivation-step-ring">
        {/* MatchRing zeigt den Prozentwert bereits selbst mittig im Ring an
            (.ring-value, siehe MatchRing-Komponente) — hier keine zweite,
            duplizierte Zahl daneben. */}
        <MatchRing percent={gapResult.match_percentage} size={132} />
      </div>
      <div className="motivation-step-headline">{headline}</div>
      <div className="motivation-step-sub">{sub}</div>
      {totalCount > 0 && (
        <div className="motivation-step-stats">
          <div className="motivation-step-stat">
            <strong>{coveredCount}</strong>
            <span>schon vorhanden</span>
          </div>
          <div className="motivation-step-stat-divider" aria-hidden="true" />
          <div className="motivation-step-stat">
            <strong>{gapCount}</strong>
            <span>als Lernfeld</span>
          </div>
        </div>
      )}
      <button type="button" className="btn-cta-primary" onClick={onForward}>
        Weiter zu deiner Auswertung <span className="arrow">→</span>
      </button>
      <button type="button" className="dyd-btn-ghost motivation-step-back" onClick={onBack}>
        Angaben noch anpassen
      </button>
    </div>
  );
}

function GapStep({
  gapResult,
  method,
  cvText,
  depthByUri,
  depthOverallAssessment,
  depthBusy,
  selfLevelByUri,
  onSetSelfLevel,
  manualSkillUris,
  onMoveSkill,
  busy,
  error,
  goalLabel,
  onForward,
  onBack,
  leadEmail,
  setLeadEmail,
  consent,
  setConsent,
  earlyCaptureBusy,
  earlyCaptureError,
  earlyLeadSaved,
  onSaveEarly,
}: {
  gapResult: GapAnalysisResponse;
  /** Wie die Person ihre Angaben gemacht hat (Freitext/CV vs. Fragebogen) —
   *  steuert die Fallback-Formulierung in skillReasonInfo(), solange noch
   *  keine depth.explanation da ist (siehe dortigen Kommentar). */
  method: Method;
  /** Der rohe Lebenslauf-/Freitext (JourneyPage-State "text") — Grundlage
   *  für findSkillEvidenceInText()/detectCvSectionHeaders() oben, damit die
   *  Fallback-Begründung konkret aus dem echten Text zitiert statt nur einen
   *  abstrakten Score zu nennen. Leerstring beim Fragebogen-Pfad. */
  cvText: string;
  depthByUri: Map<string, DepthSkillAssessment>;
  /** Ganzheitliche Experten-Einschätzung der KI-Tiefenanalyse (Version 3 der
   *  Edge Function) — null, solange sie noch läuft oder ein älteres Backend
   *  sie nicht liefert. */
  depthOverallAssessment: string | null;
  depthBusy: boolean;
  /** Eigene Erfahrungslevel-Wahl der Person je Skill (neu) — überschreibt bei
   *  einem Skill den KI-Vorschlag (depth.proficiency_level), sobald sie ihn
   *  einmal bewusst angepasst hat. Siehe LEVEL_OPTIONS/onSetSelfLevel. */
  selfLevelByUri: Map<string, ProficiencyLevel>;
  onSetSelfLevel: (escoUri: string, level: ProficiencyLevel) => void;
  /** esco_uris, die die Person bereits manuell entfernt/hinzugefügt hat
   *  (siehe handleMoveSkill in JourneyPage) — steuert sowohl die Begründung
   *  (skillReasonInfo: "Von dir manuell...") als auch, ob der Entfernen-
   *  Button schon "benutzt" aussieht. */
  manualSkillUris: Set<string>;
  onMoveSkill: (escoUri: string, toCovered: boolean) => void;
  busy: boolean;
  error: string | null;
  /** Label des im Ziel-Schritt gewählten Beweggrunds (siehe GOAL_OPTIONS) —
   *  bindet die Lücke schon hier an das genannte Ziel, statt erst im
   *  Kurs-Schritt. undefined, wenn der Ziel-Schritt übersprungen wurde. */
  goalLabel?: string;
  onForward: () => void;
  onBack: () => void;
  leadEmail: string;
  setLeadEmail: (v: string) => void;
  consent: boolean;
  setConsent: (v: boolean) => void;
  earlyCaptureBusy: boolean;
  earlyCaptureError: string | null;
  earlyLeadSaved: boolean;
  onSaveEarly: () => void;
}) {
  const earlyEmailValid = leadEmail.trim().length > 0 && EMAIL_RE.test(leadEmail.trim());
  const coveredCount = gapResult.covered_skills.length;
  const gapCount = gapResult.gap_skills.length;
  const totalCount = coveredCount + gapCount;
  // Einmal pro Text berechnet statt pro Skill (siehe detectCvSectionHeaders
  // oben) - reine Performance-Optimierung, das Ergebnis ist unabhängig vom
  // einzelnen Skill.
  const cvHeaders = useMemo(() => detectCvSectionHeaders(cvText), [cvText]);
  // Aufklapp-Zustand je Sektion (siehe GAP_SKILL_PREVIEW_LIMIT oben) — zwei
  // getrennte Flags, damit "Vorhanden" und "Noch zu lernen" unabhängig
  // voneinander auf-/zugeklappt werden können.
  const [showAllCovered, setShowAllCovered] = useState(false);
  const [showAllGap, setShowAllGap] = useState(false);
  const visibleCoveredSkills = showAllCovered
    ? gapResult.covered_skills
    : gapResult.covered_skills.slice(0, GAP_SKILL_PREVIEW_LIMIT);
  const visibleGapSkills = showAllGap ? gapResult.gap_skills : gapResult.gap_skills.slice(0, GAP_SKILL_PREVIEW_LIMIT);
  return (
    <div>
      <JourneyStepHeading
        step="07"
        kicker="DEIN MATCH"
        title="Was passt schon — und was bringt dich noch weiter?"
        description="Wir zeigen dir transparent, welche Skills bereits vorhanden sind und welche Lernfelder sich für deinen nächsten Schritt ergeben."
        className="journey-step-heading-gap"
      />
      <div className="gap-summary" style={{ alignItems: "stretch" }}>
        <MatchRing percent={gapResult.match_percentage} />
        <div
          style={{
            minWidth: "118px",
            padding: "14px 16px",
            borderRadius: "18px",
            background: "linear-gradient(135deg, rgba(95,220,153,.12), rgba(47,143,214,.08))",
            border: "1px solid var(--border-soft)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "30px", fontWeight: 850, lineHeight: 1 }}>{coveredCount}</div>
          <div style={{ fontSize: "12px", fontWeight: 700, marginTop: "6px", opacity: 0.7 }}>
            Skills bringst du mit
          </div>
        </div>
        <div className="gap-summary-text">
          <div className="gap-summary-headline">
            Dein Profil für <b>{gapResult.target_role_name}</b> ist klar.
          </div>
          <div className="gap-summary-sub">
            {gapCount > 0 ? (
              <>
                Wir haben <b>{gapCount} Skills</b> identifiziert, die du gezielt weiterentwickeln kannst.
                {goalLabel && <> Das passt zu deinem Ziel „<b>{goalLabel}</b>".</>}
              </>
            ) : (
              <>Du bringst bereits die relevanten Skills mit. Eine Weiterbildung kann dein Profil gezielt vertiefen.</>
            )}
          </div>
        </div>
      </div>
      <div className="gap-method-note">
        <span className="gap-method-icon" aria-hidden="true">ℹ️</span>
        <span>
          So kommt diese Einschätzung zustande: Zuerst gleichen wir deine Angaben automatisch mit den typischen
          Anforderungen für <b>{gapResult.target_role_name}</b> ab.{" "}
          {method === "cv"
            ? "Parallel liest eine KI deinen Text im Detail und prüft für jeden Skill einzeln, ob sich ein echter Beleg findet."
            : "Im interaktiven Skill-Check zählt direkt, was du selbst als bereits vorhanden bestätigt hast."}{" "}
          Bei jedem Skill unten siehst du eine kurze Begründung, und bei „Vorhanden"-Skills kannst du dein eigenes
          Erfahrungslevel angeben. Stimmt etwas nicht? Du kannst jeden Skill unten auch manuell entfernen oder
          hinzufügen.
        </span>
      </div>
      {(depthBusy || depthOverallAssessment) && (
        <div className="gap-ai-summary">
          <div className="gap-ai-summary-head">
            <span className="gap-ai-summary-icon" aria-hidden="true">🧭</span>
            <div className="gap-ai-summary-title">Experten-Einschätzung</div>
          </div>
          {depthOverallAssessment ? (
            <div className="gap-ai-summary-text">{depthOverallAssessment}</div>
          ) : (
            <div className="gap-ai-summary-text muted">
              Die KI-Tiefenanalyse liest deinen Lebenslauf gerade im Detail und erstellt eine ausführliche
              Einschätzung …
            </div>
          )}
          <div className="gap-ai-summary-caption">
            {(() => {
              // Kleine, ehrliche Kennzahl statt Marketing-Floskel: zählt nur,
              // was die Tiefenanalyse tatsächlich zurückgemeldet hat (siehe
              // evidence_type in orbit.ts) - keine erfundenen Zahlen.
              const assessed = [...depthByUri.values()];
              const direct = assessed.filter((d) => d.evidence_type === "direkt").length;
              const transferred = assessed.filter((d) => d.evidence_type === "transferierbar").length;
              const base = `Kombiniert einen schnellen Abgleich mit den Anforderungen von ${gapResult.target_role_name} und eine KI-Tiefenanalyse deines Lebenslaufs.`;
              if (!assessed.length) return base;
              const parts: string[] = [];
              if (direct > 0) parts.push(`${direct} direkt bestätigt`);
              if (transferred > 0) parts.push(`${transferred} durch übertragbare Erfahrung erkannt`);
              return parts.length ? `${base} ${parts.join(", ")}.` : base;
            })()}
          </div>
        </div>
      )}
      <label className="field-label gap-section-label covered">
        <span className="gap-section-dot" aria-hidden="true" /> Vorhanden ({coveredCount})
      </label>
      <div className="skill-detail-list">
        {coveredCount ? (
          visibleCoveredSkills.map((s) => {
            const imp = skillImportance(s.weight);
            const depth = depthByUri.get(s.esco_uri);
            const isManual = manualSkillUris.has(s.esco_uri);
            // Begründung + Belegzitat jetzt SICHTBAR in der Skill-Detail-
            // Karte statt (wie vorher) nur im Hover-Tooltip versteckt - siehe
            // skillReasonInfo() oben (manuelle Korrektur > KI-Tiefenanalyse >
            // konkreter Fundort im Lebenslauftext > generischer Fallback).
            // evidence_type entscheidet zwischen "direkt" und
            // "transferierbar" (Icon + Beschriftung).
            const isTransferred = depth?.evidence_type === "transferierbar";
            const reason = skillReasonInfo(true, s, depth, depthBusy, method, cvText, cvHeaders, isManual);
            // Eigene Erfahrungslevel-Wahl: eine bereits getroffene, bewusste
            // Auswahl der Person (selfLevelByUri) hat immer Vorrang vor dem
            // KI-Vorschlag (depth.proficiency_level) - der dient nur als
            // Vorbelegung, solange die Person noch nichts Eigenes gewählt hat
            // (siehe Kommentar an selfLevelByUri in JourneyPage). Ohne beides
            // ein neutraler Startwert ("Grundkenntnisse" — die vorsichtigste
            // Annahme), NIE unausgefüllt.
            const selectedLevel: ProficiencyLevel =
              selfLevelByUri.get(s.esco_uri) ?? depth?.proficiency_level ?? "grundkenntnisse";
            return (
              <div className="skill-detail-card" key={s.esco_uri}>
                <div className="skill-detail-head">
                  <span className="chip-icon" aria-hidden="true">✓</span>
                  <span className="skill-detail-name">{s.preferred_label}</span>
                  <span className={`skill-weight-badge ${imp.cls}`}>{imp.label}</span>
                  {!isManual && depth?.evidence_quote && (
                    <span
                      className="chip-icon"
                      aria-hidden="true"
                      title={
                        isTransferred
                          ? "Von der KI-Tiefenanalyse als übertragbare Erfahrung erkannt"
                          : "Von der KI-Tiefenanalyse mit Zitat bestätigt"
                      }
                    >
                      {isTransferred ? "🔗" : "🔍"}
                    </span>
                  )}
                  <button
                    type="button"
                    className="skill-detail-remove-btn"
                    onClick={() => onMoveSkill(s.esco_uri, false)}
                    title="Diesen Skill entfernen — zählt dann wieder als Lücke"
                  >
                    ✕ Entfernen
                  </button>
                </div>
                <div className="skill-detail-reason">{reason.text}</div>
                {reason.quote && <div className="skill-detail-quote">„{reason.quote}"</div>}
                <div className="skill-level-picker">
                  <span className="skill-level-picker-label">Mein Erfahrungslevel:</span>
                  {LEVEL_OPTIONS.map((opt) => (
                    <button
                      type="button"
                      key={opt.key}
                      className={`skill-level-pill level-${opt.key} ${
                        selectedLevel === opt.key ? "selected" : ""
                      }`}
                      onClick={() => onSetSelfLevel(s.esco_uri, opt.key)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <div className="hint">Noch keine deiner Angaben deckt einen Kern-Skill dieser Rolle ab.</div>
        )}
      </div>
      {coveredCount > GAP_SKILL_PREVIEW_LIMIT && (
        <button type="button" className="skill-list-expand-btn" onClick={() => setShowAllCovered((v) => !v)}>
          {showAllCovered ? "▲ Weniger anzeigen" : `▼ ${coveredCount - GAP_SKILL_PREVIEW_LIMIT} weitere anzeigen`}
        </button>
      )}
      <label className="field-label gap-section-label gap" style={{ marginTop: "18px" }}>
        <span className="gap-section-dot" aria-hidden="true" /> Noch zu lernen ({gapCount})
      </label>
      <div className="skill-detail-list">
        {gapCount ? (
          visibleGapSkills.map((s) => {
            const imp = skillImportance(s.weight);
            const depth = depthByUri.get(s.esco_uri);
            const isManual = manualSkillUris.has(s.esco_uri);
            // Seit Version 29 (refineGapWithDepthAnalysis) werden Skills mit
            // hoher/mittlerer KI-Konfidenz bereits VORHER automatisch nach
            // "Vorhanden" verschoben (siehe dortigen Kommentar) - ein Skill
            // taucht hier also nur noch MIT depth?.evidence_found auf, wenn
            // die Tiefenanalyse einen Beleg fand, sich aber selbst nicht
            // sicher genug war (Konfidenz "niedrig"), um die schnelle
            // Fuzzy-Einstufung zu ueberschreiben - deshalb bewusst nur als
            // Hinweis sichtbar, nicht als automatische Umeinordnung.
            const reason = skillReasonInfo(false, s, depth, depthBusy, method, cvText, cvHeaders, isManual);
            return (
              <div className="skill-detail-card gap" key={s.esco_uri}>
                <div className="skill-detail-head">
                  <span className="chip-icon" aria-hidden="true">+</span>
                  <span className="skill-detail-name">{s.preferred_label}</span>
                  <span className={`skill-weight-badge ${imp.cls}`}>{imp.label}</span>
                  {!isManual && depth?.evidence_found && (
                    <span
                      className="chip-icon"
                      aria-hidden="true"
                      title="KI-Tiefenanalyse fand evtl. doch einen Beleg"
                    >
                      ❓
                    </span>
                  )}
                </div>
                <div className="skill-detail-reason">{reason.text}</div>
                {reason.quote && (
                  <div className="skill-detail-quote">
                    {depth?.evidence_found && !isManual ? "Unsicherer Hinweis: " : ""}„{reason.quote}"
                  </div>
                )}
                <button
                  type="button"
                  className="skill-detail-add-btn"
                  onClick={() => onMoveSkill(s.esco_uri, true)}
                  title="Diesen Skill als vorhanden markieren"
                >
                  + Als vorhanden markieren
                </button>
              </div>
            );
          })
        ) : (
          <div className="hint">Keine Lücke — starke Passung!</div>
        )}
      </div>
      {gapCount > GAP_SKILL_PREVIEW_LIMIT && (
        <button type="button" className="skill-list-expand-btn" onClick={() => setShowAllGap((v) => !v)}>
          {showAllGap ? "▲ Weniger anzeigen" : `▼ ${gapCount - GAP_SKILL_PREVIEW_LIMIT} weitere anzeigen`}
        </button>
      )}
      {error && (
        <div className="status-line err" aria-live="polite">
          {error}
        </div>
      )}
      {earlyLeadSaved ? (
        <div className="early-capture-saved">
          <span aria-hidden="true">✓</span> Ergebnis gesichert — dein Bildungsträger kann sich bei{" "}
          <b>{leadEmail.trim()}</b> melden, auch falls du die Seite jetzt verlässt.
        </div>
      ) : (
        <div className="early-capture-card">
          <div className="early-capture-head">
            <span className="early-capture-icon" aria-hidden="true">💾</span>
            <div>
              <div className="early-capture-title">Ergebnis per E-Mail sichern</div>
              <div className="early-capture-sub">
                Falls du gerade nicht weitermachen kannst: Wir merken uns dein Ergebnis, dein Bildungsträger kann sich
                trotzdem bei dir melden.
              </div>
            </div>
          </div>
          <div className="early-capture-row">
            <div className="input-wrap">
              <input
                className="big-input"
                type="email"
                placeholder="deine@email.de"
                aria-label="Deine E-Mail-Adresse für die Zwischenspeicherung"
                value={leadEmail}
                onChange={(e) => setLeadEmail(e.target.value)}
              />
              {earlyEmailValid && (
                <span className="input-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </div>
            <button
              type="button"
              className={`early-capture-btn ${earlyCaptureBusy ? "loading" : ""}`}
              onClick={onSaveEarly}
              disabled={earlyCaptureBusy}
            >
              {earlyCaptureBusy ? <span className="btn-spinner" aria-hidden="true" /> : "Sichern"}
            </button>
          </div>
          <label className="early-capture-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            Ich stimme der DSGVO-konformen Speicherung meiner Angaben zu.
          </label>
          {earlyCaptureError && (
            <div className="status-line err" aria-live="polite">
              {earlyCaptureError}
            </div>
          )}
        </div>
      )}
      <ActionsRow
        onBack={onBack}
        forwardLabel={busy ? "Suche Kurse…" : "Kursempfehlung ansehen →"}
        onForward={onForward}
        forwardDisabled={busy}
        busy={busy}
      />
    </div>
  );
}
/** Eigenständige, visuell auffällige Auswahl-Karte (Version 17, seit Version
 * 24 verallgemeinert von "StartDateCard" auf beliebige Chip-Fragen) — statt
 * eines schmalen Feld-Labels eine klar abgesetzte Karte mit Icon/Unterzeile,
 * ohne die Frage zur Pflicht zu machen: bleibt immer optional, wirkt aber wie
 * ein echter, hilfreicher Schritt statt wie eine leicht übersehbare
 * Kleinigkeit. Wird im neuen "Präferenzen"-Schritt (PraeferenzenStep) dreimal
 * verwendet — Beschäftigungsart, Arbeitsort, Startzeitpunkt. */
function OptionCard({
  icon,
  title,
  sub,
  options,
  selected,
  onSelect,
}: {
  icon: string;
  title: string;
  sub: string;
  options: { key: string; label: string }[];
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  return (
    <div className="start-date-card">
      <div className="start-date-card-head">
        <span className="start-date-icon" aria-hidden="true">
          {icon}
        </span>
        <div>
          <div className="start-date-title">{title}</div>
          <div className="start-date-sub">{sub}</div>
        </div>
      </div>
      <div className="start-option-row">
        {options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            className={`start-chip ${selected === opt.key ? "selected" : ""}`}
            onClick={() => onSelect(selected === opt.key ? null : opt.key)}
          >
            {selected === opt.key && (
              <span className="start-chip-check" aria-hidden="true">
                ✓
              </span>
            )}
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
/** Neuer "Präferenzen"-Schritt (Version 24), direkt nach dem Ziel-Schritt und
 * vor "Bereich"/"Zielrolle" — auf ausdrücklichen Wunsch nicht mehr erst ganz
 * am Ende im Kurs-Schritt versteckt (siehe frühere StartDateCard-Platzierung
 * dort). Bündelt drei unabhängige, jeweils optionale Qualifizierungsmerkmale:
 * Beschäftigungsart, gewünschter Arbeitsort und Startzeitpunkt. Alle drei
 * sind reine Zusatzinformationen für den Bildungsträger im Dashboard — kein
 * Pflichtfeld, deshalb funktioniert "Weiter" immer, unabhängig von der
 * Auswahl (kein separater Skip-Link nötig). */
function PraeferenzenStep({
  employmentType,
  onSelectEmploymentType,
  workLocation,
  onSelectWorkLocation,
  desiredStart,
  onSelectStart,
  fundingPreference,
  onSelectFunding,
  categoryPreference,
  onSelectCategory,
  categoryOptions,
  desiredDuration,
  onSelectDuration,
  qualificationLevel,
  onSelectQualification,
  experienceYears,
  onSelectExperience,
  germanLevel,
  onSelectGermanLevel,
  onForward,
  onBack,
}: {
  employmentType: string | null;
  onSelectEmploymentType: (key: string | null) => void;
  workLocation: string | null;
  onSelectWorkLocation: (key: string | null) => void;
  desiredStart: string | null;
  onSelectStart: (key: string | null) => void;
  fundingPreference: string | null;
  onSelectFunding: (key: string | null) => void;
  categoryPreference: string | null;
  onSelectCategory: (key: string | null) => void;
  /** Auf den Kurskatalog des Tenants gefiltert (categoryOptionsInPortfolio
   *  in JourneyPage, 17.09.) — Kategorien ohne einen einzigen Kurs im
   *  Katalog erscheinen hier gar nicht erst als Button. */
  categoryOptions: { key: string; label: string }[];
  desiredDuration: string | null;
  onSelectDuration: (key: string | null) => void;
  /** Voraussetzungs-Auskunft (Version 34, 22.09.) — siehe
   *  QUALIFICATION_OPTIONS/EXPERIENCE_OPTIONS/LANGUAGE_LEVEL_OPTIONS oben
   *  und checkPrerequisites() in courseMatcher.ts. */
  qualificationLevel: string | null;
  onSelectQualification: (key: string | null) => void;
  experienceYears: number | null;
  onSelectExperience: (years: number | null) => void;
  germanLevel: string | null;
  onSelectGermanLevel: (level: string | null) => void;
  onForward: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <JourneyStepHeading
        step="03"
        kicker="DEIN ALLTAG"
        title="Was muss zu deinem Alltag passen?"
        description="Optional – deine Angaben helfen uns, die Empfehlung besser auf deinen Alltag abzustimmen."
      />
      <OptionCard
        icon="💼"
        title="Vollzeit oder Teilzeit?"
        sub="Optional — hilft deinem Bildungsträger, dir passende Kurstermine und Kohorten vorzuschlagen."
        options={EMPLOYMENT_OPTIONS}
        selected={employmentType}
        onSelect={onSelectEmploymentType}
      />
      <OptionCard
        icon="📍"
        title="Remote oder vor Ort?"
        sub="Optional — sagt deinem Bildungsträger, welches Kursformat für dich in Frage kommt."
        options={LOCATION_OPTIONS}
        selected={workLocation}
        onSelect={onSelectWorkLocation}
      />
      <OptionCard
        icon="📅"
        title="Wann möchtest du starten?"
        sub="Optional — hilft deinem Bildungsträger, dir direkt den passenden Termin bzw. die passende Kohorte vorzuschlagen."
        options={START_OPTIONS}
        selected={desiredStart}
        onSelect={onSelectStart}
      />
      <OptionCard
        icon="🎓"
        title="Ist dir eine geförderte Weiterbildung wichtig?"
        sub="Optional — z.B. Bildungsgutschein, Aufstiegs-BAföG oder Bildungsurlaub. Wir zeigen dir dann bevorzugt Kurse mit Förderoption."
        options={FUNDING_OPTIONS}
        selected={fundingPreference}
        onSelect={onSelectFunding}
      />
      {categoryOptions.length > 0 && (
        <OptionCard
          icon="📚"
          title="Weißt du schon, was es sein soll?"
          sub="Optional — Zertifikat, Seminar, Weiterbildung oder Studium. Wir zeigen dir dann bevorzugt passende Kurse dieser Art."
          options={categoryOptions}
          selected={categoryPreference}
          onSelect={onSelectCategory}
        />
      )}
      <OptionCard
        icon="⏱️"
        title="Wie viel Zeit möchtest du investieren?"
        sub="Optional — hilft deinem Bildungsträger, dir Kurse mit passender Dauer vorzuschlagen."
        options={DURATION_OPTIONS}
        selected={desiredDuration}
        onSelect={onSelectDuration}
      />
      {/* Voraussetzungs-Auskunft (Version 34, 22.09., "es muss auch auf
          Vorraussetzungen bei den Kursen drauf eingegangen werden") — drei
          weitere, ebenfalls optionale Karten. Fließen NIE als Ausschluss ein
          (siehe checkPrerequisites() in courseMatcher.ts), nur als
          zusätzlicher Hinweis, welcher Kurs am besten zur eigenen Vorbildung
          passt. */}
      <OptionCard
        icon="🎓"
        title="Welche Vorbildung bringst du mit?"
        sub="Optional — manche Kurse setzen eine Ausbildung oder ein Studium voraus. So zeigen wir dir bevorzugt Kurse, die du auch wirklich starten kannst."
        options={QUALIFICATION_OPTIONS}
        selected={qualificationLevel}
        onSelect={onSelectQualification}
      />
      <OptionCard
        icon="💡"
        title="Wie viel Berufserfahrung hast du?"
        sub="Optional — manche Kurse setzen einschlägige Berufserfahrung voraus."
        options={EXPERIENCE_OPTIONS}
        selected={EXPERIENCE_OPTIONS.find((o) => o.years === experienceYears)?.key ?? null}
        onSelect={(key) => onSelectExperience(key ? EXPERIENCE_OPTIONS.find((o) => o.key === key)?.years ?? null : null)}
      />
      <OptionCard
        icon="🗣️"
        title="Wie gut sind deine Deutschkenntnisse?"
        sub="Optional — manche Kurse setzen ein bestimmtes Sprachniveau voraus."
        options={LANGUAGE_LEVEL_OPTIONS}
        selected={LANGUAGE_LEVEL_OPTIONS.find((o) => o.level === germanLevel)?.key ?? null}
        onSelect={(key) => onSelectGermanLevel(key ? LANGUAGE_LEVEL_OPTIONS.find((o) => o.key === key)?.level ?? null : null)}
      />
      <ActionsRow onBack={onBack} forwardLabel="Weiter →" onForward={onForward} />
    </div>
  );
}
// CourseBadge/courseBadges/CourseBadgeRow: siehe src/data/courseBadges.tsx
// (geteilt mit DashboardPage.tsx, das dieselbe Logik für den Banner-
// Quick-Picker auf jeder Kurskachel im Kurskatalog braucht).
/** Formatiert starts_at (ISO, siehe Kommentar an CourseCatalogEntry in
 *  courseMatcher.ts) als kurzes, lesbares Datum (z.B. "12. Okt.") — als
 *  reine Tatsache an der Kurskarte, wenn die Person im "Präferenzen"-Schritt
 *  einen gewünschten Starttermin genannt hat (siehe KursStep unten). Robust
 *  gegen fehlende/ungültige Werte, gleiches Muster wie formatLeadDate in
 *  DashboardPage.tsx. */
function formatCourseStartDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
}
function KursStep({
  courseResult,
  targetRoleName,
  bereichLabel,
  gapSkillLabels,
  gapSkills,
  coveredSkills,
  featuredCourses,
  allCourses,
  courseCatalogLoading,
  courseCatalogError,
  careerGoal,
  selectedCourseId,
  onSelectCourse,
  additionalCourseIds,
  onToggleAdditional,
  employmentType,
  workLocation,
  desiredStart,
  fundingPreference,
  categoryPreference,
  desiredDuration,
  qualificationLevel,
  experienceYears,
  germanLevel,
  goalLabel,
  leadName,
  setLeadName,
  leadEmail,
  setLeadEmail,
  leadPhone,
  setLeadPhone,
  leadMessage,
  setLeadMessage,
  consent,
  setConsent,
  leadBusy,
  leadError,
  onSubmitLead,
  desiredStartLabel,
  employmentTypeLabel,
  workLocationLabel,
  wantsConsultation,
  setWantsConsultation,
  privacyPolicyUrl,
  onBack,
}: {
  courseResult: CourseMatchResponse | null;
  targetRoleName: string | null;
  /** Echtes bereich_label der aktuellen Zielrolle (siehe targetBereichLabel
   *  in JourneyPage) — fuer den kombinierten Ziel+Bereich-Pitch je Kurskarte
   *  (15.09., "ich will, dass man sein Ziel mit den Bereichen verbindet und
   *  auf dieser Basis dann die Vorschläge der Weiterbildungen bekommt").
   *  null, wenn (noch) keine Zielrolle/Bereichs-Rolle aktiv ist. */
  bereichLabel: string | null;
  gapSkillLabels: string[];
  /** Dieselben Gap-Skills wie gapSkillLabels, aber mit esco_uri statt nur als
   *  Label-String (Version 29) — nötig, um pro Kurskarte exakt zu bestimmen,
   *  WELCHE deiner offenen Skills genau DIESER Kurs abdeckt (siehe
   *  buildCoursePitch UND course-hero-reveal, das dieselbe Zuordnung für die
   *  jeweils ausgewählte Karte nutzt). */
  gapSkills: RoleSkillStatus[];
  /** Bereits vorhandene Skills der Zielrolle (gapResult.covered_skills) —
   *  nur für den Fallback-Fall in buildCoursePitch gebraucht (Kurs deckt
   *  keine aktuelle Lücke, aber zentrale Rollen-Skills insgesamt ab). */
  coveredSkills: RoleSkillStatus[];
  featuredCourses: OrbitCourse[];
  /** Status des echten Kurskatalog-Requests in JourneyPage. Diese Werte werden
   * bewusst als Props gereicht, damit KursStep niemals auf State zugreift,
   * der nur im Eltern-Scope existiert. */
  courseCatalogLoading: boolean;
  courseCatalogError: string | null;
  /** Kompletter Kurskatalog (Version 20, siehe allCourses in JourneyPage) —
   * nur gebraucht, um location_mode für goalFitReason("sicherheit") nachzuschlagen. */
  allCourses: OrbitCourse[];
  /** Rohschlüssel des im Ziel-Schritt gewählten Beweggrunds (siehe
   * GOAL_OPTIONS) — für goalFitReason, getrennt vom bereits vorhandenen
   * ausformulierten goalLabel weiter unten. */
  careerGoal: string | null;
  selectedCourseId: string | null;
  onSelectCourse: (courseId: string) => void;
  /** Zusätzlich markierte Kurse (Version 19, siehe additionalCourseIds in
   * JourneyPage) — werden über eine eigene "Auch anfragen"-Checkbox an den
   * Kurskarten gesetzt, unabhängig vom per Klick gewählten Favoriten. */
  additionalCourseIds: Set<string>;
  onToggleAdditional: (courseId: string) => void;
  /** Im "Präferenzen"-Schritt gewählte Beschäftigungsart/Arbeitsort/
   * gewünschter Starttermin (Version 25, erweitert um desiredStart in
   * Version 31, siehe PraeferenzenStep) — für die Präferenzen-Zusammenfassung
   * oben in diesem Schritt und den sichtbaren Passgenauigkeits-Hinweis an
   * jeder Kurskarte; die eigentliche Sortierung passiert bereits serverseitig/
   * in matchCoursesToGap (siehe goToKurs), das dieselben drei Werte nutzt. */
  employmentType: string | null;
  workLocation: string | null;
  desiredStart: string | null;
  /** Förderungs-Präferenz aus dem "Präferenzen"-Schritt (Version 32/33, siehe
   *  FUNDING_OPTIONS/PraeferenzenStep) — analog zu employmentType/
   *  workLocation/desiredStart oben: fließt in die Präferenzen-Zusammenfassung
   *  und den Passgenauigkeits-Hinweis je Kurskarte ein. */
  fundingPreference: string | null;
  /** Einkategorisierung/gewünschte Dauer aus dem "Präferenzen"-Schritt
   *  (Version 28/17.09., siehe CATEGORY_OPTIONS/DURATION_OPTIONS/
   *  PraeferenzenStep) — gleiches Muster wie die vier Felder oben. */
  categoryPreference: string | null;
  desiredDuration: string | null;
  /** Voraussetzungs-Auskunft aus dem "Präferenzen"-Schritt (Version 34,
   *  22.09., siehe QUALIFICATION_OPTIONS/EXPERIENCE_OPTIONS/
   *  LANGUAGE_LEVEL_OPTIONS/PraeferenzenStep) — nur für die Präferenzen-
   *  Zusammenfassung hier; der eigentliche Voraussetzungs-Abgleich pro
   *  Kurskarte kommt bereits fertig berechnet über prerequisite_status/
   *  prerequisite_unmet an jedem CourseRecommendation aus courseResult
   *  (siehe checkPrerequisites() in courseMatcher.ts). */
  qualificationLevel: string | null;
  experienceYears: number | null;
  germanLevel: string | null;
  /** Label des im Ziel-Schritt gewählten Beweggrunds (siehe GOAL_OPTIONS),
   * fließt in den personalisierten Pitch ein — undefined, wenn übersprungen. */
  goalLabel?: string;
  leadName: string;
  setLeadName: (v: string) => void;
  leadEmail: string;
  setLeadEmail: (v: string) => void;
  leadPhone: string;
  setLeadPhone: (v: string) => void;
  leadMessage: string;
  setLeadMessage: (v: string) => void;
  consent: boolean;
  setConsent: (v: boolean) => void;
  leadBusy: boolean;
  leadError: string | null;
  onSubmitLead: (intent: "start" | "info" | "consultation") => void;
  desiredStartLabel?: string;
  employmentTypeLabel?: string;
  workLocationLabel?: string;
  wantsConsultation: boolean;
  setWantsConsultation: (v: boolean) => void;
  privacyPolicyUrl?: string;
  onBack: () => void;
}) {
  // Auch im Ergebnis-Schritt niemals auf einen undefinierten Katalog zugreifen.
  const courseCatalog: OrbitCourse[] = Array.isArray(allCourses) ? allCourses : [];
  // Die Namen der zusätzlich angefragten Kurse werden innerhalb von KursStep
  // aufgebaut. Sie dürfen hier nicht aus dem äußeren JourneyPage-Scope kommen.
  const allCourseById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of courseResult?.recommended_courses ?? []) map.set(c.course_id, c.course_name);
    for (const c of featuredCourses) map.set(c.course_id, c.course_name);
    return map;
  }, [courseResult, featuredCourses]);

  const additionalCourseNames = useMemo(
    () =>
      Array.from(additionalCourseIds)
        .filter((id) => id !== selectedCourseId)
        .map((id) => allCourseById.get(id))
        .filter((n): n is string => Boolean(n)),
    [additionalCourseIds, selectedCourseId, allCourseById]
  );
  const courses = courseResult?.recommended_courses ?? [];
  const showCourseSystemStatus =
    courseCatalogLoading || Boolean(courseCatalogError);
  const top = courses[0];
  // CourseRecommendation (aus courseResult) führt keine Banner-Felder — für
  // die Badges (siehe courseBadges/CourseBadgeRow oben) über die vollständige
  // Kursakte aus allCourses nachschlagen.
  const courseById = (id: string) => courseCatalog.find((c) => c.course_id === id);
  // "Mehr erfahren" (15.09., Rückmeldung "auf der letzten Seite auch auf die
  // verschiedenen Weiterbildungen klicken kann und dann nochmal mehr
  // Informationen sehen ... aber Kosten etc. die Rahmendaten müssen immer
  // präsent vorne stehen") — ein Klick auf die ganze Karte wählt sie bereits
  // als Favorit (onSelectCourse), daher hier ein eigener, per
  // stopPropagation getrennter Button, der NUR die volle Kursbeschreibung
  // ein-/ausklappt. Preis/UE/Förderung/Abschluss (course-hero-facts) bleiben
  // davon unberührt immer sichtbar, unabhängig vom Auf-/Zuklappen.
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);

  // Version 34 — motivational transition after the Skill-Gap analysis.
  // The popup is intentionally local to KursStep: it appears exactly when
  // the existing Journey advances from Skill-Gap to the recommendation step.
  const [showRecommendationIntro, setShowRecommendationIntro] = useState(true);
  const currentMatch = courseResult?.match_percentage ?? 0;
  const role = targetRoleName || "deiner Zielrolle";
  // Was tatsächlich als "meine Wahl" in Pitch/Anfrage einfließt: die aktive
  // Auswahl, falls getroffen — sonst die algorithmische Bestempfehlung.
  const selected = courses.find((c) => c.course_id === selectedCourseId) ?? top;
  // Beliebte Kurse unten anzeigen, aber keine Dopplung zu dem, was oben schon
  // individuell empfohlen wurde.
  // Neufassung (15.09., Rückmeldung "unten auch alle anderen Kurse mit
  // Banner oder startet innerhalb 1 Monats und das schön getrennt"): statt
  // eines einzigen, undifferenzierten "Rang 4+ oder featured"-Topfs jetzt
  // zwei klar benannte, getrennte Gruppen aus dem VOLLEN Katalog (allCourses,
  // nicht nur den von rankCoursesForGap sortierten Treffern) — jede reale
  // Kurse, nichts erfunden: (1) startet innerhalb der naechsten 30 Tage
  // (echtes starts_at), (2) hat einen echten Banner (is_featured im
  // Dashboard gesetzt, oder ein custom_banner-Text). Ein Kurs erscheint nur
  // in EINER Gruppe (zuerst "startet bald" geprüft), Überschneidung mit den
  // oben schon gezeigten Top-3 ausgeschlossen.
  const shownCourseIds = new Set(courses.slice(0, 3).map((c) => c.course_id));
  const remainingCourses = courseCatalog.filter((c) => !shownCourseIds.has(c.course_id));
  const soonStartingCourses = remainingCourses
    .filter((c) => {
      const days = daysUntilCourseStart(c);
      return days != null && days >= 0 && days <= POPULAR_SOON_START_DAYS;
    })
    .sort((a, b) => (daysUntilCourseStart(a) ?? 0) - (daysUntilCourseStart(b) ?? 0));
  const soonStartingIds = new Set(soonStartingCourses.map((c) => c.course_id));
  const bannerCourses = remainingCourses.filter(
    (c) => !soonStartingIds.has(c.course_id) && (c.is_featured || Boolean(c.custom_banner))
  );
  // Rückmeldung 17.09. ("die Kurse sollen im Vordergrund stehen … die
  // anderen Kurse sollen rotieren und dort präsent präsentiert werden"):
  // vorher standen soonStartingCourses/bannerCourses als zwei lange,
  // statische Grids GANZ unten, nach dem kompletten Kontaktformular — das
  // zog die Seite unnötig in die Länge, ohne dass die weiteren Kurse
  // wirklich auffielen. Jetzt EIN kombiniertes, automatisch rotierendes
  // Karussell direkt nach der Hauptempfehlung, vor dem Kontaktformular (das
  // damit klar der erkennbare letzte Schritt bleibt). CourseBadgeRow leitet
  // ihr Badge weiterhin pro Kurs aus echten Datenfeldern ab (siehe
  // courseBadges.tsx), die Unterscheidung "startet bald" vs. "Banner" geht
  // beim Zusammenlegen also nicht verloren.
  const popularCourses = [...soonStartingCourses, ...bannerCourses];
  const [popularIndex, setPopularIndex] = useState(0);
  const [carouselPaused, setCarouselPaused] = useState(false);
  const safePopularIndex = popularCourses.length > 0 ? popularIndex % popularCourses.length : 0;
  useEffect(() => {
    if (popularCourses.length <= 1 || carouselPaused) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setPopularIndex((i) => (i + 1) % popularCourses.length);
    }, 6000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popularCourses.length, carouselPaused]);
  // Präferenzen-Zusammenfassung (14.09., "soll auch als Zusammenfassung
  // angezeigt werden") — nur die tatsächlich beantworteten Fragen aus dem
  // "Präferenzen"-Schritt, in derselben Reihenfolge wie dort gefragt. "egal"/
  // "offen" werden bewusst MIT angezeigt (die Person hat aktiv geantwortet,
  // nur eben ohne Präferenz) — nur komplett übersprungene Fragen (null)
  // fehlen hier ganz.
  const preferenceSummaryParts = [
    employmentType && EMPLOYMENT_OPTIONS.find((o) => o.key === employmentType)?.label,
    workLocation && LOCATION_OPTIONS.find((o) => o.key === workLocation)?.label,
    desiredStart && START_OPTIONS.find((o) => o.key === desiredStart)?.label,
    fundingPreference && FUNDING_OPTIONS.find((o) => o.key === fundingPreference)?.label,
    categoryPreference && CATEGORY_OPTIONS.find((o) => o.key === categoryPreference)?.label,
    desiredDuration && DURATION_OPTIONS.find((o) => o.key === desiredDuration)?.label,
    qualificationLevel && QUALIFICATION_OPTIONS.find((o) => o.key === qualificationLevel)?.label,
    experienceYears != null && EXPERIENCE_OPTIONS.find((o) => o.years === experienceYears)?.label,
    germanLevel && LANGUAGE_LEVEL_OPTIONS.find((o) => o.level === germanLevel)?.label,
  ].filter((part): part is string => Boolean(part));
  // Eine Karte, wiederverwendet für beide "weitere Kurse"-Gruppen unten
  // (soonStartingCourses/bannerCourses) — exakt dieselbe Darstellung wie
  // zuvor, nur nicht mehr zweimal dupliziert.
  // Redesign (Rückmeldung 17.09., "in einer besseren Darstellung ... Kosten
  // Dauer in einem einheitlichen Format ... auch die Beschreibung soll
  // sichtbar bzw. ausklappbar sein"): dieselben Format-Helper wie auf der
  // Hauptkarte (formatCourseDuration/formatCoursePrice) statt eigener,
  // abweichender Kurzformate, und dieselben Rahmendaten-Facts (Ort, Niveau,
  // Förderung, Start) statt nur Preis/Förderung — vorher hatte diese Kachel
  // spürbar weniger Informationsgehalt als die Hauptkarte, obwohl dieselben
  // Katalogdaten vorliegen. Die Beschreibung bekommt eine eigene, benannte
  // Sektion ("Beschreibung"), damit sie nicht mehr wie ein beiläufiger
  // Fließtext unter den Fakten wirkt.
  const renderPopularCard = (c: OrbitCourse) => {
    const isAlsoRequested = additionalCourseIds.has(c.course_id);
    return (
      <div className={`popular-course-card ${isAlsoRequested ? "selected" : ""}`} key={c.course_id}>
        <CourseBadgeRow course={c} alwaysShow />
        <BereichBadges course={c} />
        <div className="popular-course-name">{c.course_name}</div>
        <div className="popular-course-meta">
          {c.provider} · {formatCourseDuration(c)}
        </div>
        {/* Rückmeldung 17.09. ("es sollen immer die Daten sichtbar sein und
            wenn keine Hinterlegt worden sind, dann soll auf Anfrage
            kommen"): dieselben fünf immer sichtbaren Rahmendaten-Pillen wie
            auf der Hauptkarte (course-hero-facts), inkl. "auf Anfrage" bei
            fehlendem Wert — Ort ist deshalb hier raus aus der Meta-Zeile und
            unten mit dabei, statt dort separat (und nur bei vorhandenem
            Wert) zu stehen. */}
        <div className="popular-course-facts">
          <span className="course-hero-fact">{courseLocationText(c)}</span>
          <span className="course-hero-fact">💶 {courseCostText(c)}</span>
          <span className="course-hero-fact">🎓 {courseQualificationText(c)}</span>
          <span
            className={`course-hero-fact ${c.funding_types && c.funding_types.length > 0 ? "course-hero-fact-funding" : ""}`}
            title={c.funding_types && c.funding_types.length > 0 ? c.funding_types.map((f) => FUNDING_TYPE_LABELS[f] ?? f).join(", ") : undefined}
          >
            💰 {courseFundingText(c)}
          </span>
          <span className="course-hero-fact">📅 Start {courseStartText(c)}</span>
        </div>
        {(() => {
          const descTrimmed = c.description?.trim() ?? null;
          const targetGroupTrimmed = c.target_group?.trim() || null;
          if (!descTrimmed && !targetGroupTrimmed) return null;
          const isExpandedPopular = expandedCourseId === c.course_id;
          const preview = descTrimmed ? truncateAtWord(descTrimmed, 90) : null;
          const canExpand = (descTrimmed && descTrimmed.length > (preview?.length ?? 0)) || targetGroupTrimmed;
          return (
            <div className="popular-course-desc-block">
              <div className="popular-course-desc-label">Beschreibung</div>
              {descTrimmed && <div className="popular-course-desc">{isExpandedPopular ? descTrimmed : preview}</div>}
              {isExpandedPopular && targetGroupTrimmed && (
                <div className="popular-course-desc">
                  <b>Zielgruppe:</b> {targetGroupTrimmed}
                </div>
              )}
              {canExpand && (
                <button
                  type="button"
                  className="course-hero-more"
                  onClick={() => setExpandedCourseId(isExpandedPopular ? null : c.course_id)}
                >
                  {isExpandedPopular ? "▴ Weniger anzeigen" : "▾ Mehr erfahren"}
                </button>
              )}
            </div>
          );
        })()}
        <label className="course-hero-also">
          <input type="checkbox" checked={isAlsoRequested} onChange={() => onToggleAdditional(c.course_id)} />
          Auch anfragen
        </label>
      </div>
    );
  };

  return (
    <div className="dyd-kurs-result-wrap">
      {showRecommendationIntro && top && (
        <div
          className="dyd-recommendation-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dyd-recommendation-intro-title"
        >
          <div
            className="dyd-recommendation-backdrop"
            onClick={() => setShowRecommendationIntro(false)}
            aria-hidden="true"
          />
          <div className="dyd-recommendation-modal">
            <button
              type="button"
              className="dyd-recommendation-close"
              aria-label="Hinweis schließen"
              onClick={() => setShowRecommendationIntro(false)}
            >
              ×
            </button>

            <div className="dyd-recommendation-modal-icon" aria-hidden="true">✓</div>
            <div className="dyd-eyebrow">DEIN SKILL-CHECK IST GESCHAFFT</div>
            <h2 id="dyd-recommendation-intro-title">
              Wir haben etwas Passendes für dich gefunden.
            </h2>
            <p className="dyd-recommendation-modal-copy">
              Du hast gerade herausgefunden, welche Lernfelder für deinen nächsten
              beruflichen Schritt noch relevant sind. Jetzt wird es konkret:
              Wir haben daraus deine Weiterbildungsempfehlungen abgeleitet.
            </p>

            <div className="dyd-recommendation-preview">
              <span className="dyd-recommendation-preview-label">DEINE ERSTE EMPFEHLUNG</span>
              <strong>{top.course_name}</strong>
              <span>
                {top.provider}
                {top.duration_weeks ? ` · ${top.duration_weeks} Wochen` : ""}
              </span>
            </div>

            <div className="dyd-recommendation-modal-actions">
              <button
                type="button"
                className="dyd-btn dyd-btn-primary"
                onClick={() => {
                  setShowRecommendationIntro(false);
                  requestAnimationFrame(() => {
                    document.getElementById("dyd-kurs-result")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  });
                }}
              >
                Empfehlung ansehen →
              </button>
              <button
                type="button"
                className="dyd-btn dyd-btn-ghost"
                onClick={() => setShowRecommendationIntro(false)}
              >
                Später ansehen
              </button>
            </div>
          </div>
        </div>
      )}

      {showCourseSystemStatus && (
        <div
          className={`dyd-course-system-status ${
            courseCatalogError ? "is-error" : "is-loading"
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="dyd-course-system-status-icon" aria-hidden="true">
            {courseCatalogLoading ? "◌" : "!"}
          </div>
          <div>
            <strong>
              {courseCatalogLoading
                ? "Wir laden gerade deine Weiterbildungsmöglichkeiten."
                : "Der Kurskatalog ist gerade nicht vollständig erreichbar."}
            </strong>
            <span>
              {courseCatalogLoading
                ? "Danach stellen wir deine persönliche Auswahl zusammen."
                : courseCatalogError}
            </span>
          </div>
        </div>
      )}

      {top ? (
        <>
          <div id="dyd-kurs-result" className="dyd-kurs-result-anchor" />
          {preferenceSummaryParts.length > 0 && (
            <div className="preference-summary">
              <span className="preference-summary-label">Deine Angaben:</span>{" "}
              {preferenceSummaryParts.join(" · ")}
            </div>
          )}
          <JourneyStepHeading
            step="08"
            kicker="DEIN NÄCHSTER SCHRITT"
            title="Deine persönliche Weiterbildung."
            description="Wir verbinden dein Ziel, deine Skills und echte Weiterbildungen aus dem Kurskatalog."
            className="journey-step-heading-course"
          />
          <div className="dyd-course-recommendations">
            <div className="dyd-course-recommendations-intro">
              <span className="dyd-course-recommendations-kicker">DEINE AUSWAHL</span>
              <span>Eine Empfehlung, die du aktiv auswählen kannst — plus Alternativen.</span>
            </div>
            {courses.slice(0, 3).map((course, i) => {
            const isSelected = course.course_id === selectedCourseId;
            const isAlsoRequested = additionalCourseIds.has(course.course_id);
            // Version 25, ab 14.09. um desiredStart erweitert: zeigt
            // Beschäftigungsart/Arbeitsort/Starttermin des Kurses (rein
            // faktisch, aus courseById — keine Behauptung) sowie, NUR wenn die
            // Person im "Präferenzen"-Schritt tatsächlich etwas angegeben hat
            // UND es nicht passt, einen konkret benannten Hinweis (siehe
            // describePreferenceMismatches). Beeinflusst nie die Sichtbarkeit
            // des Kurses, nur diese Zusatzinfo (das eigentliche Sortieren
            // passiert bereits in goToKurs()/matchCoursesToGap).
            const fullCourse = courseById(course.course_id);
            // Konkrete Dimensionen (Beschäftigungsart/Arbeitsort/Starttermin),
            // bei denen dieser Kurs wirklich widerspricht — leer, wenn alles
            // passt oder keine Präferenz genannt wurde. "egal"/"offen" zaehlen
            // dabei bewusst NICHT als Praeferenz (siehe EMPLOYMENT_OPTIONS/
            // LOCATION_OPTIONS/START_OPTIONS oben) — sonst wuerde hier
            // faelschlich ein Widerspruch aufploppen, obwohl die Person
            // ausdruecklich gesagt hat, dass es ihr egal ist bzw. sie es noch
            // nicht weiss (siehe describePreferenceMismatches in
            // courseMatcher.ts).
            const mismatches = fullCourse
              ? describePreferenceMismatches(
                  fullCourse,
                  employmentType,
                  workLocation,
                  desiredStart,
                  fundingPreference,
                  categoryPreference,
                  desiredDuration
                )
              : [];
            // Individueller, inhaltlich verankerter Pitch für GENAU diese
            // Karte (Version 29) — siehe buildCoursePitch oben.
            const pitch = buildCoursePitch(
              course,
              fullCourse,
              gapSkills,
              coveredSkills,
              careerGoal,
              goalLabel,
              targetRoleName,
              bereichLabel,
              courses.slice(0, 3)
            );
            // "Mehr erfahren" (siehe expandedCourseId oben, Rückmeldung
            // "soll man die Informationen sehen, die man im Dashboard
            // eingespeichert hat"): anbieten, wenn entweder die volle
            // Beschreibung länger ist als der bereits gezeigte, gekürzte
            // pitch.descriptionSnippet, oder eine Zielgruppe hinterlegt ist
            // (target_group — bisher nirgends in der Journey sichtbar,
            // obwohl im Dashboard-Kursformular pflegbar).
            const isExpandedDesc = expandedCourseId === course.course_id;
            const fullDescTrimmed = fullCourse?.description?.trim() ?? null;
            const targetGroupTrimmed = fullCourse?.target_group?.trim() || null;
            const hasMoreDesc = Boolean(
              (fullDescTrimmed &&
                pitch.descriptionSnippet &&
                fullDescTrimmed.length > pitch.descriptionSnippet.length) ||
                targetGroupTrimmed
            );
            // Bugfix/Erweiterung (14.09., Rückmeldung "da muss immer ein
            // Vorschlag kommen, obwohl es eigentlich für alles immer Kurse
            // geben sollte zumindest dann die Top Kurse"): rankCoursesForGap()
            // filtert seit diesem Fix keine Kurse mit covers_role_count===0
            // mehr komplett raus (siehe FIX 3/Kommentar in courseMatcher.ts)
            // — ein Kurs kann hier also jetzt auch OHNE jede Skill-Berührung
            // zur Zielrolle auftauchen, damit überhaupt etwas erscheint statt
            // gar nichts. Für DIESEN Fall (isGenericFallback) wäre eine
            // "0%"/"Beste Passung"-Anzeige irreführend — gleiche Projekt-
            // philosophie wie beim vorherigen Prozentzahlen-Bugfix (keine
            // erfundene/verzerrende Zahl zeigen). Stattdessen ehrliche,
            // trotzdem einladende Formulierung ohne jede Prozentangabe.
            const isGenericFallback = Boolean(course.is_role_fallback) && (course.covers_role_count ?? 0) === 0;
            // Analog zu isGenericFallback (siehe Kommentar oben): auch ein
            // Kurs OHNE Rollen-Fallback kann covers_gap_count === 0 haben
            // (z.B. eine featured/soon-starting-Karte, die primär aus
            // anderen Gründen gezeigt wird). Ohne diese Prüfung stand hier
            // eine nackte "0 von N"-Zahl — demotivierend und, weil der Kurs
            // ja aus einem echten Grund empfohlen wird, auch irreführend
            // (Rückmeldung 17.09.: "0 von 128 Skills werden vermittelt").
            const showsZeroGapDirectly = !course.is_role_fallback && (course.covers_gap_count ?? 0) === 0;
            // Rückmeldung 17.09. ("es muss dann kommen welche Skills man mit
            // der Weiterbildung erlernt und dass man damit näher an seinem
            // Ziel ist"): direkt an der jeweils ausgewählten Karte selbst
            // sichtbar (course-hero-reveal unten), statt in einem separaten
            // Panel unterhalb aller Karten (das vormalige PersonalizedPitch,
            // siehe Kommentar an buildCoursePitch oben — entfernt). Dieselbe
            // Zuordnungslogik wie die vorherige selectedCoveredGapSkillLabels,
            // nur jetzt pro Karte statt nur für die eine globale Auswahl.
            const cardCoveredGapLabels = fullCourse
              ? gapSkills
                  .filter((skill) => (fullCourse.covered_skill_uris ?? []).includes(skill.esco_uri))
                  .map((skill) => skill.preferred_label)
              : [];
            const cardCurrentMatch = courseResult?.match_percentage ?? null;
            const cardProjectedMatch =
              cardCurrentMatch != null
                ? projectedMatchPct(cardCurrentMatch, course.covers_gap_percentage ?? 0)
                : null;
            return (
              <div
                key={course.course_id}
                className={`course-hero selectable ${i === 0 ? "course-hero-primary" : "course-hero-alternative"} ${i === 0 ? "course-hero-featured" : ""} ${isSelected ? "selected" : ""}`}
                onClick={() => onSelectCourse(course.course_id)}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                onKeyDown={(e) => handleCardKeyDown(e, () => onSelectCourse(course.course_id))}
              >
                {/* Endgültige Lösung nach zwei Feedback-Runden (15.09.):
                    genau EIN "immer sichtbares" Element statt zwei
                    überlappender (schwebendes Band + Banner-Leiste, das war
                    die "doppelt"-Rückmeldung). Jetzt nur noch die
                    Banner-Leiste (CourseBadgeRow, alwaysShow) — zeigt echte
                    Datenfelder (Startdatum/Plätze/eigener Banner), sonst
                    einen der Karte angemessenen, wahren Fallback-Text. */}
                <CourseBadgeRow
                  course={courseById(course.course_id)}
                  alwaysShow
                  isBestMatch={i === 0 && !isGenericFallback}
                />
                {/* Bereich (NEU, 18.09. — "die angezeigten Bereiche müssen immer im
                    Mittelpunkt stehen"): direkt auf der Kurskarte selbst sichtbar,
                    nicht nur weiter oben im "Bereich"-Journey-Schritt. Zeigt exakt
                    denselben Bereich, den ein Bildungsträger im Kurskatalog pflegt
                    (siehe BereichBadges in DashboardPage.tsx). */}
                <BereichBadges course={courseById(course.course_id)} />
                <div className="course-hero-top">
                  <span className={`course-hero-badge ${i === 0 ? "" : "alt"}`}>
                    {isGenericFallback
                      ? i === 0
                        ? "★ Top-Kurs"
                        : "Ebenfalls beliebt"
                      : i === 0
                        ? "Beste Passung"
                        : "Alternative"}
                  </span>
                  {/* Bugfix (14.09., Rückmeldung "keine Weiterbildungen mit
                      Prozentzahlen angezeigt"): rankCoursesForGap() setzt
                      covers_gap_percentage/-count bewusst auf 0, sobald kein
                      Kurs eine konkrete Lücke trifft (Rollen-Fallback,
                      is_role_fallback=true, siehe FIX 3 in courseMatcher.ts)
                      — vorher wurde hier trotzdem blind covers_gap_percentage
                      gezeigt, also immer "0%"/"deckt 0 Gap-Skills", obwohl der
                      Kurs echte Rollen-Kern-Skills abdeckt (covers_role_-
                      percentage/-count). Passiert genau dann, wenn im
                      Kurskatalog kein Kurs die konkret erkannte Lücke trifft
                      — z.B. bei ungewöhnlichen Zielrollen aus dem
                      "weiß noch nicht"-Pfad. isGenericFallback (s.o.) zeigt
                      hier bewusst GAR KEINE Zahl, statt einer echten 0%. */}
                  {/* Visuelles Redesign (14.09., Rückmeldung "sieht aus wie
                      2008, soll maximal modern aussehen und zur Buchung
                      bewegen"): score-wrap zeigt die Prozentzahl jetzt mit
                      kleiner "Match"-Unterschrift statt einer isolierten
                      Zahl (siehe .course-hero-score-wrap in journey.css) —
                      bei isGenericFallback bewusst ohne Zahl, nur das Label
                      "Empfehlung", statt eine erfundene 0% zu zeigen. */}
                  <div className="course-hero-coverage" aria-label="Skill-Abdeckung dieser Weiterbildung">
                    {isGenericFallback || showsZeroGapDirectly ? (
                      <span className="course-hero-recommendation-badge">Empfehlung</span>
                    ) : course.is_role_fallback ? (
                      <>
                        <span className="course-hero-coverage-value">{course.covers_role_count ?? 0}</span>
                        <span className="course-hero-coverage-label">Kern-Skills im Fokus</span>
                      </>
                    ) : (
                      <>
                        <span className="course-hero-coverage-value">{course.covers_gap_count}</span>
                        <span className="course-hero-coverage-label">deiner offenen Skills</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="course-hero-name">{course.course_name}</div>
                <div className="course-hero-meta">
                  {course.provider} · {formatCourseDuration(fullCourse ?? course)}
                  {!isGenericFallback && !showsZeroGapDirectly && (
                    <>
                      {" · "}
                      {course.is_role_fallback
                        ? `deckt ${course.covers_role_count ?? 0} Kern-Skills deiner Zielrolle ab`
                        : `deckt ${course.covers_gap_count} deiner Gap-Skills`}
                    </>
                  )}
                </div>
                {!isGenericFallback && !showsZeroGapDirectly && (
                  <div className="course-coverage-summary">
                    <div className="course-coverage-head">
                      <span>Skill-Abdeckung dieser Weiterbildung</span>
                      <b>{course.is_role_fallback ? `${course.covers_role_count ?? 0} Kern-Skills` : `${course.covers_gap_count} von ${gapSkillLabels.length}`}</b>
                    </div>
                    {!course.is_role_fallback && gapSkillLabels.length > 0 && (
                      <SkillCoverageMeter covered={course.covers_gap_count ?? 0} total={gapSkillLabels.length} compact />
                    )}
                    <div className="course-coverage-copy">
                      {course.is_role_fallback
                        ? `Der Kurs greift ${course.covers_role_count ?? 0} zentrale Kompetenzen deiner Zielrolle auf.`
                        : `Damit arbeitest du gezielt an ${course.covers_gap_count} deiner aktuell offenen Lernfelder.`}
                    </div>
                  </div>
                )}
                {isGenericFallback && (
                  <div className="hint" style={{ marginTop: "2px" }}>
                    Kein Kurs in unserem Katalog trifft aktuell direkt deine Zielrolle — das hier ist unsere
                    beliebteste Empfehlung, schau sie dir trotzdem an.
                  </div>
                )}
                {showsZeroGapDirectly && (
                  <div className="course-coverage-summary course-coverage-summary--indirect">
                    <div className="course-coverage-head">
                      <span>Passung zu deinem Ziel</span>
                    </div>
                    <div className="course-coverage-copy">
                      Dieser Kurs trifft keine deiner aktuell offenen Lernfelder direkt, baut aber relevantes
                      Fachwissen für <b>{targetRoleName || "deine Zielrolle"}</b> auf.
                    </div>
                  </div>
                )}
                {/* Beschäftigungsart/Präferenz-Mismatch bleiben eine eigene,
                    kontextuelle Meta-Zeile (kein "Rahmendatum" im Sinne der
                    Rückmeldung unten, sondern ein Abgleich mit den
                    Präferenzen-Angaben) — Ort und Start sind seit 17.09. Teil
                    von course-hero-facts direkt darunter, siehe dort. */}
                {fullCourse && (fullCourse.employment_mode || mismatches.length > 0) && (
                  <div className="course-hero-meta">
                    {fullCourse.employment_mode && COURSE_EMPLOYMENT_LABELS[fullCourse.employment_mode]}
                    {mismatches.length > 0 && (
                      <>
                        {fullCourse.employment_mode && " · "}
                        <span className="hint">
                          {mismatches.join("/")} {mismatches.length === 1 ? "passt" : "passen"} evtl. nicht zu
                          deiner Angabe
                        </span>
                      </>
                    )}
                  </div>
                )}
                {/* Voraussetzungs-Abgleich (Version 34, 22.09.) — siehe
                    checkPrerequisites() in courseMatcher.ts/prerequisite_status
                    an CourseRecommendation in orbit.ts. Nur gesetzt, wenn der
                    Kurs mindestens eine strukturierte Voraussetzung traegt UND
                    die Person im "Präferenzen"-Schritt mindestens eine der
                    drei Fragen beantwortet hat — sonst bewusst gar keine Zeile
                    (kein erfundenes "unklar" ohne jede Angabe). Beeinflusst
                    NIE, ob der Kurs angezeigt wird, nur diese Zusatzinfo (die
                    Sortierung passiert bereits in rankCoursesForGap). */}
                {course.prerequisite_status && (
                  <div className={`course-hero-meta course-prereq course-prereq--${course.prerequisite_status.replace(/_/g, "-")}`}>
                    {course.prerequisite_status === "nicht_erfuellt" && (
                      <span className="hint hint-warn">
                        ⚠️ {(course.prerequisite_unmet ?? []).join("/") || "Voraussetzungen"}{" "}
                        {(course.prerequisite_unmet ?? []).length === 1 ? "passt" : "passen"} laut deiner Angabe evtl.
                        nicht — sprich das am besten direkt mit {course.provider} ab.
                      </span>
                    )}
                    {course.prerequisite_status === "unklar" && (
                      <span className="hint">
                        ℹ️ Dieser Kurs setzt bestimmte Voraussetzungen voraus (z.B. Vorbildung, Erfahrung oder
                        Sprachniveau) — check kurz, ob du sie erfüllst.
                      </span>
                    )}
                    {course.prerequisite_status === "erfuellt" && (
                      <span className="hint hint-ok">✓ Deine Angaben erfüllen die Voraussetzungen dieses Kurses.</span>
                    )}
                  </div>
                )}
                {/* Rahmendaten-Pillen (Version 33, 14.09., erweitert 17.09.) —
                    der eigentliche Kern der Anfrage "mehr Infos wie Preise,
                    Anzahl Stunden und ob es förderfähig ist bei den Kursen".
                    Rückmeldung 17.09. ("es sollen immer die Daten sichtbar
                    sein und wenn keine hinterlegt worden sind, dann soll auf
                    Anfrage kommen"): ANDERS als bisher fällt eine Pille nicht
                    mehr weg, wenn der Bildungsträger das Feld nicht gepflegt
                    hat — sie zeigt dann ehrlich "auf Anfrage" (siehe
                    courseLocationText/courseCostText/courseQualificationText/
                    courseFundingText/courseStartText oben), statt einen Wert
                    zu erfinden ODER die Zeile kommentarlos verschwinden zu
                    lassen. Ort/Kosten/Niveau/Förderung/Start jetzt hier
                    gebündelt, statt Ort/Start zusätzlich in der Meta-Zeile
                    oben zu duplizieren. */}
                {fullCourse && (
                  <div className="course-hero-facts">
                    <span className="course-hero-fact">{courseLocationText(fullCourse)}</span>
                    <span className="course-hero-fact">💶 {courseCostText(fullCourse)}</span>
                    <span className="course-hero-fact">🎓 {courseQualificationText(fullCourse)}</span>
                    <span
                      className={`course-hero-fact ${fullCourse.funding_types && fullCourse.funding_types.length > 0 ? "course-hero-fact-funding" : ""}`}
                      title={
                        fullCourse.funding_types && fullCourse.funding_types.length > 0
                          ? fullCourse.funding_types.map((f) => FUNDING_TYPE_LABELS[f] ?? f).join(", ")
                          : undefined
                      }
                    >
                      💰 {courseFundingText(fullCourse)}
                    </span>
                    <span className="course-hero-fact">📅 Start {courseStartText(fullCourse)}</span>
                  </div>
                )}
                {(pitch.headline || pitch.skillLine || pitch.goalLine || pitch.descriptionSnippet) && (
                  <div className="course-hero-pitch">
                    {pitch.headline && (
                      <div className="course-hero-pitch-headline">
                        <span aria-hidden="true">🎯</span> {pitch.headline}
                      </div>
                    )}
                    {(pitch.skillLine || pitch.goalLine) && (
                      <div className="course-hero-pitch-text">
                        {pitch.skillLine}
                        {pitch.skillLine && pitch.goalLine && " "}
                        {pitch.goalLine}
                      </div>
                    )}
                    {pitch.descriptionSnippet && (
                      <div className="course-hero-pitch-quote">
                        „
                        {isExpandedDesc && fullCourse?.description
                          ? fullCourse.description.trim()
                          : pitch.descriptionSnippet}
                        "
                      </div>
                    )}
                    {isExpandedDesc && targetGroupTrimmed && (
                      <div className="course-hero-pitch-text" style={{ marginTop: "6px" }}>
                        <b>Zielgruppe:</b> {targetGroupTrimmed}
                      </div>
                    )}
                    {hasMoreDesc && (
                      <button
                        type="button"
                        className="course-hero-more"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedCourseId(isExpandedDesc ? null : course.course_id);
                        }}
                      >
                        {isExpandedDesc ? "▴ Weniger anzeigen" : "▾ Mehr erfahren"}
                      </button>
                    )}
                  </div>
                )}
                {isSelected && (cardCoveredGapLabels.length > 0 || Boolean(fullCourse) || (cardProjectedMatch != null && cardCurrentMatch != null && cardProjectedMatch > cardCurrentMatch)) && (
                  <div className="course-hero-reveal" onClick={(e) => e.stopPropagation()}>
                    <div className="course-hero-reveal-head">
                      <span className="course-hero-reveal-icon" aria-hidden="true">✓</span>
                      <strong>Das bringt dir dieser Kurs konkret</strong>
                    </div>
                    {/* Rückmeldung 17.09. ("die Infos Dauer, Ort, Kosten,
                        Niveau etc. sollen auch drinstehen", später konkretisiert:
                        "es sollen immer die Daten sichtbar sein und wenn keine
                        Hinterlegt worden sind, dann soll auf Anfrage kommen"):
                        alle sechs Zeilen sind jetzt IMMER da (Dauer hat als
                        Pflichtfeld ohnehin immer einen echten Wert), fehlende
                        Werte zeigen "auf Anfrage" statt komplett zu fehlen —
                        siehe courseLocationText/courseCostText/
                        courseQualificationText/courseFundingText/
                        courseStartText oben. */}
                    {fullCourse && (
                      <div className="course-hero-reveal-facts">
                        <div className="course-hero-reveal-fact">
                          <span className="course-hero-reveal-fact-label">Dauer</span>
                          <span>{formatCourseDuration(fullCourse)}</span>
                        </div>
                        <div className="course-hero-reveal-fact">
                          <span className="course-hero-reveal-fact-label">Ort</span>
                          <span>{courseLocationText(fullCourse)}</span>
                        </div>
                        <div className="course-hero-reveal-fact">
                          <span className="course-hero-reveal-fact-label">Kosten</span>
                          <span>{courseCostText(fullCourse)}</span>
                        </div>
                        <div className="course-hero-reveal-fact">
                          <span className="course-hero-reveal-fact-label">Niveau</span>
                          <span>{courseQualificationText(fullCourse)}</span>
                        </div>
                        <div className="course-hero-reveal-fact">
                          <span className="course-hero-reveal-fact-label">Förderung</span>
                          <span>{courseFundingText(fullCourse)}</span>
                        </div>
                        <div className="course-hero-reveal-fact">
                          <span className="course-hero-reveal-fact-label">Start</span>
                          <span>{courseStartText(fullCourse)}</span>
                        </div>
                      </div>
                    )}
                    {/* Rückmeldung 17.09. ("die erlernten Skills sollten viel
                        mehr im Vordergrund stehen als die noch offenen
                        Skills"): gelernte Skills als große, grüne Hero-Chips
                        MIT Zwischenüberschrift, alle statt nur der ersten 5.
                        Die frühere "Danach noch offen: ..."-Zeile wurde auf
                        erneute Rückmeldung ("das danach offen soll weg")
                        ersatzlos entfernt — nur noch der positive Teil (das,
                        was die Person tatsächlich lernt) bleibt im Reveal. */}
                    {cardCoveredGapLabels.length > 0 && (
                      <div className="course-hero-reveal-covered">
                        <div className="course-hero-reveal-covered-heading">
                          ✓ {cardCoveredGapLabels.length} {cardCoveredGapLabels.length === 1 ? "Skill lernst" : "Skills lernst"} du
                          mit dieser Weiterbildung
                        </div>
                        <div className="course-hero-reveal-chip-row">
                          {cardCoveredGapLabels.map((skill) => (
                            <span className="course-hero-reveal-chip is-covered" key={skill}>✓ {skill}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {cardCurrentMatch != null && cardProjectedMatch != null && cardProjectedMatch > cardCurrentMatch && (
                      <div className="course-hero-reveal-progress">
                        <span className="course-hero-reveal-progress-icon" aria-hidden="true">🎯</span>
                        <div>
                          <strong>Damit kommst du {role} näher.</strong>
                          <p>Dein Profil-Match steigt von {cardCurrentMatch}% auf ca. {cardProjectedMatch}%.</p>
                        </div>
                      </div>
                    )}
                    <div className="course-hero-reveal-next">
                      Du musst dich jetzt noch nicht endgültig entscheiden — weiter unten kannst du diesen Kurs
                      unverbindlich anfragen.
                    </div>
                  </div>
                )}
                <div className="course-hero-select">{isSelected ? "✓ Ausgewählt" : "Diesen Kurs auswählen"}</div>
                {/* "Auch anfragen": unabhängig von der Favoriten-Auswahl oben —
                   stopPropagation, damit ein Klick auf die Checkbox nicht
                   gleichzeitig diese Karte als Favorit auswählt (siehe
                   onClick der Karte selbst). Beim aktuell gewählten Favoriten
                   ausgeblendet, weil er ohnehin schon mit angefragt wird. */}
                {!isSelected && (
                  <label className="course-hero-also" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isAlsoRequested}
                      onChange={() => onToggleAdditional(course.course_id)}
                    />
                    Zusätzlich auch anfragen
                  </label>
                )}
              </div>
            );
            })}
          </div>
          {additionalCourseIds.size > 0 && (
            <div className="hint" style={{ marginTop: "12px" }}>
              ✓ {additionalCourseIds.size === 1 ? "1 weiterer Kurs wird" : `${additionalCourseIds.size} weitere Kurse werden`}{" "}
              zusätzlich mit angefragt.
            </div>
          )}

        </>
      ) : (
        <>
          {/* Erweiterung (14.09., Rückmeldung "falls wirklich nichts passt,
              soll eine kleine Nachricht gezeigt werden, dass man dort nichts
              gefunden hat, obwohl es eigentlich für alles immer Kurse geben
              sollte"): seit dem Bugfix in rankCoursesForGap() (FIX 3,
              courseMatcher.ts — der bisherige coveredRoleUris>0-Filter warf
              vorher auch Kurse ganz ohne jeden Skill-Bezug komplett raus)
              kommt dieser Zweig nur noch zustande, wenn der Kurskatalog des
              Bildungsträgers (courseCatalog) wirklich komplett leer ist — nicht
              mehr, weil kein Kurs "gut genug" passt. Die alte, lange
              Erklärung ("Match-%"/"exakt passende Weiterbildung fehlt") passt
              zu diesem Fall nicht mehr; jetzt eine kurze, ehrliche Meldung
              statt einer erfundenen Ausrede. */}
          {courseCatalog.length > 0 ? (
            <div className="dyd-course-empty-recovery">
              <div className="dyd-course-empty-recovery-icon">✦</div>
              <div>
                <strong>Wir haben Weiterbildungsmöglichkeiten für dich.</strong>
                <p>
                  Die automatische Zuordnung zu <b>{role}</b> war gerade nicht eindeutig.
                  Deshalb zeigen wir dir echte Weiterbildungen aus dem Kurskatalog statt
                  eine erfundene Empfehlung.
                </p>
              </div>
            </div>
          ) : (
            <div className="hint">
              Für <b>{role}</b> wurde aktuell keine Weiterbildung aus dem Kurskatalog
              zurückgegeben. Bitte prüfe im Dashboard, ob Kurse veröffentlicht sind.
            </div>
          )}
          {additionalCourseIds.size > 0 && (
            <div className="hint" style={{ marginTop: "12px" }}>
              ✓ {additionalCourseIds.size === 1 ? "1 weiterer Kurs wird" : `${additionalCourseIds.size} weitere Kurse werden`}{" "}
              zusätzlich mit angefragt.
            </div>
          )}

        </>
      )}
      {popularCourses.length > 0 && (
        <div
          className="course-carousel"
          onMouseEnter={() => setCarouselPaused(true)}
          onMouseLeave={() => setCarouselPaused(false)}
          onFocus={() => setCarouselPaused(true)}
          onBlur={() => setCarouselPaused(false)}
        >
          <div className="course-carousel-heading">
            {/* Rückmeldung 17.09.: neue, persönlichere Formulierung statt der
                sachlichen Überschrift — passt zum eher einladenden statt rein
                listenhaften Ton des restlichen Kurs-Schritts. */}
            <div className="field-label">Vielleicht sind diese Kurse auch für dich spannend</div>
            <p>Noch nicht sicher? Wirf einen Blick auf weitere Weiterbildungen aus unserem Katalog — du kannst auch mehrere anfragen.</p>
          </div>
          <div className="course-carousel-viewport">
            {popularCourses.length > 1 && (
              <button
                type="button"
                className="course-carousel-nav course-carousel-prev"
                aria-label="Vorheriger Kurs"
                onClick={() => setPopularIndex((i) => (i - 1 + popularCourses.length) % popularCourses.length)}
              >
                ‹
              </button>
            )}
            <div className="course-carousel-track" key={popularCourses[safePopularIndex].course_id}>
              {renderPopularCard(popularCourses[safePopularIndex])}
            </div>
            {popularCourses.length > 1 && (
              <button
                type="button"
                className="course-carousel-nav course-carousel-next"
                aria-label="Nächster Kurs"
                onClick={() => setPopularIndex((i) => (i + 1) % popularCourses.length)}
              >
                ›
              </button>
            )}
          </div>
          {popularCourses.length > 1 && (
            <div className="course-carousel-dots" role="tablist" aria-label="Weiteren Kurs auswählen">
              {popularCourses.map((c, i) => (
                <button
                  key={c.course_id}
                  type="button"
                  role="tab"
                  aria-selected={i === safePopularIndex}
                  aria-label={`Kurs ${i + 1} von ${popularCourses.length}: ${c.course_name}`}
                  className={`course-carousel-dot ${i === safePopularIndex ? "active" : ""}`}
                  onClick={() => setPopularIndex(i)}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {/* Conversion-Reihenfolge: individuelle Empfehlung + Pitch → weitere
          Kurse (Karussell, präsent aber kompakt) → Kontaktdaten → klare
          Handlungswahl. Das Kontaktformular bleibt damit trotzdem der klar
          erkennbare letzte Schritt. */}
      <div className="course-contact-divider" aria-hidden="true" />
      <section className="course-contact-panel" aria-label="Nächster Schritt">
        <div className="contact-conversion-head">
          <div className="course-contact-eyebrow"><span aria-hidden="true">✦</span> DEIN NÄCHSTER SCHRITT</div>
          <h3 className="course-contact-title">Möchtest du mit dieser Weiterbildung weitermachen?</h3>
          <p className="course-contact-subtitle">
            Deine Auswertung ist fertig. Hinterlasse uns deine Kontaktdaten – dein Bildungsträger kann direkt auf deinen Weg eingehen und mit dir die nächsten Schritte besprechen.
          </p>
          <div className="journey-saved-note" role="status">
            <span className="journey-saved-icon" aria-hidden="true">✓</span>
            <span><strong>Auswertung gespeichert</strong><small>Du musst die Journey nicht noch einmal ausfüllen.</small></span>
          </div>
        </div>
        <LeadStep
          leadName={leadName}
          setLeadName={setLeadName}
          leadEmail={leadEmail}
          setLeadEmail={setLeadEmail}
          leadPhone={leadPhone}
          setLeadPhone={setLeadPhone}
          leadMessage={leadMessage}
          setLeadMessage={setLeadMessage}
          consent={consent}
          setConsent={setConsent}
          busy={leadBusy}
          error={leadError}
          onSubmit={onSubmitLead}
          onBack={onBack}
          targetRoleName={targetRoleName}
          courseName={selected?.course_name}
          courseDescription={selected ? courseById(selected.course_id)?.description ?? null : null}
          additionalCourseNames={additionalCourseNames}
          projectedMatch={
            selected && courseResult
              ? projectedMatchPct(courseResult.match_percentage, selected.covers_gap_percentage)
              : undefined
          }
          desiredStartLabel={desiredStartLabel}
          employmentTypeLabel={employmentTypeLabel}
          workLocationLabel={workLocationLabel}
          wantsConsultation={wantsConsultation}
          setWantsConsultation={setWantsConsultation}
          privacyPolicyUrl={privacyPolicyUrl}
          // Rückmeldung 17.09. ("bei direkt starten soll der Link vom Kurs
          // hinterlegt sein, sodass man direkt aufs Anmeldefeld kommt"): die
          // volle Kursakte (nicht nur die CourseRecommendation) tragen, weil
          // nur sie booking_url führt — courseById() ist derselbe Lookup wie
          // an den Kurskarten oben. null, wenn der Bildungsträger für DIESEN
          // Kurs noch keinen Link gepflegt hat (ältere Kurse) — LeadStep
          // blendet den "Kurs direkt buchen"-Button dann aus, statt einen
          // toten Link anzubieten.
          bookingUrl={selected ? courseById(selected.course_id)?.booking_url ?? null : null}
        />
      </section>
    </div>
  );
}
/** Individueller Pitch: rechnet live vor, was dieser konkrete Kurs für DIESE
 * Person bedeutet — keine generische Werbefloskel, sondern die tatsächlichen
 * Zahlen aus der Gap-Analyse/Kursempfehlung dieses Durchlaufs. */
function SkillCoverageMeter({
  covered,
  total,
  compact = false,
}: {
  covered: number;
  total: number;
  compact?: boolean;
}) {
  const safeTotal = Math.max(0, total);
  const safeCovered = Math.max(0, Math.min(covered, safeTotal));
  if (!safeTotal) return null;

  return (
    <div className={`skill-coverage-meter ${compact ? "compact" : ""}`} aria-label={`${safeCovered} von ${safeTotal} offenen Skills werden durch die Weiterbildung abgedeckt`}>
      <div className="skill-coverage-segments" aria-hidden="true">
        {Array.from({ length: safeTotal }, (_, index) => (
          <span key={index} className={`skill-coverage-segment ${index < safeCovered ? "filled" : ""}`} />
        ))}
      </div>
      <div className="skill-coverage-label">
        <strong>{safeCovered} von {safeTotal}</strong> offenen Skills im Fokus
      </div>
    </div>
  );
}


function LeadStep({
  leadName,
  setLeadName,
  leadEmail,
  setLeadEmail,
  leadPhone,
  setLeadPhone,
  leadMessage,
  setLeadMessage,
  consent,
  setConsent,
  busy,
  error,
  onSubmit,
  onBack,
  targetRoleName,
  courseName,
  courseDescription,
  additionalCourseNames,
  projectedMatch,
  desiredStartLabel,
  employmentTypeLabel,
  workLocationLabel,
  wantsConsultation,
  setWantsConsultation,
  privacyPolicyUrl,
  bookingUrl,
}: {
  leadName: string;
  setLeadName: (v: string) => void;
  leadEmail: string;
  setLeadEmail: (v: string) => void;
  /** Telefonnummer (Version 27), optional wie leadName/leadEmail selbst
   *  vorher schon. */
  leadPhone: string;
  setLeadPhone: (v: string) => void;
  /** Freitext-Anliegen (Version 38, 17.09., "es soll da auch ein kleines
   *  Freitextfeld geben in dem man schon konkrete Anliegen schildern kann") —
   *  optional wie leadPhone. */
  leadMessage: string;
  setLeadMessage: (v: string) => void;
  consent: boolean;
  setConsent: (v: boolean) => void;
  busy: boolean;
  error: string | null;
  /**
   * Version 27 — nimmt entgegen, WELCHEN der CTA-Buttons unten die Person
   * angeklickt hat, statt intern den wantsConsultation-Checkbox-State zu
   * lesen. Seit Version 37 (17.09.) drei statt zwei Absichten: "start" (Kurs
   * direkt buchen), "info" (Mehr Informationen anfragen), "consultation"
   * (persönliches Beratungsgespräch). Siehe Kommentar an submitLead() in
   * JourneyPage.
   */
  onSubmit: (intent: "start" | "info" | "consultation") => void;
  onBack: () => void;
  targetRoleName: string | null;
  courseName?: string;
  /** Beschreibung des aktuell gewählten Kurses (Version 38, 17.09., "Ich will
   *  die Beschreibung beim Kurs sehen") — dieselbe volle Kursakte wie
   *  bookingUrl unten (courseById() in KursStep), da CourseRecommendation
   *  selbst kein description-Feld führt. null/undefined, wenn der
   *  Bildungsträger für diesen Kurs keine Beschreibung gepflegt hat — dann
   *  zeigt LeadStep konsequent gar keinen Beschreibungs-Block, statt einen zu
   *  erfinden (gleiches Prinzip wie überall sonst in diesem Projekt). */
  courseDescription?: string | null;
  /** Weitere per "Auch anfragen"-Checkbox markierte Kurse (Version 19, siehe
   * additionalCourseNames in JourneyPage) — werden mit demselben
   * Kontaktformular als eigene, zusätzliche Leads angelegt (siehe
   * submitLead). */
  additionalCourseNames?: string[];
  projectedMatch?: number;
  desiredStartLabel?: string;
  /** Label der im "Präferenzen"-Schritt (Version 24) gewählten
   * Beschäftigungsart/des Arbeitsorts (siehe EMPLOYMENT_OPTIONS/
   * LOCATION_OPTIONS in JourneyPage) — undefined, wenn übersprungen. */
  employmentTypeLabel?: string;
  workLocationLabel?: string;
  /** Beratungswunsch (Version 20) — seit Version 27 nur noch fürs
   *  Bestätigungs-Wording im FinalScreen relevant; welcher Wert tatsächlich
   *  MIT dem Lead gespeichert wird, entscheidet jetzt onSubmit(...) direkt
   *  (siehe oben), nicht mehr dieser State selbst. */
  wantsConsultation: boolean;
  setWantsConsultation: (v: boolean) => void;
  /** Siehe privacyPolicyUrl in JourneyPageProps (Version 28) — Link auf die
   *  echte Datenschutzerklärung, sobald eine gepflegt ist. Leer = kein Link
   *  (Hinweistext bleibt dann unverlinkt, statt auf eine tote Seite zu
   *  zeigen). */
  privacyPolicyUrl?: string;
  /**
   * Direktbuchungslink des aktuell gewählten Kurses (Version 37, 17.09.,
   * siehe booking_url in orbit.ts) — null/undefined, wenn der Bildungsträger
   * für DIESEN Kurs noch keinen gepflegt hat. Steuert, ob der "Kurs direkt
   * buchen"-Button überhaupt angeboten wird (siehe Kommentar am
   * cta-block-JSX unten) — ohne echten Link gäbe es sonst eine unehrliche
   * Weiterleitung.
   */
  bookingUrl?: string | null;
}) {
  const emailValid = leadEmail.trim().length > 0 && EMAIL_RE.test(leadEmail.trim());
  // Kursbeschreibung in der Recap-Karte (Version 38, 17.09.) — gleiches
  // Ein-/Ausklapp-Muster wie an den Kurskarten selbst (popular-course-desc-
  // block/course-hero-reveal-desc), nur lokal hier statt in KursStep, weil
  // die Recap-Karte ein eigenständiger Block ist.
  const recapDescTrimmed = courseDescription?.trim() || null;
  const [recapDescExpanded, setRecapDescExpanded] = useState(false);
  const recapDescPreview = recapDescTrimmed ? truncateAtWord(recapDescTrimmed, 160) : null;
  const recapDescCanExpand = Boolean(recapDescTrimmed && recapDescPreview && recapDescTrimmed.length > recapDescPreview.length);
  // Rein praesentationsbezogen (welcher der drei Buttons gerade den
  // Lade-Spinner zeigen soll, waehrend busy=true) — muss NICHT an
  // JourneyPage gehoben werden, siehe onSubmit-Kommentar oben.
  const [clickedIntent, setClickedIntent] = useState<"book" | "info" | "consultation" | null>(null);
  function handleDirectBook() {
    if (!emailValid) {
      setClickedIntent(null);
      document.getElementById("leadEmail")?.focus();
      return;
    }
    if (!consent) {
      setClickedIntent(null);
      setWantsConsultation(false);
      return;
    }
    setClickedIntent("book");
    setWantsConsultation(false);
    onSubmit("start");
    // Rückmeldung 17.09. ("bei direkt starten soll der Link vom Kurs
    // hinterlegt sein, sodass man direkt aufs Anmeldefeld kommt"): den Lead
    // trotzdem ganz normal anlegen (fire-and-forget, siehe onSubmit oben),
    // damit der Bildungsträger die Anfrage sieht — UND zusätzlich die echte
    // Anmeldeseite des Kurses in einem neuen Tab öffnen. window.open() direkt
    // im synchronen Klick-Handler (nicht erst nach einem await), damit
    // Browser-Popup-Blocker das nicht als nicht-nutzergesteuert einstufen.
    if (bookingUrl) {
      window.open(bookingUrl, "_blank", "noopener,noreferrer");
    }
  }
  function handleRequestInfo() {
    if (!emailValid) {
      setClickedIntent(null);
      document.getElementById("leadEmail")?.focus();
      return;
    }
    if (!consent) {
      setClickedIntent(null);
      setWantsConsultation(false);
      return;
    }
    setClickedIntent("info");
    setWantsConsultation(false);
    onSubmit("info");
  }
  function handleConsultationFirst() {
    if (!emailValid) {
      setClickedIntent(null);
      document.getElementById("leadEmail")?.focus();
      return;
    }
    if (!consent) {
      setClickedIntent(null);
      setWantsConsultation(true);
      return;
    }
    setClickedIntent("consultation");
    setWantsConsultation(true);
    onSubmit("consultation");
  }
  return (
    <div className="lead-step-conversion">
      <div className="lead-course-recap">
        <div className="lead-course-recap-icon" aria-hidden="true">✓</div>
        <div className="lead-course-recap-copy">
          {/* Rückmeldung 17.09. ("hier oben sollen dann alle Kurse stehen,
              die man anfragt"): additionalCourseNames stand bisher nur ganz
              unten (kurz vor den CTA-Buttons bzw. erst im FinalScreen nach
              dem Absenden) — jetzt direkt hier in der Recap-Karte, zusammen
              mit dem Hauptkurs, damit auf einen Blick klar ist, WAS
              insgesamt angefragt wird. */}
          <span>{additionalCourseNames && additionalCourseNames.length > 0 ? "DEINE ANGEFRAGTEN WEITERBILDUNGEN" : "DEINE AUSGEWÄHLTE WEITERBILDUNG"}</span>
          <strong>{courseName || "Deine Empfehlung"}</strong>
          {targetRoleName && <small>Dein Ziel: {targetRoleName}</small>}
          {/* Kursbeschreibung (Version 38, 17.09., "Ich will die Beschreibung
              beim Kurs sehen") — nur sichtbar, wenn der Bildungsträger für
              DIESEN Kurs tatsächlich eine Beschreibung hinterlegt hat, sonst
              bleibt der Block schlicht weg (keine erfundenen Fakten). */}
          {recapDescTrimmed && (
            <div className="lead-course-recap-desc">
              {recapDescExpanded ? recapDescTrimmed : recapDescPreview}
              {recapDescCanExpand && (
                <button
                  type="button"
                  className="course-hero-more"
                  onClick={() => setRecapDescExpanded((v) => !v)}
                >
                  {recapDescExpanded ? "▴ Weniger anzeigen" : "▾ Mehr erfahren"}
                </button>
              )}
            </div>
          )}
          {additionalCourseNames && additionalCourseNames.length > 0 && (
            <div className="lead-course-recap-extra">
              ＋ außerdem angefragt: <b>{additionalCourseNames.join(", ")}</b>
            </div>
          )}
        </div>
      </div>

      <div className="lead-data-heading">
        <div className="lead-data-title">Wie können wir dich erreichen?</div>
        <div className="lead-data-subtitle">Nur das Nötigste – deine E-Mail reicht bereits für eine Rückmeldung.</div>
      </div>

      <div className="lead-fields-grid">
        <div className="lead-field">
          <label htmlFor="leadName">Vorname / Name <span className="optional-label">optional</span></label>
          <input
            id="leadName"
            className="big-input"
            placeholder="Dein Name"
            aria-label="Dein Name"
            value={leadName}
            onChange={(e) => setLeadName(e.target.value)}
          />
        </div>
        <div className="lead-field">
          <label htmlFor="leadEmail">E-Mail-Adresse <span className="required-label">Pflichtfeld</span></label>
          <div className="input-wrap">
            <input
              id="leadEmail"
              className="big-input"
              type="email"
              placeholder="deine@email.de"
              aria-label="Deine E-Mail-Adresse (Pflichtfeld)"
              required
              aria-required="true"
              value={leadEmail}
              onChange={(e) => setLeadEmail(e.target.value)}
            />
            {emailValid && (
              <span className="input-check" aria-hidden="true">✓</span>
            )}
          </div>
        </div>
        <div className="lead-field lead-field-full">
          <label htmlFor="leadPhone">Telefonnummer <span className="optional-label">optional</span></label>
          <input
            id="leadPhone"
            className="big-input"
            type="tel"
            placeholder="z. B. 0151 12345678"
            aria-label="Deine Telefonnummer (optional)"
            value={leadPhone}
            onChange={(e) => setLeadPhone(e.target.value)}
          />
        </div>
        {/* Rückmeldung 17.09. ("es soll da auch ein kleines Freitextfeld
            geben in dem man schon konkrete Anliegen schildern kann") —
            optional, wandert 1:1 in message (siehe LeadCreateRequest in
            orbit.ts) und erscheint im Dashboard im Lead-Detail. */}
        <div className="lead-field lead-field-full">
          <label htmlFor="leadMessage">Dein Anliegen <span className="optional-label">optional</span></label>
          <textarea
            id="leadMessage"
            className="big-input lead-message-input"
            placeholder="z. B. Vorkenntnisse, Terminwünsche oder konkrete Fragen zum Kurs …"
            aria-label="Dein Anliegen (optional)"
            rows={3}
            value={leadMessage}
            onChange={(e) => setLeadMessage(e.target.value)}
          />
        </div>
      </div>

      <div className="email-trust-badge">
        <span aria-hidden="true">🔒</span><strong>Deine Daten bleiben bei deinem Bildungsträger.</strong> Sie werden sicher und nach EU-Datenschutzstandards verarbeitet.
      </div>

      <div className="consent-row">
        <input type="checkbox" id="consentBox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <label htmlFor="consentBox">
          Ich stimme zu, dass meine Angaben gespeichert werden, damit der Bildungsträger mich zur passenden Weiterbildung
          kontaktieren darf. Diese Einwilligung kann ich jederzeit gegenüber dem Bildungsträger widerrufen.
          {privacyPolicyUrl ? (
            <>
              {" "}
              Details dazu in der{" "}
              <a href={privacyPolicyUrl} target="_blank" rel="noreferrer">
                Datenschutzerklärung
              </a>
              .
            </>
          ) : (
            " Details dazu in der Datenschutzerklärung."
          )}
        </label>
      </div>
      {error && (
        <div className="status-line err" aria-live="polite">
          {error}
        </div>
      )}
      {/* Version 27 — statt einer Checkbox VOR einem einzelnen Absenden-Button
         (bis Version 26) jetzt eine ECHTE Wahl zwischen zwei gleichwertigen
         Wegen: wer bereit ist, bucht direkt; wer noch unsicher ist, lässt
         sich lieber erst beraten. Beide senden dieselben oben eingegebenen
         Kontaktdaten mit demselben Lead ab (siehe submitLead in JourneyPage),
         nur consultation_requested unterscheidet sich — technisch also kein
         zweiter Datensatz, nur eine andere Absicht am selben Formular. */}
      <div className="lead-readiness-strip" aria-live="polite">
        <span className={emailValid ? "ready-ok" : "ready-open"}>{emailValid ? "✓" : "1"}</span>
        <span>E-Mail</span>
        <span className={consent ? "ready-ok" : "ready-open"}>{consent ? "✓" : "2"}</span>
        <span>Zustimmung</span>
        <span className="ready-divider" />
        <strong>{emailValid && consent ? "Bereit für deinen nächsten Schritt" : "Noch 1–2 Angaben fehlen"}</strong>
      </div>
      {/* Rückmeldung 17.09. ("hier oben sollen dann alle Kurse stehen, die
          man anfragt"): der "Du fragst außerdem an: ..."-Hinweis stand hier
          bis eben direkt vor den CTA-Buttons (siehe Vorgänger-Kommentar in
          der Diff-Historie) — jetzt stattdessen weiter oben in der
          lead-course-recap-Karte selbst, zusammen mit Kursname und
          -beschreibung, damit auf einen Blick alles an einer Stelle steht,
          statt über die Karte verteilt zu sein. */}
      {/* Rückmeldung 17.09. ("Zusätzlich sollen die Möglichkeiten Kurs
          direkt buchen, Anfragen für mehr Informationen oder persönliches
          Beratungsgespräch unten haben"): drei statt zwei gleichwertige
          Wege. "Kurs direkt buchen" gibt es nur, wenn der Bildungsträger für
          DIESEN Kurs einen echten booking_url gepflegt hat (siehe orbit.ts)
          — ohne ihn wäre der Button eine leere Behauptung. Fehlt er, rückt
          "Mehr Informationen anfragen" an die primäre (große) Position, statt
          eine Lücke zu lassen. */}
      <div className="lead-intent-heading">
        <strong>Was möchtest du jetzt tun?</strong>
        <span>
          {bookingUrl
            ? "Du kannst den Kurs direkt buchen, mehr Informationen anfragen oder dich vorher kostenlos beraten lassen."
            : "Du kannst mehr Informationen anfragen oder dich vorher kostenlos beraten lassen."}
        </span>
      </div>
      <div className="cta-block">
        <button
          type="button"
          className={`btn-cta-primary ${busy && clickedIntent === (bookingUrl ? "book" : "info") ? "loading" : ""}`}
          onClick={bookingUrl ? handleDirectBook : handleRequestInfo}
          disabled={busy}
        >
          {busy && clickedIntent === (bookingUrl ? "book" : "info") ? (
            <>
              <span className="btn-spinner" aria-hidden="true" /> Wird gesendet…
            </>
          ) : bookingUrl ? (
            <>
              🚀 Kurs direkt buchen <span className="arrow">↗</span>
            </>
          ) : (
            <>
              ✉️ Mehr Informationen anfragen <span className="arrow">→</span>
            </>
          )}
        </button>
        <div className="cta-trust-row">
          <span>{bookingUrl ? "✓ Führt direkt zur Anmeldung deines Bildungsträgers" : "✓ Anfrage direkt weitergegeben"}</span>
          <span>✓ Kostenlos</span>
          <span>✓ Keine Verpflichtung</span>
        </div>
      </div>
      {bookingUrl && (
        <button
          type="button"
          className="consultation-optin info-optin"
          onClick={handleRequestInfo}
          disabled={busy}
          style={{ width: "100%", font: "inherit", textAlign: "left" }}
        >
          <span className="consultation-optin-text">
            <span className="consultation-optin-title">
              {busy && clickedIntent === "info" ? "⏳ Wird gesendet…" : "✉️ Lieber erst mehr Informationen anfragen"}
            </span>
            <span className="consultation-optin-sub">
              Du willst dich noch nicht festlegen? Dein Bildungsträger schickt dir gerne erst alle Details zum Kurs zu.
            </span>
          </span>
        </button>
      )}
      <button
        type="button"
        className="consultation-optin"
        onClick={handleConsultationFirst}
        disabled={busy}
        style={{ width: "100%", font: "inherit", textAlign: "left" }}
      >
        <span className="consultation-optin-text">
          <span className="consultation-optin-title">
            {busy && clickedIntent === "consultation" ? "⏳ Wird gesendet…" : "📞 Persönliches Beratungsgespräch"}
          </span>
          <span className="consultation-optin-sub">
            Du bist noch nicht sicher? Wir klären gemeinsam, ob der Kurs wirklich zu dir passt — kostenlos und unverbindlich.
          </span>
        </span>
      </button>
      <ActionsRow onBack={onBack} hideForward />
    </div>
  );
}
function FinalScreen({
  leadName,
  targetRoleName,
  courseName,
  additionalCourseNames,
  wantsConsultation,
}: {
  leadName: string;
  targetRoleName: string | null;
  courseName?: string;
  /** Weitere per "Auch anfragen"-Checkbox mit angefragte Kurse (Version 19). */
  additionalCourseNames?: string[];
  /** Beratungswunsch (Version 20, siehe wantsConsultation in JourneyPage) —
   *  steuert nur die Bestätigungszeile hier, nichts weiter. */
  wantsConsultation?: boolean;
}) {
  return (
    <div className="final-screen">
      <div className="final-check">✓</div>
      <h2 className="display">Geschafft{leadName ? `, ${leadName}` : ""}!</h2>
      <p>
        Deine Anfrage ist angekommen. Dein nächster Schritt ist damit vorbereitet: Dein Bildungsträger meldet sich zeitnah bei dir mit Details zu{" "}
        <b>{courseName || "deiner Weiterbildung"}</b>
        {additionalCourseNames && additionalCourseNames.length > 0 && (
          <>
            {" "}
            sowie zu <b>{additionalCourseNames.join(", ")}</b>
          </>
        )}
        .
      </p>
      {targetRoleName && courseName && (
        <div className="final-recap">
          <div className="final-recap-title">Dein nächster Schritt zu {targetRoleName}</div>
          <div className="final-recap-copy">
            <span className="final-recap-icon" aria-hidden="true">✓</span>
            <span><b>{courseName}</b> ist für deinen aktuellen Weg vorgemerkt und setzt an deinen erkannten Lernfeldern an.</span>
          </div>
        </div>
      )}
      {wantsConsultation && (
        <div className="final-consultation-note">
          📞 Dein Bildungsträger meldet sich außerdem für ein kurzes, unverbindliches Beratungsgespräch bei dir.
        </div>
      )}
      <div className="final-note">
        In der Regel meldet sich dein Bildungsträger innerhalb von 1–2 Werktagen bei dir — du kannst diese Seite jetzt
        einfach schließen.
      </div>
    </div>
  );
}