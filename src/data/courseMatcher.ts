/**
 * Kurs-Matching ohne Python: TS-Portierung von
 * backend/app/services/orbit/course_matcher.py — nach demselben Muster wie
 * skillMatcher.ts/gapAnalysis.ts (siehe deren Kommentare). Existierte bisher
 * NICHT als TS-Datei; das war die Luecke, die "Skillmatching bei den Kursen"
 * so schlecht gemacht hat, weil die Edge Function dafuer noch nichts hatte,
 * das denselben Qualitaetsstand wie Skill-/Gap-Matching trug.
 *
 * Drei konkrete, im Python-Original bestaetigte Probleme behoben:
 *
 *  1. RANKING WAR GEWICHT-BLIND: course_matcher.py sortierte ausschliesslich
 *     nach covers_gap_count — der ROHEN ANZAHL getroffener Gap-Skills. Jeder
 *     Gap-Skill traegt aber laengst ein `weight` aus der Gap-Analyse (siehe
 *     gapAnalysis.ts) — das ging beim alten `gap_uris = {s["esco_uri"] ...}`
 *     (nur die URI, kein Gewicht) komplett verloren. Ein Kurs, der 3
 *     unwichtige Skills abdeckt, schlug damit einen Kurs, der den einen
 *     wirklich entscheidenden Skill abdeckt. Jetzt: primaer nach
 *     GEWICHTETER Gap-Abdeckung sortiert, rohe Anzahl nur noch als Tiebreak.
 *
 *  2. is_featured KOMPLETT IGNORIERT: der Bildungstraeger markiert Kurse im
 *     Dashboard bewusst als "featured" (steuert u.a. die "Beliebte
 *     Weiterbildungen"-Kacheln in JourneyPage.tsx) — dieses Signal floss
 *     nirgends in die eigentliche Rangfolge ein. Jetzt als letzter Tiebreak
 *     genutzt (nach Gewicht und roher Anzahl, NIE davor — ein schlechterer
 *     Treffer wird nie bevorzugt, nur weil er featured ist).
 *
 *  3. ROLLEN-FALLBACK WAR NUR DOKUMENTIERT, NIE GEBAUT: src/api/orbit.ts
 *     dokumentiert an CourseRecommendation (covers_role_count/-percentage,
 *     is_role_fallback) explizit einen Fallback "kein Kurs trifft exakt
 *     einen Gap-Skill -> stattdessen nach Abdeckung ALLER Kern-Skills der
 *     Zielrolle sortieren", mit Verweis auf course_matcher.py. Im
 *     tatsaechlichen Python-Code existierte das nicht — traf kein Kurs
 *     exakt eine Luecke, blieb `recommendations` schlicht leer (siehe
 *     `if not covered: continue`). JourneyPage.tsx faengt das im echten
 *     Lead-Flow (goToKurs()) zwar mit einer sauberen Text-Fallback-Meldung
 *     ab, aber ein Kurs, der z.B. 5 von 7 Rollen-Skills abdeckt und nur die
 *     eine konkret erkannte Luecke verfehlt, wurde dabei nie gezeigt. Jetzt
 *     tatsaechlich implementiert.
 */

import { ROLES_CATALOG, type CatalogRole } from "./rolesCatalog";
import { analyzeGap, type GapAnalysisResult, type GapRoleSkillStatus } from "./gapAnalysis";
import { daysUntilCourseStart } from "./courseBadges";

/** Alle bereich_key-Werte, die im uebergebenen Kurskatalog (eines Tenants)
 *  von MINDESTENS EINEM Kurs belegt sind (15.09., finale Fassung — ersetzt
 *  die vorherigen Versuche ueber Skill-Ueberschneidung/target_role_id: beide
 *  waren optionale, bei Quentins echten Testkursen unbefuellte Felder und
 *  filterten dadurch alles auf null. Bereich ist seit diesem Feature
 *  PFLICHTFELD im Kursformular — siehe bereich_key in orbit.ts und die
 *  Validierung in DashboardPage.tsx handleAddCourse — also die zuverlaessige
 *  Quelle dafuer, welche Bereiche ein Bildungstraeger ueberhaupt anbietet).
 *  Siehe rolesWithBereichCoverage() in gapAnalysis.ts, das dieses Set
 *  konsumiert. */
export function getCoveredBereiche(
  courses: { bereich_key?: string | null; bereich_keys?: string[] | null }[]
): Set<string> {
  const keys = new Set<string>();
  for (const c of courses) {
    if (c.bereich_key) keys.add(c.bereich_key);
    for (const k of c.bereich_keys ?? []) keys.add(k);
  }
  return keys;
}

export interface CourseCatalogEntry {
  course_id: string;
  course_name: string;
  provider: string;
  duration_weeks: number;
  /** ESCO-URIs (bzw. interne skill_id, siehe Hinweis in gapAnalysis.ts). */
  covered_skill_uris: string[];
  /** Vom Bildungstraeger im Dashboard gesetzt. Optional, Default false. */
  is_featured?: boolean;
  /**
   * Version 25 — siehe location_mode/employment_mode in src/api/orbit.ts
   * (LocationMode: "remote"|"vor_ort"|"hybrid", EmploymentMode:
   * "vollzeit"|"teilzeit"|"beides"). Optional, weil rankCoursesForGap auch
   * mit handgebauten Test-Katalogen ohne diese Felder aufgerufen werden
   * koennen soll — fehlt eines, zaehlt preferenceMatchScore() das schlicht
   * nicht als Widerspruch (siehe dort).
   */
  location_mode?: string | null;
  employment_mode?: string | null;
  /**
   * Tatsächliches Kursstart-Datum (ISO, siehe starts_at an OrbitCourse in
   * orbit.ts) — dritte Präferenz-Dimension neben location_mode/
   * employment_mode (Antwort auf "Präferenzen aus der Journey sollen auch
   * ins Matching einfließen", 14.09.): Abgleich gegen den im "Präferenzen"-
   * Schritt gewählten gewünschten Startzeitpunkt (siehe
   * START_PREFERENCE_MAX_DAYS/preferenceMatchScore unten). Optional wie die
   * beiden anderen — fehlt es, zählt das nicht als Widerspruch.
   */
  starts_at?: string | null;
  /**
   * Fördermöglichkeiten (siehe FundingType/funding_types an OrbitCourse in
   * orbit.ts) — vierte Präferenz-Dimension (14.09., "ob es förderfähig ist
   * ... soll auch ins Matching einfließen"). Ein Kurs zählt als Treffer,
   * sobald mindestens EIN Fördertyp gesetzt ist — welcher genau, ist für
   * das Matching selbst unerheblich, nur der Journey-"Präferenzen"-Schritt
   * fragt bewusst grob "ist dir eine Förderung wichtig", nicht nach einem
   * bestimmten Fördertyp (siehe FUNDING_OPTIONS in JourneyPage.tsx).
   */
  funding_types?: string[] | null;
  /** Bereich(e) des Kurses (siehe bereich_key/-keys an OrbitCourse in
   *  orbit.ts, seit 15.09. Pflichtfeld im Dashboard) — genutzt vom
   *  Bereichs-Filter in FIX 4/5 unten als zuverlässigeres Signal als
   *  abgeleitete Skill-Ueberschneidung. */
  bereich_key?: string | null;
  bereich_keys?: string[] | null;
  /**
   * Einkategorisierung (siehe CourseCategory/course_category an OrbitCourse
   * in orbit.ts, Version 27/16.09., "Einkategorisierung in Zertifikate,
   * Weiterbildung, Studium etc.") — fuenfte Praeferenz-Dimension (17.09.,
   * "danach gefragt werden ob man schon weiss was man machen will,
   * Zertifikat, Seminar, Weiterbildung, Studium"). Optional wie die anderen
   * Praeferenz-Felder — fehlt es, zaehlt das in preferenceMatchScore() nicht
   * als Widerspruch (kein Kurs hat "keine Kategorie" faelschlich als
   * Ablehnung zu tragen).
   */
  course_category?: string | null;
  /**
   * Strukturierte Kurs-Voraussetzungen (siehe min_qualification_level/
   * min_experience_years/required_language_level an OrbitCourse in
   * orbit.ts) — Grundlage fuer checkPrerequisites() unten. Wie alle
   * Praeferenz-Felder optional; fehlt eines, stellt der Kurs dazu schlicht
   * keine Anforderung.
   */
  min_qualification_level?: string | null;
  min_experience_years?: number | null;
  required_language_level?: string | null;
}

/** Wie viele Tage nach dem gewünschten Startzeitpunkt (START_OPTIONS in
 *  JourneyPage.tsx) ein Kursstart noch als passend gilt — bewusst grosszügig
 *  (kein hartes "muss exakt in diesem Fenster liegen"), da das hier nur ein
 *  weicher Tiebreak ist, kein Filter (siehe preferenceMatchScore). "offen"
 *  (weiss noch nicht) hat bewusst KEINEN Eintrag — wird wie "egal" bei
 *  Beschaeftigungsart/Arbeitsort als "keine Praeferenz" behandelt. */
const START_PREFERENCE_MAX_DAYS: Record<string, number> = {
  asap: 30,
  "4-wochen": 45,
  "1-3-monate": 110,
};

/** Wie START_PREFERENCE_MAX_DAYS oben, aber fuer die gewuenschte Kursdauer
 *  (17.09., "die Dauer soll auch abgefragt werden" / "beim Matching
 *  algorithmus muss auch auf die Zeit etc. eingegangen werden") — genauso
 *  ein weicher Tiebreak, kein Filter: ein KUERZERER Kurs als gewuenscht ist
 *  nie ein Widerspruch (weniger Zeitaufwand ist nie schlechter), nur ein
 *  LAENGERER als die gewaehlte Obergrenze zaehlt. "lang" (Zeit ist kein
 *  Problem) hat bewusst KEINEN Eintrag, genau wie "offen" bei
 *  START_PREFERENCE_MAX_DAYS — wird als "keine Praeferenz" behandelt, jeder
 *  Kurs zaehlt dann als Treffer. Siehe DURATION_OPTIONS in JourneyPage.tsx
 *  fuer die dazugehoerigen Antwortmoeglichkeiten. */
const DURATION_PREFERENCE_MAX_WEEKS: Record<string, number> = {
  kurz: 8,
  mittel: 24,
};

/**
 * Wie gut ein Kurs zu den im Journey-"Präferenzen"-Schritt genannten
 * Rahmenbedingungen passt (0-6, je ein Punkt pro Dimension: Beschäftigungsart,
 * Arbeitsort, gewünschter Startzeitpunkt, Förderung, Einkategorisierung,
 * gewünschte Dauer) — bewusst KEIN harter
 * Filter: ein Kurs ohne exakte Passung wird nie ausgeblendet, nur niedriger
 * einsortiert (siehe rankCoursesForGap unten, Sortierung bleibt primär nach
 * Skill-Gap-Abdeckung). Zählt als Treffer, wenn die Person keine Präferenz
 * genannt hat, der Kurs das Feld nicht gesetzt hat, oder der Kurs
 * ausdrücklich "hybrid"/"beides" ist — nur ein echter WIDERSPRUCH (z.B.
 * Person will "teilzeit", Kurs ist explizit "vollzeit") kostet einen Punkt.
 * workLocation "vor-ort" (Bindestrich, aus JourneyPage.tsx/LOCATION_OPTIONS)
 * wird dabei auf location_mode "vor_ort" (Unterstrich, orbit.ts/LocationMode)
 * gemappt — unterschiedliche Schreibweise, siehe Kommentar bei
 * COURSE_LOCATION_LABELS in DashboardPage.tsx.
 *
 * Startzeitpunkt (14.09., "Präferenzen sollen auch ins Matching einfließen")
 * funktioniert nach demselben Prinzip: der Kurs "widerspricht" nur, wenn er
 * ECHT weiter in der Zukunft liegt, als die Person angegeben hat (siehe
 * START_PREFERENCE_MAX_DAYS) — ein Kurs, der frueher/JETZT startet, ist für
 * jede Dringlichkeitsstufe immer ein Treffer, nie ein Widerspruch (frueher
 * ist nie schlechter). Ohne starts_at am Kurs (unbekannt) zaehlt das
 * ebenfalls als Treffer, exakt wie bei location_mode/employment_mode oben.
 *
 * Förderung (14.09., "ob es förderfähig ist ... soll auch ins Matching
 * einfließen"): "widerspricht" nur, wenn die Person explizit Förderung
 * wichtig ist ("gefoerdert", siehe FUNDING_OPTIONS in JourneyPage.tsx) UND
 * der Kurs KEINEN einzigen Fördertyp hinterlegt hat. Ein Kurs mit
 * mindestens einem Fördertyp zählt immer als Treffer, unabhängig davon,
 * WELCHEN — die Journey-Frage ist bewusst grob gehalten (siehe dort).
 *
 * Einkategorisierung (17.09., "danach gefragt werden ob man schon weiss was
 * man machen will, Zertifikat, Seminar, Weiterbildung, Studium"):
 * "widerspricht" nur, wenn die Person sich klar fuer eine Kategorie
 * entschieden hat UND der Kurs eine ANDERE, ebenfalls gesetzte Kategorie
 * traegt. "weiß noch nicht" (kein echter Wert) und ein Kurs ohne
 * course_category zaehlen immer als Treffer — gleiches Prinzip wie bei den
 * anderen Dimensionen.
 *
 * Dauer (17.09., "die Dauer soll auch abgefragt werden ... beim Matching
 * algorithmus muss auch auf die Zeit etc. eingegangen werden"): funktioniert
 * nach demselben Muster wie der Startzeitpunkt oben (siehe
 * DURATION_PREFERENCE_MAX_WEEKS) — ein KUERZERER Kurs als gewuenscht ist nie
 * ein Widerspruch, nur ein laengerer als die gewaehlte Obergrenze.
 *
 * "egal"/"offen"/"weiss-noch-nicht"/"lang" (Version 26/28, siehe
 * EMPLOYMENT_OPTIONS/LOCATION_OPTIONS/START_OPTIONS/CATEGORY_OPTIONS/
 * DURATION_OPTIONS in JourneyPage.tsx) sind AUSDRUECKLICHE "keine
 * Praeferenz"-Antworten, kein echter Wert zum Abgleichen — werden hier wie
 * "keine Angabe" behandelt, sonst wuerde jeder Kurs mit gesetztem Feld
 * faelschlich als Widerspruch gewertet (kein Kurs hat je einen dieser Werte
 * als eigenen Wert).
 */
export function preferenceMatchScore(
  course: {
    location_mode?: string | null;
    employment_mode?: string | null;
    starts_at?: string | null;
    funding_types?: string[] | null;
    course_category?: string | null;
    duration_weeks?: number | null;
  },
  employmentType: string | null | undefined,
  workLocation: string | null | undefined,
  desiredStart?: string | null | undefined,
  fundingPreference?: string | null | undefined,
  categoryPreference?: string | null | undefined,
  desiredDuration?: string | null | undefined
): number {
  const wantedEmployment = employmentType === "egal" ? null : employmentType;
  const wantedLocationRaw = workLocation === "egal" ? null : workLocation;
  let score = 0;
  if (!wantedEmployment || !course.employment_mode || course.employment_mode === "beides" || course.employment_mode === wantedEmployment) {
    score += 1;
  }
  const wantedLocationMode = wantedLocationRaw === "vor-ort" ? "vor_ort" : wantedLocationRaw;
  if (!wantedLocationMode || !course.location_mode || course.location_mode === "hybrid" || course.location_mode === wantedLocationMode) {
    score += 1;
  }
  const wantedStart = desiredStart && desiredStart !== "offen" ? desiredStart : null;
  const maxDays = wantedStart ? START_PREFERENCE_MAX_DAYS[wantedStart] : undefined;
  const daysUntilStart = daysUntilCourseStart(course);
  if (!wantedStart || maxDays == null || daysUntilStart == null || daysUntilStart <= maxDays) {
    score += 1;
  }
  const wantsFunding = fundingPreference === "gefoerdert";
  if (!wantsFunding || (course.funding_types && course.funding_types.length > 0)) {
    score += 1;
  }
  const wantedCategory = categoryPreference && categoryPreference !== "weiss-noch-nicht" ? categoryPreference : null;
  if (!wantedCategory || !course.course_category || course.course_category === wantedCategory) {
    score += 1;
  }
  const wantedDuration = desiredDuration && desiredDuration !== "lang" ? desiredDuration : null;
  const maxWeeks = wantedDuration ? DURATION_PREFERENCE_MAX_WEEKS[wantedDuration] : undefined;
  if (!wantedDuration || maxWeeks == null || course.duration_weeks == null || course.duration_weeks <= maxWeeks) {
    score += 1;
  }
  return score;
}

/**
 * Wie preferenceMatchScore() oben, aber statt einer Zahl die KONKRETEN
 * Dimensionen zurueckgibt, bei denen ein echter Widerspruch vorliegt (leeres
 * Array = passt ueberall bzw. keine Praeferenz genannt) — Antwort auf "bei
 * den Kursvorschlägen soll [die Präferenz] angezeigt werden" (14.09.): statt
 * eines pauschalen "passt evtl. nicht" im UI (KursStep in JourneyPage.tsx)
 * soll konkret stehen, WORAN es liegt ("Starttermin passt evtl. nicht" statt
 * nur "passt evtl. nicht"). Bewusst dieselbe Wenn-Logik wie
 * preferenceMatchScore (nur umgekehrt: hier zaehlt der WIDERSPRUCH, nicht der
 * Treffer) — beide Funktionen muessen in jedem Fall exakt gegensaetzlich
 * urteilen, sonst widerspricht sich Sortierung und Anzeige.
 */
export function describePreferenceMismatches(
  course: {
    location_mode?: string | null;
    employment_mode?: string | null;
    starts_at?: string | null;
    funding_types?: string[] | null;
    course_category?: string | null;
    duration_weeks?: number | null;
  },
  employmentType: string | null | undefined,
  workLocation: string | null | undefined,
  desiredStart?: string | null | undefined,
  fundingPreference?: string | null | undefined,
  categoryPreference?: string | null | undefined,
  desiredDuration?: string | null | undefined
): string[] {
  const mismatches: string[] = [];
  const wantedEmployment = employmentType === "egal" ? null : employmentType;
  if (wantedEmployment && course.employment_mode && course.employment_mode !== "beides" && course.employment_mode !== wantedEmployment) {
    mismatches.push("Beschäftigungsart");
  }
  const wantedLocationRaw = workLocation === "egal" ? null : workLocation;
  const wantedLocationMode = wantedLocationRaw === "vor-ort" ? "vor_ort" : wantedLocationRaw;
  if (wantedLocationMode && course.location_mode && course.location_mode !== "hybrid" && course.location_mode !== wantedLocationMode) {
    mismatches.push("Arbeitsort");
  }
  const wantedStart = desiredStart && desiredStart !== "offen" ? desiredStart : null;
  const maxDays = wantedStart ? START_PREFERENCE_MAX_DAYS[wantedStart] : undefined;
  const daysUntilStart = daysUntilCourseStart(course);
  if (wantedStart && maxDays != null && daysUntilStart != null && daysUntilStart > maxDays) {
    mismatches.push("Starttermin");
  }
  if (fundingPreference === "gefoerdert" && !(course.funding_types && course.funding_types.length > 0)) {
    mismatches.push("Förderung");
  }
  const wantedCategory = categoryPreference && categoryPreference !== "weiss-noch-nicht" ? categoryPreference : null;
  if (wantedCategory && course.course_category && course.course_category !== wantedCategory) {
    mismatches.push("Art der Weiterbildung");
  }
  const wantedDuration = desiredDuration && desiredDuration !== "lang" ? desiredDuration : null;
  const maxWeeks = wantedDuration ? DURATION_PREFERENCE_MAX_WEEKS[wantedDuration] : undefined;
  if (wantedDuration && maxWeeks != null && course.duration_weeks != null && course.duration_weeks > maxWeeks) {
    mismatches.push("Dauer");
  }
  return mismatches;
}

/** CEFR-Sprachniveaus in aufsteigender Reihenfolge (A1..C2) — Grundlage fuer
 *  den Sprachniveau-Vergleich in checkPrerequisites() unten. Ein Wert, der
 *  hier nicht drinsteht (Tippfehler, ungewoehnliche Angabe), wird NICHT
 *  geraten, sondern wie "kein vergleichbarer Rang" behandelt — siehe dort. */
const CEFR_RANK: Record<string, number> = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5 };

/** Reihenfolge der drei QualificationLevel-Stufen (siehe QualificationLevel
 *  in orbit.ts) — "studium" deckt "berufsausbildung" mit ab, das wiederum
 *  "keine" mit abdeckt. */
const QUALIFICATION_RANK: Record<string, number> = { keine: 0, berufsausbildung: 1, studium: 2 };

/** Anzeige-Labels zu QualificationLevel (orbit.ts) — fuers UI (z.B. Badge/
 *  Hinweistext in JourneyPage.tsx/DashboardPage.tsx), an einer Stelle
 *  gepflegt statt an jeder Anzeigestelle einzeln uebersetzt. */
export const QUALIFICATION_LABELS: Record<string, string> = {
  keine: "keine formale Vorbildung",
  berufsausbildung: "abgeschlossene Berufsausbildung",
  studium: "Hochschulabschluss",
};

export interface PrerequisiteCheckResult {
  /** "erfuellt": entweder stellt der Kurs gar keine der drei Anforderungen,
   *  oder alle gestellten sind durch eine belegte Angabe der Person
   *  nachweislich erfuellt. "unklar": der Kurs stellt mindestens eine
   *  Anforderung, zu der die Person NICHTS angegeben hat (oder deren Wert
   *  sich nicht eindeutig einordnen laesst) — KEIN Widerspruch nachgewiesen,
   *  nur nichts belegt. "nicht_erfuellt": mindestens eine Anforderung ist
   *  durch eine belegte Angabe der Person nachweislich NICHT erfuellt. */
  status: "erfuellt" | "unklar" | "nicht_erfuellt";
  /** Menschenlesbare Dimensionen mit echtem, belegtem Widerspruch (nur bei
   *  status "nicht_erfuellt" nicht-leer) — analog zu describePreferenceMismatches
   *  oben, damit die UI konkret benennen kann, WORAN es liegt statt nur
   *  pauschal "Voraussetzungen evtl. nicht erfuellt". */
  unmet: string[];
}

/**
 * Gleicht die drei strukturierten Kurs-Voraussetzungen (min_qualification_level/
 * min_experience_years/required_language_level, siehe OrbitCourse in
 * orbit.ts) gegen die Selbstauskunft der Person aus dem Journey-
 * "Praeferenzen"-Schritt ab (qualification_level/experience_years/
 * german_level, siehe LeadCreateRequest in orbit.ts). Strikt nach demselben
 * Prinzip wie preferenceMatchScore/describePreferenceMismatches oben: KEIN
 * harter Filter (rankCoursesForGap blendet dadurch nie einen Kurs aus,
 * nutzt das Ergebnis nur als zusaetzlichen Tiebreak — siehe dort), und vor
 * allem: eine fehlende Angabe auf IRGENDEINER Seite (Kurs stellt keine
 * Anforderung, ODER Person hat dazu nichts gesagt) wird NIE als "nicht
 * erfuellt" gewertet, hoechstens als "unklar" — Grundprinzip "keine
 * erfundenen Fakten" auch hier: ohne echte Angabe der Person wird ihr nie
 * unterstellt, eine Voraussetzung NICHT zu erfuellen.
 */
export function checkPrerequisites(
  course: {
    min_qualification_level?: string | null;
    min_experience_years?: number | null;
    required_language_level?: string | null;
  },
  person: {
    qualificationLevel?: string | null;
    experienceYears?: number | null;
    germanLevel?: string | null;
  }
): PrerequisiteCheckResult {
  const unmet: string[] = [];
  let unclear = false;

  if (course.min_qualification_level) {
    if (person.qualificationLevel) {
      const courseRank = QUALIFICATION_RANK[course.min_qualification_level];
      const personRank = QUALIFICATION_RANK[person.qualificationLevel];
      if (courseRank != null && personRank != null) {
        if (personRank < courseRank) unmet.push("Mindestabschluss");
      } else {
        unclear = true;
      }
    } else {
      unclear = true;
    }
  }

  if (course.min_experience_years != null) {
    if (person.experienceYears != null) {
      if (person.experienceYears < course.min_experience_years) unmet.push("Berufserfahrung");
    } else {
      unclear = true;
    }
  }

  if (course.required_language_level) {
    const courseRank = CEFR_RANK[course.required_language_level];
    if (person.germanLevel) {
      const personRank = CEFR_RANK[person.germanLevel];
      if (courseRank != null && personRank != null) {
        if (personRank < courseRank) unmet.push("Sprachniveau");
      } else {
        unclear = true;
      }
    } else {
      unclear = true;
    }
  }

  if (unmet.length > 0) return { status: "nicht_erfuellt", unmet };
  if (unclear) return { status: "unklar", unmet: [] };
  return { status: "erfuellt", unmet: [] };
}

/** Numerischer Rang zu PrerequisiteCheckResult.status fuer den Sortier-
 *  Tiebreak in rankCoursesForGap unten — "erfuellt" schlaegt "unklar"
 *  schlaegt "nicht_erfuellt", aber NUR unter fachlich (Gap-Abdeckung)
 *  gleichwertigen Kursen (siehe dortiger Kommentar). */
function prerequisiteRank(status: PrerequisiteCheckResult["status"]): number {
  if (status === "erfuellt") return 2;
  if (status === "unklar") return 1;
  return 0;
}

export interface CourseRecommendationResult {
  course_id: string;
  course_name: string;
  provider: string;
  duration_weeks: number;
  covers_gap_count: number;
  covers_gap_percentage: number;
  /** Nur gesetzt, wenn kein Kurs eine echte Luecke traf (siehe FIX 3 oben). */
  covers_role_count?: number;
  covers_role_percentage?: number;
  is_role_fallback?: boolean;
  /**
   * Version 25, ab 14.09. um Startzeitpunkt und Förderung erweitert — siehe
   * preferenceMatchScore() oben. Nur gesetzt, wenn rankCoursesForGap/
   * matchCoursesToGap mit mindestens einer echten Präferenz aufgerufen
   * wurde; 0-6 (je ein Punkt pro Dimension: Beschäftigungsart, Arbeitsort,
   * gewünschter Startzeitpunkt, Förderung, Einkategorisierung, gewünschte
   * Dauer, siehe dort). Rein informativ
   * fuers UI (z.B. JourneyPage.tsx KursStep) — beeinflusst NUR die
   * Sortierung, nie ob ein Kurs ueberhaupt auftaucht.
   */
  preference_match?: number;
  /**
   * Ergebnis von checkPrerequisites() oben — nur gesetzt, wenn der Kurs
   * MINDESTENS eine der drei strukturierten Voraussetzungen traegt (siehe
   * min_qualification_level/min_experience_years/required_language_level an
   * CourseCatalogEntry). Wie preference_match rein informativ fuers UI und
   * NUR ein Sortier-Tiebreak — blendet nie einen Kurs aus (siehe
   * rankCoursesForGap unten).
   */
  prerequisite_status?: "erfuellt" | "unklar" | "nicht_erfuellt";
  prerequisite_unmet?: string[];
}

export interface CourseMatchResult {
  target_role_id: string;
  target_role_name: string;
  match_percentage: number;
  gap_skill_count: number;
  recommended_courses: CourseRecommendationResult[];
}

/**
 * Kernlogik OHNE den Gap-Analyse-Schritt — separat exportiert, damit sie
 * unabhaengig von analyzeGap() testbar ist (z.B. mit einem von Hand gebauten
 * GapAnalysisResult) und damit rankCoursesForGap sich klar von der
 * Text-Analyse trennen laesst.
 */
export function rankCoursesForGap(
  gapResult: GapAnalysisResult,
  courses: CourseCatalogEntry[],
  preferences: {
    employmentType?: string | null;
    workLocation?: string | null;
    desiredStart?: string | null;
    fundingPreference?: string | null;
    /** Version 28/17.09. — siehe preferenceMatchScore()/CATEGORY_OPTIONS in
     *  JourneyPage.tsx. */
    categoryPreference?: string | null;
    /** Version 28/17.09. — siehe preferenceMatchScore()/DURATION_OPTIONS in
     *  JourneyPage.tsx. */
    desiredDuration?: string | null;
    /**
     * Selbstauskunft der Person zu den drei strukturierten Voraussetzungs-
     * Dimensionen (siehe QUALIFICATION_OPTIONS/EXPERIENCE_OPTIONS/
     * LANGUAGE_LEVEL_OPTIONS in JourneyPage.tsx) — Eingabe fuer
     * checkPrerequisites() oben. Wie alle Praeferenzen optional: fehlt eine
     * Angabe, zaehlt die jeweilige Dimension als "unklar", nie als
     * Widerspruch (siehe dort).
     */
    qualificationLevel?: string | null;
    experienceYears?: number | null;
    germanLevel?: string | null;
    /** Rollenkatalog fuer den Bereichs-Fallback unten (FIX 4/5) — Default
     *  ROLES_CATALOG. Ueberschreibbar, damit gapResult.target_role_id auch
     *  auf eine synthetische "Bereichs-Rolle" zeigen kann, die NICHT in
     *  ROLES_CATALOG steht (siehe buildBereichRole() in gapAnalysis.ts,
     *  15.09., "ohne Verknuepfung zu einer spezifischen Zielposition") —
     *  gleiches Muster wie roles in AnalyzeGapOptions/MatchCoursesOptions. */
    roles?: CatalogRole[];
  } = {}
): CourseRecommendationResult[] {
  const gapSkills: GapRoleSkillStatus[] = gapResult.gap_skills;
  const gapWeightByUri = new Map(gapSkills.map((s) => [s.esco_uri, s.weight]));
  // Nur gesetzt, wenn ueberhaupt eine ECHTE Praeferenz mitgegeben wurde —
  // sonst waere preference_match fuer JEDEN Kurs trivial voll (siehe
  // preferenceMatchScore: eine fehlende Praeferenz zaehlt immer als Treffer)
  // und im UI irrefuehrend als "passt" darstellbar, obwohl niemand etwas
  // angegeben hat. "egal"/"offen" (Version 26) zaehlen hier bewusst NICHT
  // als Praeferenz — gleiche Begruendung wie in preferenceMatchScore() oben.
  const hasPreference =
    (Boolean(preferences.employmentType) && preferences.employmentType !== "egal") ||
    (Boolean(preferences.workLocation) && preferences.workLocation !== "egal") ||
    (Boolean(preferences.desiredStart) && preferences.desiredStart !== "offen") ||
    preferences.fundingPreference === "gefoerdert" ||
    (Boolean(preferences.categoryPreference) && preferences.categoryPreference !== "weiss-noch-nicht") ||
    (Boolean(preferences.desiredDuration) && preferences.desiredDuration !== "lang");

  // Nur gesetzt, wenn die Person zu MINDESTENS einer der drei Dimensionen
  // etwas angegeben hat — gleiches Prinzip wie hasPreference oben, damit ein
  // Kurs ohne jede Angabe nicht faelschlich ueberall als "unklar" markiert
  // wird, obwohl der Kurs selbst gar keine Voraussetzung stellt.
  const hasPersonPrereqInfo =
    Boolean(preferences.qualificationLevel) ||
    preferences.experienceYears != null ||
    Boolean(preferences.germanLevel);

  const withGapCoverage = courses.map((course) => {
    const coveredGapUris = course.covered_skill_uris.filter((uri) => gapWeightByUri.has(uri));
    const coveredGapWeight = coveredGapUris.reduce((sum, uri) => sum + (gapWeightByUri.get(uri) ?? 0), 0);
    const prefScore = preferenceMatchScore(
      course,
      preferences.employmentType,
      preferences.workLocation,
      preferences.desiredStart,
      preferences.fundingPreference,
      preferences.categoryPreference,
      preferences.desiredDuration
    );
    // Ein Kurs "hat" Voraussetzungen nur, wenn er selbst mindestens eines
    // der drei Felder gesetzt hat — sonst bleibt prerequisite_status
    // ungesetzt (siehe CourseRecommendationResult oben), damit im UI kein
    // Badge fuer Kurse OHNE jede Voraussetzung erscheint.
    const hasCoursePrereqs =
      Boolean(course.min_qualification_level) ||
      course.min_experience_years != null ||
      Boolean(course.required_language_level);
    const prereq = hasCoursePrereqs
      ? checkPrerequisites(course, {
          qualificationLevel: preferences.qualificationLevel,
          experienceYears: preferences.experienceYears,
          germanLevel: preferences.germanLevel,
        })
      : null;
    return { course, coveredGapUris, coveredGapWeight, prefScore, prereq };
  });

  // Fachlicher Schutzfilter: Sobald die Zielrolle einem Bereich zugeordnet ist,
  // dürfen Gap-Treffer nur aus diesem Bereich empfohlen werden. Ein einzelner
  // zufällig übereinstimmender Skill (z.B. "Projektmanagement") darf keinen
  // IT-Kurs in Gesundheit oder einen Gesundheitskurs in IT nach oben spülen.
  // Mehrbereichs-Kurse sind erlaubt, wenn sie den Zielbereich ausdrücklich
  // tragen. Für synthetische Bereichsrollen werden alle gewählten Bereiche
  // berücksichtigt.
  const targetRole = (preferences.roles ?? ROLES_CATALOG).find((r) => r.role_id === gapResult.target_role_id);
  const targetBereichKeys = targetRole
    ? targetRole.role_id.startsWith("bereich:")
      ? targetRole.role_id.slice("bereich:".length).split(":")[0].split(",").filter(Boolean)
      : [targetRole.bereich_key]
    : [];
  const courseMatchesTargetBereich = (course: CourseCatalogEntry): boolean => {
    if (targetBereichKeys.length === 0) return true;
    const courseBereiche = new Set<string>();
    if (course.bereich_key) courseBereiche.add(course.bereich_key);
    for (const key of course.bereich_keys ?? []) courseBereiche.add(key);
    return targetBereichKeys.some((key) => courseBereiche.has(key));
  };

  const gapMatches = withGapCoverage.filter(
    (c) => c.coveredGapUris.length > 0 && courseMatchesTargetBereich(c.course)
  );

  if (gapMatches.length > 0) {
    return gapMatches
      .sort((a, b) => {
        // FIX 1 — primaer nach gewichteter Gap-Abdeckung, nicht nach roher Anzahl.
        if (b.coveredGapWeight !== a.coveredGapWeight) return b.coveredGapWeight - a.coveredGapWeight;
        // "vor allem Qualifikationen" (Auftrag 22.09.) — bei gleicher
        // Gap-Abdeckung entscheidet zuerst, ob die Person die Voraussetzungen
        // des Kurses erfuellt, DANACH erst Ort/Zeit/Foerderung/etc.
        // (prefScore). Wie ueberall hier: NIE vor der Gap-Abdeckung, ein
        // fachlich schlechterer Kurs wird dadurch nie bevorzugt — siehe
        // checkPrerequisites().
        const prereqDiff = prerequisiteRank(b.prereq?.status ?? "erfuellt") - prerequisiteRank(a.prereq?.status ?? "erfuellt");
        if (prereqDiff !== 0) return prereqDiff;
        // Version 25 — bei gleicher Gap-Abdeckung entscheidet, welcher Kurs
        // zu Beschaeftigungsart/Arbeitsort passt. NIE vor der Gap-Abdeckung:
        // ein fachlich schlechterer Treffer wird dadurch nie bevorzugt, nur
        // unter Gleichstaenden hoeher einsortiert (siehe preferenceMatchScore).
        if (b.prefScore !== a.prefScore) return b.prefScore - a.prefScore;
        if (b.coveredGapUris.length !== a.coveredGapUris.length) return b.coveredGapUris.length - a.coveredGapUris.length;
        // FIX 2 — featured nur als letzter Tiebreak, nie davor.
        return Number(!!b.course.is_featured) - Number(!!a.course.is_featured);
      })
      .map(({ course, coveredGapUris, prefScore, prereq }) => ({
        course_id: course.course_id,
        course_name: course.course_name,
        provider: course.provider,
        duration_weeks: course.duration_weeks,
        covers_gap_count: coveredGapUris.length,
        covers_gap_percentage:
          gapSkills.length > 0 ? Math.round((coveredGapUris.length / gapSkills.length) * 1000) / 10 : 0,
        ...(hasPreference ? { preference_match: prefScore } : {}),
        ...(prereq && hasPersonPrereqInfo ? { prerequisite_status: prereq.status, prerequisite_unmet: prereq.unmet } : {}),
      }));
  }

  // FIX 4 (15.09., Rückmeldung "ich hatte gerade das Thema Bilanzbuchhaltung
  // und bekomme Full-Stack vorgeschlagen"): der bisherige Rollen-Fallback
  // (unten, FIX 3) sortierte bei covers_role_count=0 fuer ALLE Kurse einfach
  // den GESAMTEN Katalog nach Praeferenz/is_featured — ein reiner IT-Kurs
  // konnte dadurch als "Beste Passung"/"Top-Kurs" fuer eine
  // Wirtschafts/Bilanzbuchhaltungs-Rolle erscheinen, obwohl er fachlich
  // nichts damit zu tun hat (irrefuehrend, §5 UWG). Deshalb VOR dem
  // Rollen-Fallback ein Bereichs-Filter: nur Kurse, die mindestens einen
  // Skill aus DEMSELBEN Bereich abdecken (ueber alle Rollen dieses
  // bereich_key hinweg, nicht nur die exakte Zielrolle — sonst waere der
  // Filter fast identisch eng wie der eigentliche Gap-Match oben). Bleibt
  // AUCH das leer (Katalog hat wirklich nichts zum Bereich der Zielrolle),
  // wird jetzt NICHTS zurueckgegeben statt eines zufaelligen fachfremden
  // Kurses — KursStep (JourneyPage.tsx) zeigt dann die ehrliche "kein Kurs
  // hinterlegt"-Meldung statt einer falschen Empfehlung.
  // Bei einer synthetischen "Bereichs-Rolle" (role_id "bereich:a,b" oder,
  // seit der Ziel-Gewichtung (15.09.), "bereich:a,b:fuehrung", siehe
  // buildBereichRole() in gapAnalysis.ts) steckt bereich_key nur den ERSTEN
  // gewaehlten Bereich — fuer den Filter unten hier alle tragen, statt nur
  // den einen. Der optionale ":<goal>"-Suffix wird VOR dem split(",") wieder
  // abgeschnitten, sonst würde er faelschlich am letzten Bereichs-Key
  // haengen bleiben. Bei einer normalen Rolle bleibt es der eine
  // bereich_key.
  const bereichSkillIds = targetBereichKeys.length
    ? new Set(
        ROLES_CATALOG.filter((r) => targetBereichKeys.includes(r.bereich_key)).flatMap((r) =>
          r.skills.map((s) => s.skill_id)
        )
      )
    : null;
  // FIX 5 (15.09., Rückmeldung "es muss am Ende immer eine Weiterbildung
  // vorgeschlagen werden"): der reine Skill-Ueberschneidungs-Filter oben warf
  // bei duennt getaggten Katalogen (kein Kurs mit covered_skill_uris zum
  // Bereich) faelschlich ALLES raus, obwohl der Bildungstraeger im
  // betreffenden Bereich echte Kurse hat — bereich_key/-keys ist seit dem
  // Bereich-Pflichtfeld-Feature (siehe orbit.ts) das zuverlässigere, immer
  // gepflegte Signal dafuer. Ein Kurs zaehlt jetzt zum Bereich, wenn er
  // SELBST diesen bereich_key traegt, ODER (Fallback fuer Kurse ohne eigene
  // Bereichs-Skill-Kenntnis) einen Skill aus dem Bereich abdeckt.
  const bereichRelevantCourses = targetBereichKeys.length
    ? courses.filter((c) => {
        const courseBereiche = new Set<string>();
        if (c.bereich_key) courseBereiche.add(c.bereich_key);
        for (const k of c.bereich_keys ?? []) courseBereiche.add(k);
        if (targetBereichKeys.some((k) => courseBereiche.has(k))) return true;
        return bereichSkillIds ? c.covered_skill_uris.some((uri) => bereichSkillIds.has(uri)) : false;
      })
    : courses;
  if (bereichRelevantCourses.length === 0) return [];

  // FIX 3 — Rollen-Fallback: kein Kurs trifft exakt eine Luecke, also nach
  // Abdeckung ALLER Kern-Skills der Zielrolle sortieren (covered + gap
  // zusammen), damit wenigstens der naeheste Treffer gezeigt wird statt gar
  // nichts. covers_gap_count/-percentage bleiben bewusst 0 (siehe Kommentar
  // an CourseRecommendation in src/api/orbit.ts), um keine
  // Luecken-Abdeckung vorzutaeuschen, die es nicht gibt.
  const allRoleUris = new Set<string>([
    ...gapResult.covered_skills.map((s) => s.esco_uri),
    ...gapResult.gap_skills.map((s) => s.esco_uri),
  ]);

  // Bugfix (14.09., Rückmeldung "da muss immer ein Vorschlag kommen ...
  // obwohl es eigentlich für alles immer Kurse geben sollte zumindest dann
  // die Top Kurse"): hier stand bisher ein .filter((c) =>
  // c.coveredRoleUris.length > 0), das JEDEN Kurs komplett aus dem Ergebnis
  // warf, der nicht mal einen einzigen Kern-Skill der Zielrolle abdeckt —
  // bei einer ungewöhnlichen/wenig abgedeckten Zielrolle (z.B. aus dem
  // "weiß noch nicht"-Pfad) konnte das ALLE Kurse des Katalogs betreffen,
  // recommended_courses war dann leer, KursStep zeigte gar keinen Vorschlag
  // mehr, obwohl der Bildungsträger echte Kurse im Katalog hat. Der Filter
  // fällt jetzt weg: es wird die vollständige, sortierte Kursliste
  // zurückgegeben, solange der (jetzt per FIX 4 oben bereichsgefilterte)
  // Katalog nicht leer ist — covers_role_count kann dabei 0 sein (KursStep
  // zeigt in dem Fall bewusst keine erfundene Prozentzahl, siehe dortigen
  // Kommentar), aber wenigstens die echten Top-/Beliebte-Kurse (is_featured,
  // letzter Tiebreak unten) kommen dann oben an, statt dass gar nichts
  // erscheint. Ein wirklich leeres recommended_courses bedeutet jetzt: der
  // Katalog (courses) ist leer, ODER (FIX 4) er enthält nichts zum Bereich
  // der Zielrolle.
  return bereichRelevantCourses
    .map((course) => {
      const hasCoursePrereqs =
        Boolean(course.min_qualification_level) ||
        course.min_experience_years != null ||
        Boolean(course.required_language_level);
      const prereq = hasCoursePrereqs
        ? checkPrerequisites(course, {
            qualificationLevel: preferences.qualificationLevel,
            experienceYears: preferences.experienceYears,
            germanLevel: preferences.germanLevel,
          })
        : null;
      return {
        course,
        coveredRoleUris: course.covered_skill_uris.filter((uri) => allRoleUris.has(uri)),
        prefScore: preferenceMatchScore(
          course,
          preferences.employmentType,
          preferences.workLocation,
          preferences.desiredStart,
          preferences.fundingPreference,
          preferences.categoryPreference,
          preferences.desiredDuration
        ),
        prereq,
      };
    })
    .sort((a, b) => {
      if (b.coveredRoleUris.length !== a.coveredRoleUris.length) return b.coveredRoleUris.length - a.coveredRoleUris.length;
      // Siehe Kommentar im Gap-Match-Zweig oben — dieselbe Prioritaet:
      // Voraussetzungen vor den uebrigen Praeferenzen.
      const prereqDiff = prerequisiteRank(b.prereq?.status ?? "erfuellt") - prerequisiteRank(a.prereq?.status ?? "erfuellt");
      if (prereqDiff !== 0) return prereqDiff;
      if (b.prefScore !== a.prefScore) return b.prefScore - a.prefScore;
      return Number(!!b.course.is_featured) - Number(!!a.course.is_featured);
    })
    .map(({ course, coveredRoleUris, prefScore, prereq }) => ({
      course_id: course.course_id,
      course_name: course.course_name,
      provider: course.provider,
      duration_weeks: course.duration_weeks,
      covers_gap_count: 0,
      covers_gap_percentage: 0,
      covers_role_count: coveredRoleUris.length,
      covers_role_percentage:
        allRoleUris.size > 0 ? Math.round((coveredRoleUris.length / allRoleUris.size) * 1000) / 10 : 0,
      is_role_fallback: true,
      ...(hasPreference ? { preference_match: prefScore } : {}),
      ...(prereq && hasPersonPrereqInfo ? { prerequisite_status: prereq.status, prerequisite_unmet: prereq.unmet } : {}),
    }));
}

export interface MatchCoursesOptions {
  minScore?: number;
  /** Ersetzt den Standard-Rollenkatalog, z.B. fuer Tests. */
  roles?: CatalogRole[];
  /** Version 25, ab 14.09. um desiredStart und fundingPreference erweitert —
   *  siehe preferenceMatchScore()/rankCoursesForGap() oben: Beschaeftigungsart/
   *  Arbeitsort/gewuenschter Startzeitpunkt/Foerderung aus dem Journey-
   *  "Praeferenzen"-Schritt, fliessen als zusaetzlicher Tiebreak in die
   *  Kurs-Rangfolge ein. */
  employmentType?: string | null;
  workLocation?: string | null;
  desiredStart?: string | null;
  fundingPreference?: string | null;
  /** Version 28, 17.09. um Einkategorisierung und gewuenschte Dauer
   *  erweitert — siehe preferenceMatchScore()/rankCoursesForGap() oben. */
  categoryPreference?: string | null;
  desiredDuration?: string | null;
  /** Version 29, 22.09. ("Voraussetzungen") — siehe checkPrerequisites()/
   *  rankCoursesForGap() oben. */
  qualificationLevel?: string | null;
  experienceYears?: number | null;
  germanLevel?: string | null;
}

/** TS-Entsprechung von match_courses_to_gap() aus course_matcher.py — ruft
 *  intern analyzeGap() auf (wie das Python-Original analyze_gap()) und rankt
 *  danach den uebergebenen Kurskatalog des Tenants. `courses` kommt aus der
 *  DB (siehe DashboardPage.tsx Kurse-Tab) — anders als Rollen/Skills gibt es
 *  dafuer keinen statischen Katalog, deshalb Parameter statt Import. */
export function matchCoursesToGap(
  text: string,
  targetRoleId: string,
  courses: CourseCatalogEntry[],
  opts: MatchCoursesOptions = {}
): CourseMatchResult | null {
  const minScore = opts.minScore ?? 60.0;
  const roles = opts.roles ?? ROLES_CATALOG;

  const gapResult = analyzeGap(text, targetRoleId, { minScore, roles });
  if (!gapResult) return null;

  return {
    target_role_id: gapResult.target_role_id,
    target_role_name: gapResult.target_role_name,
    match_percentage: gapResult.match_percentage,
    gap_skill_count: gapResult.gap_skills.length,
    recommended_courses: rankCoursesForGap(gapResult, courses, {
      employmentType: opts.employmentType,
      workLocation: opts.workLocation,
      desiredStart: opts.desiredStart,
      fundingPreference: opts.fundingPreference,
      categoryPreference: opts.categoryPreference,
      desiredDuration: opts.desiredDuration,
      qualificationLevel: opts.qualificationLevel,
      experienceYears: opts.experienceYears,
      germanLevel: opts.germanLevel,
      roles,
    }),
  };
}