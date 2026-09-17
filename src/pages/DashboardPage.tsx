import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  ESCO_LANG,
  EXPERIENCE_LEVEL_LABELS,
  EXPERIENCE_LEVEL_ORDER,
  EXPERIENCE_LEVEL_SHORT_LABELS,
  extractDocumentText,
  fetchGapAnalysis,
  fetchTargetRoles,
  searchEscoSkills,
  upsertTargetRole,
  type ExperienceLevel,
  type MatchedSkill,
  type RoleSkillStatus,
  type SkillSearchResult,
  type TargetRole,
  type TargetRoleSkillInput,
} from "../api/core";
import {
  courseCopyAssistBaseUrl,
  courseUrlImportBaseUrl,
  createLead,
  deleteLead,
  depthAnalysisBaseUrl,
  fetchCourses,
  fetchCourseCopyAssist,
  fetchCourseUrlDiscover,
  fetchCourseUrlExtract,
  fetchDepthAnalysis,
  fetchLeads,
  fetchOrbitReport,
  fetchSkillLevelDetect,
  setCourseFeatured,
  setLeadAssignedTo,
  setLeadBooked,
  setLeadConsultationCompleted,
  setLeadConsultationRequested,
  setLeadConsultationScheduled,
  setLeadLinkedCourses,
  skillLevelDetectBaseUrl,
  upsertCourse,
  type CourseSkillEntry,
  type CourseUrlExtractResponse,
  type DepthAnalysisResponse,
  type DepthSkillAssessment,
  type FundingType,
  type LeadResponse,
  type OrbitCourse,
  type OrbitReportResponse,
  type QualificationType,
} from "../api/orbit";
import { guessExperienceLevel } from "../lib/skillLevel";
import { matchSkills } from "../data/skillMatcher";
import { listBereiche } from "../data/gapAnalysis";
import { ROLES_CATALOG } from "../data/rolesCatalog";
import { CourseBadgeRow } from "../data/courseBadges";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { DashboardTour } from "../components/DashboardTour";
import "../styles/dashboard.css";
/**
 * Einheitlicher Namensraum fuer Kurs-Skill-Zuordnungen im Dashboard: wandelt
 * einen Treffer des LOKALEN Katalog-Matchers (matchSkills, siehe
 * ../data/skillMatcher — derselbe Katalog/dieselbe Engine, die die
 * Journey-Gap-Analyse in gapAnalysis.ts/courseMatcher.ts nutzt) in die
 * gemeinsame MatchedSkill-Form um, die im Dashboard ueberall fuer
 * Skill-Vorschlaege verwendet wird.
 *
 * WICHTIG (Bugfix): Vorher riefen drei der vier Kurs-Skill-Erkennungswege im
 * Dashboard (Live-ESCO-Suche, Modulhandbuch-Upload, CSV-Bulk-Import) stattdessen
 * fetchSkillMatch() auf — den ECHTEN Backend-ESCO-Matcher (~13.900 Skills,
 * lange esco_uri-URLs). Nur handleDetectManualSkills nutzte schon den lokalen
 * Katalog. Weil rankCoursesForGap() in courseMatcher.ts covered_skill_uris
 * eines Kurses per EXAKTEM STRING-VERGLEICH gegen die lokalen skill_ids der
 * Journey-Gap-Analyse prueft, konnten ueber diese drei Wege zugeordnete
 * Kurs-Skills NIE als Match fuer eine Journey-Luecke erkannt werden — voellig
 * unabhaengig davon, wie inhaltlich passend der Kurs tatsaechlich war. Das war
 * eine Hauptursache fuer schlecht gematchte Kursvorschlaege. Jetzt nutzen alle
 * vier Wege denselben lokalen Katalog und schreiben konsistent lokale
 * skill_ids in covered_skill_uris (Feldname bleibt aus Kompatibilitaetsgruenden
 * "esco_uri", siehe Kommentar dazu in gapAnalysis.ts).
 */
function matchSkillsLocal(text: string, opts?: { maxResults?: number; minScore?: number }): MatchedSkill[] {
  return matchSkills(text, opts).map((m) => ({
    esco_uri: m.skill_id,
    preferred_label: m.name,
    skill_type: "custom",
    matched_on: m.matched_on,
    score: m.score,
  }));
}
/** Ein Schritt der "Ladephase"-Fortschrittsanzeige beim URL-Import (siehe
 *  url-import-progress in DashboardPage weiter unten) — macht sichtbar, was
 *  waehrend/nach der KI-Extraktion tatsaechlich passiert (inkl. der ohnehin
 *  schon automatisch laufenden Skill-/Zielrollen-Erkennung, die vorher
 *  unsichtbar im Hintergrund ablief). Rein praesentational, kein eigener
 *  State. */
function UrlImportProgressStep({
  status,
  label,
}: {
  status: "pending" | "active" | "done" | "error";
  label: ReactNode;
}) {
  const icon = status === "done" ? "✅" : status === "active" ? "🔄" : status === "error" ? "❌" : "⚪";
  return (
    <div className={`url-import-progress-step url-import-progress-step--${status}`}>
      <span className={`url-import-progress-icon${status === "active" ? " url-import-progress-icon--spin" : ""}`}>
        {icon}
      </span>
      <span>{label}</span>
    </div>
  );
}
/** Begleittexte fuer die Ladeanzeige waehrend der KI-Extraktion einer
 *  Kurs-URL (siehe UrlImportAnalysisLoader unten) — nach demselben Prinzip
 *  wie cvLoadingMessages()/CvAnalysisLoader in JourneyPage.tsx ("ARCS"-
 *  angelehnt: Attention/Relevance/Confidence/Satisfaction), aber inhaltlich
 *  eigenstaendig fuer den Kurs-Import-Kontext. Bewusst KEINE erfundenen
 *  Zahlen/Statistiken, nur ehrliche, allgemeingueltige Aussagen dazu, was
 *  gerade tatsaechlich passiert - personalisiert nur ueber die Domain der
 *  gerade gelesenen Seite. */
function urlImportLoadingMessages(domain: string) {
  return [
    {
      title: "Seite wird gelesen",
      body: `Wir laden gerade die Kursseite von „${domain}“ und lesen den sichtbaren Text aus.`,
    },
    {
      title: "Nur was wirklich dort steht",
      body:
        "Alle Angaben (Dauer, Termine, Preis, Förderung, Skills …) werden ausschließlich aus dem tatsächlichen Seitentext übernommen — nichts wird geschätzt oder ergänzt.",
    },
    {
      title: "Kursdaten werden strukturiert",
      body: "Titel, Dauer, Zielgruppe und Inhalte werden gerade den passenden Feldern im Kurs-Formular zugeordnet.",
    },
    {
      title: "Gleich geht's weiter",
      body: "Direkt im Anschluss laufen automatisch noch die Skill- und Zielrollen-Erkennung — den Entwurf kannst du danach in Ruhe prüfen und ergänzen.",
    },
  ];
}
/** Ausfuehrliche Ladeanzeige waehrend runUrlImportExtraction() laeuft (siehe
 *  DashboardPage) — ersetzt in diesem Moment den kompakten Schritt-Tracker
 *  (url-import-progress) durch eine Animation mit rotierenden Texten, analog
 *  zu CvAnalysisLoader in JourneyPage.tsx/journey.css, aber mit eigenen,
 *  lokal in dashboard.css definierten Keyframes (spin/pulseDot/fadeInUp sind
 *  dort bisher nicht vorhanden). Fortschrittsbalken bewusst simuliert (naehert
 *  sich 92% an, ohne "fertig" zu behaupten) - siehe Kommentar an
 *  CvAnalysisLoader fuer die Begruendung. */
function UrlImportAnalysisLoader({ url, courseIndex, courseTotal }: { url: string; courseIndex: number; courseTotal: number }) {
  const domain = useMemo(() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }, [url]);
  const messages = useMemo(() => urlImportLoadingMessages(domain), [domain]);
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
    <div className="url-import-loading" role="status" aria-live="polite">
      <div className="url-import-loading-spinner" aria-hidden="true">
        <div className="url-import-loading-spinner-ring" />
        <div className="url-import-loading-spinner-icon">🔍</div>
      </div>
      <div className="url-import-loading-phase">
        {courseTotal > 1 ? `Kurs ${courseIndex + 1} von ${courseTotal} wird gelesen…` : "Kursseite wird gelesen…"}
      </div>
      <div className="url-import-loading-bar-track">
        <div className="url-import-loading-bar-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="url-import-loading-message" key={msgIndex}>
        <div className="url-import-loading-message-title">{current.title}</div>
        <div className="url-import-loading-message-body">{current.body}</div>
      </div>
    </div>
  );
}
type Tab = "leads" | "kurse" | "reports";
type StatusKind = "" | "ok" | "err";
interface LeadFormState {
  text: string;
  name: string;
  email: string;
  /** Siehe contact_phone in orbit.ts (Version 27) — additiv wie email,
   *  optional, wird 1:1 wie das Telefonfeld aus der Journey (LeadStep)
   *  gespiegelt, damit ein manuell angelegter Test-Lead genauso aussieht
   *  wie ein echter. */
  phone: string;
  targetRoleId: string;
  /** Wie dringlich das Anliegen ist (siehe DESIRED_START_LABELS unten) —
   *  spiegelt START_OPTIONS aus der echten Journey, damit ein manuell
   *  angelegter Test-Lead genauso aussieht wie ein echter. Leerer String =
   *  nicht angegeben. */
  desiredStart: string;
  /** Beschäftigungsart/Arbeitsort (siehe EMPLOYMENT_TYPE_LABELS/
   *  WORK_LOCATION_LABELS oben) — spiegeln EMPLOYMENT_OPTIONS/LOCATION_OPTIONS
   *  aus dem neuen "Präferenzen"-Schritt der Journey (Version 24). Leerer
   *  String = nicht angegeben, genau wie desiredStart. */
  employmentType: string;
  workLocation: string;
  /** Siehe consultation_requested in orbit.ts — auch für manuell angelegte
   *  Leads setzbar, damit sich das neue "Beratungsgespräch"-Feld auf der
   *  Karte testen lässt, ohne die echte Journey durchlaufen zu müssen. */
  wantsConsultation: boolean;
  /** Interessante/gebuchte Weiterbildungen — werden nach dem Anlegen per
   *  setLeadLinkedCourses() an den Lead gehängt (siehe handleCreateLead),
   *  da LeadCreateRequest selbst keine Kursliste entgegennimmt. */
  linkedCourseIds: string[];
  /** Direkt als gebucht markieren — nach dem Anlegen per setLeadBooked(). */
  booked: boolean;
}
const DEFAULT_LEAD_FORM: LeadFormState = {
  text: "Erfahrene Marketing-Managerin mit SQL-, Excel- und Statistik-Kenntnissen.",
  name: "M. Becker",
  email: "",
  phone: "",
  targetRoleId: "",
  desiredStart: "",
  employmentType: "",
  workLocation: "",
  wantsConsultation: false,
  linkedCourseIds: [],
  booked: false,
};
interface CourseFormState {
  courseId: string;
  courseName: string;
  provider: string;
  /** Reiner Zahlenwert IN der gewählten durationUnit — erst beim Speichern
   *  (siehe handleAddCourse) in Wochen umgerechnet, da das Backend
   *  ausschließlich duration_weeks kennt. */
  durationWeeks: string;
  durationUnit: "weeks" | "months";
  /** Freitext-Kursbeschreibung, optional — Grundlage für "Skills automatisch
   *  ermitteln" (siehe handleDetectManualSkills). */
  description: string;
  /** Optionale Zielrollen, denen dieser Kurs zugeordnet wird — rein
   *  informativ, mehrere gleichzeitig möglich, siehe target_role_ids in
   *  orbit.ts (target_role_id bleibt zusätzlich als erste Rolle gesetzt,
   *  für ein Backend, das nur das Einzelfeld kennt). */
  targetRoleIds: string[];
  /** Bereich/Kategorie — mind. 1 PFLICHTFELD (anders als targetRoleIds
   *  oben), mehrere gleichzeitig möglich (15.09., "soll auch bei mehreren
   *  Bereichen gehen, falls es eine allgemeine Weiterbildung ist") — siehe
   *  bereich_keys in orbit.ts. Leer = noch nichts gewählt, blockt das
   *  Speichern (siehe handleAddCourse-Validierung). */
  bereichKeys: string[];
  /** Durchführungsort — siehe location/is_remote/location_mode in orbit.ts.
   *  "remote" = reines Online-Format (location wird beim Speichern
   *  ignoriert), "vor_ort" = ausschließlich am angegebenen Ort, "hybrid" =
   *  beides gleichzeitig möglich (location bleibt relevant). */
  location: string;
  locationMode: "remote" | "vor_ort" | "hybrid";
  /** Beschäftigungsart, zu der dieser Kurs passt (Version 25) — siehe
   *  employment_mode in orbit.ts. Genau wie locationMode ein Toggle mit
   *  immer aktivem Wert (kein leerer Zustand möglich), damit das Feld für
   *  jeden Kurs echtes Pflichtfeld ist und das Präferenz-Matching gegen
   *  Vollzeit/Teilzeit aus dem Journey-"Präferenzen"-Schritt verlässlich
   *  funktioniert. */
  employmentMode: "vollzeit" | "teilzeit" | "beides";
  /** Echtes Startdatum (YYYY-MM-DD, leer = nicht gesetzt) — Grundlage für
   *  das "Startet in Kürze"-Banner, siehe courseBadges() in ../data/courseBadges.tsx.
   *  Bewusst ein echtes Datum statt eines manuellen Schalters. */
  startsAt: string;
  /** Tatsächlich verbleibende Plätze, leer = nicht gesetzt/keine Aussage.
   *  Grundlage für das "Nur noch X Plätze"-Banner. */
  seatsRemaining: string;
  /** Frei formulierbarer Zusatz-Hinweis fürs Kurs-Banner, z.B. "Neu im Programm". */
  customBanner: string;
  /**
   * Preis-/Förder-/Abschluss-Felder (Version 32, 14.09. — siehe ausführlichen
   * Kommentar an denselben Feldern bei OrbitCourse in orbit.ts, aus der
   * vorangegangenen IHK-Bildungszentren-Recherche). Alle als reine Strings
   * im Formular gehalten (gleiches Muster wie durationWeeks/seatsRemaining
   * oben) — erst beim Speichern (handleAddCourse) in Zahlen/Booleans
   * umgewandelt, damit ein leeres Eingabefeld nicht schon waehrend der
   * Eingabe als "0" erzwungen wird.
   */
  priceEur: string;
  priceVatExempt: boolean;
  examFeeEur: string;
  teachingUnits: string;
  fundingTypes: FundingType[];
  fundingMeasureNumber: string;
  qualificationType: QualificationType | "";
  dqrLevel: string;
  targetGroup: string;
}
/** Fördermöglichkeiten (siehe FundingType/funding_types in orbit.ts) — ein
 *  Kurs kann mehrere gleichzeitig erfüllen, deshalb Checkbox-Mehrfachauswahl
 *  statt Toggle wie bei locationMode/employmentMode. */
const FUNDING_TYPE_OPTIONS: { key: FundingType; label: string }[] = [
  { key: "bildungsgutschein", label: "Bildungsgutschein (AZAV)" },
  { key: "aufstiegs_bafoeg", label: "Aufstiegs-BAföG" },
  { key: "laenderfoerderung", label: "Landesförderung (z.B. Bildungsscheck)" },
  { key: "bildungsurlaub", label: "Bildungsurlaub-anerkannt" },
];
/** Abschlussarten nach dem IHK-Schema (siehe qualification_type in orbit.ts). */
const QUALIFICATION_TYPE_OPTIONS: { key: QualificationType; label: string }[] = [
  { key: "seminarzertifikat", label: "Seminarzertifikat (bis 49 UE)" },
  { key: "lehrgangszertifikat", label: "Lehrgangszertifikat (ab 50 UE)" },
  { key: "ihk_pruefung", label: "IHK-Prüfung" },
  { key: "sonstiger_abschluss", label: "Sonstiger Abschluss" },
];
/** Vorschläge für den freien Banner-Text im Quick-Picker auf der Kurskachel
 *  (siehe "Dein Kurskatalog") — reiner Textbaustein, kein zusätzlicher
 *  Anspruch wie bei starts_at/seats_remaining, deshalb hier unkritisch. */
const BANNER_PRESETS = ["🔥 Beliebt", "🆕 Neu im Programm", "⚡ Nur kurze Zeit"];
/** Bereichs-Katalog fürs Kursformular (Pflichtfeld bereichKey, siehe
 *  CourseFormState) — dieselbe echte bereich_key/-label-Quelle wie in
 *  JourneyPage.tsx (BEREICH_OPTIONS dort), damit beide Seiten garantiert
 *  dieselben Werte kennen. */
const BEREICH_OPTIONS = listBereiche();
/** Rein lokale, automatische Bereichs-Vorschläge aus Kursname/-beschreibung
 *  (15.09., "eigentlich sollte das direkt automatisch gehen") — bewusst OHNE
 *  Aufruf der externen course-url-import Edge Function (die kennt den
 *  51-Rollen/6-Bereiche-Katalog gar nicht, liegt ausserhalb dieses Repos und
 *  müsste separat angepasst/redeployed werden). Nutzt stattdessen dieselbe
 *  lokale Skill-Erkennung wie "Skills automatisch ermitteln"
 *  (matchSkills()), zählt pro Bereich das Gewicht der getroffenen Skills
 *  über ROLES_CATALOG und schlägt vor — nie automatisch gesetzt, nur als
 *  anklickbarer Vorschlag (gleiches Prinzip wie targetRoleSuggestions
 *  oben), damit nichts unbemerkt "erraten" wird. Bereiche mit mind. 50% des
 *  Spitzenwerts werden mit vorgeschlagen (deckt "allgemeine Weiterbildung,
 *  die in mehrere Bereiche passt" ab), maximal 3. */
function suggestBereicheForText(text: string): string[] {
  if (text.trim().length < MIN_DESCRIPTION_FOR_SKILL_DETECT) return [];
  const matches = matchSkills(text, { maxResults: 30, minScore: 60 });
  const matchedSkillIds = new Set(matches.map((m) => m.skill_id));
  if (matchedSkillIds.size === 0) return [];
  const scoreByBereich = new Map<string, number>();
  for (const role of ROLES_CATALOG) {
    for (const s of role.skills) {
      if (matchedSkillIds.has(s.skill_id)) {
        scoreByBereich.set(role.bereich_key, (scoreByBereich.get(role.bereich_key) ?? 0) + s.weight);
      }
    }
  }
  const sorted = [...scoreByBereich.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return [];
  const top = sorted[0][1];
  return sorted
    .filter(([, score]) => score >= top * 0.5)
    .slice(0, 3)
    .map(([key]) => key);
}
const DEFAULT_COURSE_FORM: CourseFormState = {
  courseId: "",
  courseName: "",
  provider: "",
  durationWeeks: "4",
  durationUnit: "weeks",
  description: "",
  targetRoleIds: [],
  bereichKeys: [],
  location: "",
  locationMode: "remote",
  employmentMode: "beides",
  startsAt: "",
  seatsRemaining: "",
  customBanner: "",
  priceEur: "",
  priceVatExempt: false,
  examFeeEur: "",
  teachingUnits: "",
  fundingTypes: [],
  fundingMeasureNumber: "",
  qualificationType: "",
  dqrLevel: "",
  targetGroup: "",
};
/** Mindestlänge, ab der eine Kursbeschreibung überhaupt an die automatische
 *  Skill-Erkennung geschickt wird — bei ein paar Wörtern liefert das
 *  Fuzzy-Matching (siehe skill_matcher.py) ohnehin nur Zufallstreffer. */
const MIN_DESCRIPTION_FOR_SKILL_DETECT = 15;
/**
 * Beispiel-Inhalt für den "Kurs manuell anlegen"-Schritt des Rundgangs (siehe
 * tourStepSelector-Effekt weiter unten) — wird NUR während der Tour ins
 * echte Formular eingesetzt, rein zur Anschauung. Nutzt bewusst dieselbe
 * echte "Skills automatisch ermitteln"-Funktion mit dieser Beispieltext, statt
 * erfundene Skill-Treffer zu zeigen (Projekt-Prinzip "keine erfundenen
 * Zahlen/Fakten", siehe Kommentar bei skillImportance in JourneyPage.tsx).
 */
const EXAMPLE_COURSE_FORM: CourseFormState = {
  courseId: "excel-grundlagen-beispiel",
  courseName: "Excel Grundlagen (Beispiel)",
  provider: "Muster Akademie GmbH",
  durationWeeks: "4",
  durationUnit: "weeks",
  description:
    "Grundlagen von Excel: Tabellen, Formeln, einfache Diagramme und Datenanalyse für den Büroalltag.",
  targetRoleIds: [],
  bereichKeys: ["wirtschaft"],
  location: "",
  locationMode: "remote",
  employmentMode: "beides",
  startsAt: "",
  seatsRemaining: "",
  customBanner: "",
  priceEur: "",
  priceVatExempt: false,
  examFeeEur: "",
  teachingUnits: "",
  fundingTypes: [],
  fundingMeasureNumber: "",
  qualificationType: "",
  dqrLevel: "",
  targetGroup: "",
};
/** Beispiel-CSV-Inhalt für den "Kurse per CSV importieren"-Schritt des
 *  Rundgangs — dieselbe Struktur wie downloadImportTemplate() oben, aber mit
 *  eigenen Beispielkursen, damit sich beide Tour-Beispiele nicht überschneiden. */
const EXAMPLE_CSV_HEADERS = ["Kurs-ID", "Kursname", "Anbieter", "Dauer", "Beschreibung"];
const EXAMPLE_CSV_ROWS: string[][] = [
  [
    "",
    "SQL für Einsteiger",
    "Muster Akademie GmbH",
    "6",
    "Einstieg in Datenbanken und SQL — Abfragen schreiben, Daten filtern und auswerten.",
  ],
  [
    "",
    "Projektmanagement Basics",
    "Muster Akademie GmbH",
    "5 Wochen",
    "Grundlagen des klassischen und agilen Projektmanagements: Planung, Zeitmanagement, Teamkoordination.",
  ],
];
const MIN_PROFILE_TEXT_LENGTH = 10;
// ---------- Kurs-CSV-Import ----------
//
// Es gibt keinen Bulk-Import-Endpunkt im Backend — der Import laeuft als
// sequenzielle Kette von Aufrufen des bereits vorhandenen Upsert-Endpunkts
// (POST /api/v1/orbit/courses, upsert-nach-course_id, siehe upsertCourse()).
//
// Skills werden NICHT blind aus einem Namens-Abgleich uebernommen (das haette
// dasselbe Fehlerrisiko wie der SQL-Skill-Abgleich dieser Session, siehe
// resolve_skills_v3.sql-Bug) — stattdessen optional ueber eine eigene
// Beschreibungs-Spalte: gibt es Beschreibungstext, laesst sich er sich per
// Klick durch denselben lokalen Katalog-Matcher schicken, den auch der
// Lebenslauf-Abgleich der Journey nutzt (matchSkillsLocal, siehe
// handleDetectImportSkills unten) — Ergebnis sind VORSCHLAEGE, die vor dem
// eigentlichen Import als Chips sichtbar und einzeln entfernbar sind (siehe
// importApprovedSkillUris). Ohne Beschreibungs-Spalte oder bei laengeren
// unklaren Texten bleibt der bisherige Weg: Skills nach dem Import ueber
// "✎ Bearbeiten" zuordnen.
interface ImportMapping {
  courseId: number;
  courseName: number;
  provider: number;
  durationWeeks: number;
  /** Optionale Spalte mit Kursbeschreibung — Grundlage für die automatische
   *  Skill-Erkennung (siehe handleDetectImportSkills). -1 = keine Zuordnung. */
  description: number;
  /**
   * Weitere optionale Spalten (Version 32, 14.09.) — siehe die gleichnamigen
   * Formularfelder/OrbitCourse-Felder. Bewusst NUR die vier reinen
   * Text-/Zahlen-Spalten, die sich 1:1 wie durationWeeks/description auf
   * EINE Spalte abbilden lassen. Mehrwertige/typisierte Felder
   * (funding_types als Mehrfachauswahl, qualification_type als feste
   * Auswahl, price_vat_exempt als Ja/Nein-Schalter, dqr_level als
   * 1-8-Auswahl) bleiben bewusst NUR im manuellen Formular editierbar —
   * ein einzelner freier CSV-Text würde bei denen zu viel Rateraum lassen
   * ("Bildungsgutschein" vs. "AZAV" vs. "ja" könnten alle dieselbe Spalte
   * meinen), lieber gar nicht importieren als falsch zuordnen.
   */
  priceEur: number;
  teachingUnits: number;
  fundingMeasureNumber: number;
  targetGroup: number;
}
const DEFAULT_IMPORT_MAPPING: ImportMapping = {
  courseId: -1,
  courseName: -1,
  provider: -1,
  durationWeeks: -1,
  description: -1,
  priceEur: -1,
  teachingUnits: -1,
  fundingMeasureNumber: -1,
  targetGroup: -1,
};
interface ImportRowResult {
  index: number;
  courseId: string;
  courseName: string;
  provider: string;
  durationWeeks: number | null;
  description: string;
  priceEur: number | null;
  teachingUnits: number | null;
  fundingMeasureNumber: string;
  targetGroup: string;
  valid: boolean;
  reason?: string;
  willUpdate: boolean;
}
/** Wandelt einen Kursnamen in eine URL-/ID-taugliche Kurs-ID um — genutzt beim
 * Import, wenn die Quelldatei keine eigene ID-Spalte mitbringt (viele
 * Bildungstraeger-Exporte, z.B. aus einer einfachen Excel-Liste, haben keine
 * stabile Kurs-ID, nur einen Titel). */
function slugifyCourseId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "kurs";
}
/** Erkennt gaengige Dauer-Schreibweisen aus Bildungstraeger-Exporten (reine
 * Zahl = Wochen, "X Monate"/"X Tage"/"X Std." werden umgerechnet) und liefert
 * die Dauer in Wochen, oder null wenn nichts Sinnvolles erkennbar ist. */
function parseDurationWeeks(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  const match = s.match(/[\d.]+/);
  const num = match ? parseFloat(match[0]) : NaN;
  if (!Number.isFinite(num) || num <= 0) return null;
  if (/monat/.test(s)) return Math.max(1, Math.round(num * 4.345));
  if (/tag/.test(s)) return Math.max(1, Math.round(num / 7));
  if (/(std\.|stunde)/.test(s)) return Math.max(1, Math.round(num / 20)); // grobe Annahme: ~20 Std./Woche
  return Math.max(1, Math.round(num)); // Standardannahme: Wochen
}
/** Minimaler, abhaengigkeitsfreier CSV-Parser (bewusst ohne npm-Paket wie
 * papaparse, siehe Kommentar in DashboardTour.tsx zum schlanken Frontend):
 * erkennt Komma oder Semikolon als Trennzeichen (deutsches Excel exportiert
 * standardmaessig mit Semikolon) und versteht in Anfuehrungszeichen gesetzte
 * Felder inkl. enthaltener Kommas/Zeilenumbrueche. */
function parseCsv(text: string): string[][] {
  const cleaned = text.replace(/^﻿/, "");
  const firstLine = cleaned.split("\n")[0] ?? "";
  const delimiter = (firstLine.split(";").length ?? 0) > (firstLine.split(",").length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inQuotes) {
      if (c === '"') {
        if (cleaned[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && cleaned[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  return rows;
}
const IMPORT_HEADER_GUESSES: Record<keyof ImportMapping, string[]> = {
  courseId: ["kurs-id", "kursid", "id", "course_id", "kursnummer", "nummer"],
  courseName: ["kursname", "titel", "name", "course_name", "bezeichnung", "maßnahme", "massnahme"],
  provider: ["anbieter", "provider", "träger", "traeger", "bildungsträger"],
  durationWeeks: ["dauer", "duration", "wochen", "laufzeit"],
  description: ["beschreibung", "description", "kursinhalt", "inhalt", "kurzbeschreibung"],
  priceEur: ["preis", "kursgebühr", "kursgebuehr", "gebühr", "gebuehr", "kosten", "price"],
  teachingUnits: ["ue", "unterrichtseinheiten", "unterrichtsstunden", "stunden"],
  fundingMeasureNumber: ["maßnahmenummer", "massnahmennummer", "maßnahmen-nr", "azav-nummer"],
  targetGroup: ["zielgruppe", "voraussetzungen", "target_group"],
};
function guessImportMapping(headers: string[]): ImportMapping {
  const lower = headers.map((h) => h.trim().toLowerCase());
  function find(keys: string[]): number {
    const exact = lower.findIndex((h) => keys.includes(h));
    if (exact !== -1) return exact;
    const partial = lower.findIndex((h) => keys.some((k) => h.includes(k)));
    return partial;
  }
  return {
    courseId: find(IMPORT_HEADER_GUESSES.courseId),
    courseName: find(IMPORT_HEADER_GUESSES.courseName),
    provider: find(IMPORT_HEADER_GUESSES.provider),
    durationWeeks: find(IMPORT_HEADER_GUESSES.durationWeeks),
    description: find(IMPORT_HEADER_GUESSES.description),
    priceEur: find(IMPORT_HEADER_GUESSES.priceEur),
    teachingUnits: find(IMPORT_HEADER_GUESSES.teachingUnits),
    fundingMeasureNumber: find(IMPORT_HEADER_GUESSES.fundingMeasureNumber),
    targetGroup: find(IMPORT_HEADER_GUESSES.targetGroup),
  };
}
function downloadImportTemplate() {
  const csv =
    "Kurs-ID;Kursname;Anbieter;Dauer;Beschreibung\n" +
    ';Excel Grundlagen;Muster Akademie GmbH;4 Wochen;"Grundlagen von Excel: Tabellen, Formeln, einfache Diagramme und Datenanalyse für den Büroalltag."\n' +
    ';SQL für Einsteiger;Muster Akademie GmbH;6;"Einstieg in Datenbanken und SQL - Abfragen schreiben, Daten filtern und auswerten."\n';
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kurse-vorlage.csv";
  a.click();
  URL.revokeObjectURL(url);
}
function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[1]?.[0] ?? "" : "";
  const result = (first + second).toUpperCase();
  return result || "?";
}
/** Formatiert created_at (ISO-String vom Backend) fürs Lead-Card — kurz und
 * auf einen Blick lesbar (z.B. "3. Sep., 14:32"), kein voller Zeitstempel.
 * Robust gegen fehlende/ungültige Werte, damit ein älteres Backend ohne
 * created_at die Karte nicht kaputt macht. */
function formatLeadDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const datePart = d.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
  const timePart = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return `${datePart}, ${timePart}`;
}
/** Heutiges Datum als "YYYY-MM-DD" — Startwert fürs Termin-Datum-Feld
 * (siehe consultation_scheduled_for), wenn "Vereinbart" frisch angehakt
 * wird; direkt danach im <input type="date"> frei änderbar. */
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Spiegelt START_OPTIONS aus JourneyPage.tsx (Version 15) — dort wählt die
 * Person im Kurs-Schritt grob, wie dringlich ihr Anliegen ist. Bewusst hier
 * dupliziert statt importiert, damit DashboardPage und JourneyPage
 * unabhängig voneinander bleiben (keine Seite importiert von der anderen);
 * bei einer Änderung der Optionen dort muss diese Liste mitgezogen werden. */
const DESIRED_START_LABELS: Record<string, string> = {
  asap: "So schnell wie möglich",
  "4-wochen": "In den nächsten 4 Wochen",
  "1-3-monate": "In 1–3 Monaten",
  offen: "Weiß noch nicht",
};
/** Spiegelt EMPLOYMENT_OPTIONS aus JourneyPage.tsx (Version 24, neuer
 * "Präferenzen"-Schritt) — bewusst dupliziert statt importiert, siehe
 * Kommentar bei DESIRED_START_LABELS oben. */
const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  vollzeit: "Vollzeit",
  teilzeit: "Teilzeit",
  egal: "Egal",
};
/** Spiegelt LOCATION_OPTIONS aus JourneyPage.tsx (Version 24; "egal" seit
 *  Version 26 — eine ausdrueckliche "keine Praeferenz"-Antwort, siehe
 *  Kommentar bei EMPLOYMENT_OPTIONS/LOCATION_OPTIONS dort). */
const WORK_LOCATION_LABELS: Record<string, string> = {
  remote: "Remote",
  "vor-ort": "Vor Ort",
  egal: "Egal",
};
/** Spiegelt FUNDING_OPTIONS aus JourneyPage.tsx (Version 32, 14.09.) —
 *  bewusst dupliziert statt importiert, siehe Kommentar bei
 *  DESIRED_START_LABELS oben. */
const FUNDING_PREFERENCE_LABELS: Record<string, string> = {
  gefoerdert: "Förderung wichtig",
  egal: "Egal",
};
/** Labels für Kurs-locationMode/-employmentMode (orbit.ts: LocationMode/
 *  EmploymentMode) — bewusst EIGENE Maps statt WORK_LOCATION_LABELS/
 *  EMPLOYMENT_TYPE_LABELS oben: unterschiedlicher Wertebereich (Kurse kennen
 *  zusätzlich "hybrid"/"beides", und location_mode schreibt "vor_ort" mit
 *  Unterstrich statt "vor-ort" wie beim Lead-Feld). Nur fürs Kurskatalog-
 *  Listing gedacht (siehe course-manage-card unten) — das Formular selbst
 *  zeigt die Optionen direkt über die Toggle-Buttons. */
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
// Server-Adresse aus VITE_SUPABASE_URL ableiten, statt localhost:8000 fest zu
// verdrahten — sonst zeigt das Verbindungspanel eine Adresse an, die es in
// Bolt (oder jedem echten Deployment) nie geben kann, und "Verbinden" schlägt
// immer fehl, egal welcher API-Key eingetragen ist. Exakt dasselbe Muster wie
// DEFAULT_API_BASE in JourneyPage.tsx.
const SUPABASE_URL: string = (import.meta.env?.VITE_SUPABASE_URL as string | undefined) ?? "";
const DEFAULT_ORBIT_API_BASE: string = SUPABASE_URL
  ? `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/api`
  : "http://127.0.0.1:8000";
/**
 * Version 27 — merkt sich Server-Adresse/API-Key aus dem Verbindungs-Panel
 * in localStorage, damit ein einmal eingetragener Zugangsschlüssel einen
 * Seiten-Reload UEBERLEBT. Besonders wichtig hier: defaultApiKey ist bewusst
 * LEER vorbelegt (siehe Kommentar dort, Sicherheitsgrund) — ohne Persistenz
 * bedeutete jeder Reload (z.B. wenn die Bolt-Vorschau selbst neu startet)
 * "abgemeldet": Schlüssel weg, von Hand neu eintippen, alle paar Minuten.
 * Gleiches Muster/derselbe Grund wie in JourneyPage.tsx — bewusst eigener,
 * eigenstaendiger Storage-Key, damit sich Dashboard- und Journey-Verbindung
 * nie gegenseitig ueberschreiben. try/catch: privates Fenster/blockierter
 * Storage darf nur die Persistenz kosten, nie die Seite selbst. */
const DASHBOARD_CONNECTION_STORAGE_KEY = "dyd-orbit-dashboard-connection";
function readStoredDashboardConnection(): { baseUrl?: string; apiKey?: string } {
  try {
    const raw = localStorage.getItem(DASHBOARD_CONNECTION_STORAGE_KEY);
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
function writeStoredDashboardConnection(baseUrl: string, apiKey: string) {
  try {
    localStorage.setItem(DASHBOARD_CONNECTION_STORAGE_KEY, JSON.stringify({ baseUrl, apiKey }));
  } catch {
    // Storage blockiert/voll — Persistenz faellt still weg, Seite laeuft normal weiter.
  }
}
interface DashboardPageProps {
  /** Name des Bildungsträger-Mandanten, wie er in der Sidebar angezeigt wird (Whitelabel-Tenant). */
  tenantName?: string;
  /** Logo-URL des Mandanten. Ohne Angabe wird der "?"-Platzhalter angezeigt. */
  tenantLogoUrl?: string | null;
  /** Server-Adresse, mit der automatisch verbunden wird. */
  defaultBaseUrl?: string;
  /**
   * Zugangsschlüssel des Bildungsträgers (Rolle "operator"). Bewusst LEER
   * vorbelegt: ein im Auslieferungspaket mitgelieferter Schlüssel wäre für
   * jeden Besucher der Seite lesbar und würde damit die komplette Lead-Liste
   * inklusive Kontaktdaten öffentlich machen. Der Bildungsträger trägt ihn
   * im Verbindungs-Panel ein.
   */
  defaultApiKey?: string;
  /**
   * Zeigt das Entwickler-Panel (Server-Adresse/API-Key manuell eintragen) sowie den
   * "Noch kein echtes Deployment"-Banner. Für echte Bildungsträger-Kunden auf `false`
   * setzen — dann wird beim Laden automatisch mit `defaultBaseUrl`/`defaultApiKey`
   * verbunden, ohne dass der Kunde je eine Server-Adresse oder einen rohen API-Key sieht.
   * Default: an, solange im Vite-Dev-Server (`npm run dev`) entwickelt wird.
   */
  showConnectionPanel?: boolean;
}
/**
 * Interface A: die Bildungsträger-/Operator-Seite (React-Fassung von
 * orbit-dashboard-preview.html). Zeigt echte Daten der eigenen API — keine
 * erfundenen Zahlen. Läuft nur, solange der deployte Server erreichbar ist
 * (lokal: "Verbinden & laden" klicken; im Whitelabel-Modus: automatisch).
 */
export function DashboardPage({
  tenantName = "Beispiel Bildungsträger GmbH",
  tenantLogoUrl = null,
  defaultBaseUrl = DEFAULT_ORBIT_API_BASE,
  defaultApiKey = "",
  showConnectionPanel = Boolean(import.meta.env?.DEV ?? true) || !defaultApiKey,
}: DashboardPageProps = {}) {
  // Version 27: Startwert zuerst aus localStorage (siehe
  // readStoredDashboardConnection oben), erst wenn dort nichts hinterlegt
  // ist, aus defaultBaseUrl/defaultApiKey.
  const [baseUrl, setBaseUrl] = useState(() => readStoredDashboardConnection().baseUrl ?? defaultBaseUrl);
  const [apiKey, setApiKey] = useState(() => readStoredDashboardConnection().apiKey ?? defaultApiKey);
  // Haelt beide Werte bei jeder Aenderung in localStorage nach — so
  // uebersteht ein einmal eingetragener Schluessel auch einen Reload.
  useEffect(() => {
    writeStoredDashboardConnection(baseUrl, apiKey);
  }, [baseUrl, apiKey]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [tab, setTab] = useState<Tab>("leads");
  const [tourOpen, setTourOpen] = useState(false);
  // Selector des gerade aktiven Tour-Schritts (siehe onStepChange an
  // <DashboardTour>) — steuert die Live-Beispiele beim Kurse-Schritt weiter
  // unten (manualExampleAppliedRef/csvExampleAppliedRef-Effekte).
  const [tourStepSelector, setTourStepSelector] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [connStatus, setConnStatus] = useState<{ msg: string; kind: StatusKind }>({ msg: "", kind: "" });
  const [connecting, setConnecting] = useState(false);
  const [roles, setRoles] = useState<TargetRole[]>([]);
  const [leads, setLeads] = useState<LeadResponse[]>([]);
  const [courses, setCourses] = useState<OrbitCourse[]>([]);
  const [report, setReport] = useState<OrbitReportResponse | null>(null);
  const [leadForm, setLeadForm] = useState<LeadFormState>(DEFAULT_LEAD_FORM);
  const [leadFormStatus, setLeadFormStatus] = useState<{ msg: string; kind: StatusKind }>({ msg: "", kind: "" });
  const [leadFormCourseQuery, setLeadFormCourseQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [bookingBusyId, setBookingBusyId] = useState<string | null>(null);
  // Analog zu bookingBusyId, aber fürs "Durchgeführt"-Häkchen beim
  // Beratungsgespräch (siehe handleToggleConsultationCompleted unten).
  const [consultationBusyId, setConsultationBusyId] = useState<string | null>(null);
  // Analog, aber fürs Termin-Datum (siehe handleSetConsultationScheduled unten).
  const [consultationScheduleBusyId, setConsultationScheduleBusyId] = useState<string | null>(null);
  // Analog zu bookingBusyId, aber fürs endgültige Löschen eines Leads
  // (Version 28, Recht auf Löschung / Art. 17 DSGVO — siehe handleDeleteLead
  // unten).
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  // ---------- Lead-Detailansicht (Version 23) ----------
  // Klick auf einen Lead-Namen öffnet die Detailansicht statt nur die
  // Kompaktkarte zu zeigen — siehe LeadDetailModal weiter unten. null = zu.
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [assignBusyId, setAssignBusyId] = useState<string | null>(null);
  const [enableConsultationBusyId, setEnableConsultationBusyId] = useState<string | null>(null);
  const [linkedCoursesBusyId, setLinkedCoursesBusyId] = useState<string | null>(null);
  // Suchfeld im Kurs-Verlinken-Picker der Detailansicht.
  const [courseLinkQuery, setCourseLinkQuery] = useState("");
  // Anbieter wird mit dem Mandanten vorbelegt, der auch für den API-Key/
  // Whitelabel-Zugang eingetragen ist (tenantName) — als sinnvoller
  // Standardwert, aber frei änderbar (z.B. bei einer Tochtermarke desselben
  // Mandanten). Pflichtfeld bleibt es trotzdem, siehe Speichern-Button unten.
  // Deshalb hier per Lazy-Initializer aus der Prop gesetzt statt aus
  // DEFAULT_COURSE_FORM.
  const [courseForm, setCourseForm] = useState<CourseFormState>(() => ({ ...DEFAULT_COURSE_FORM, provider: tenantName }));
  const [courseFormStatus, setCourseFormStatus] = useState<{ msg: string; kind: StatusKind }>({ msg: "", kind: "" });
  const [savingCourse, setSavingCourse] = useState(false);
  // Kurzes Bestaetigungs-Popup beim Speichern (siehe handleAddCourse) —
  // zusaetzlich zum bestehenden courseFormStatus-Text im Formular, da dieser
  // beim URL-Import durch resetCourseForm()/den naechsten Ladeschritt schnell
  // wieder verschwindet bzw. ueberschrieben wird, bevor der Mensch ihn
  // bewusst wahrnimmt. Verschwindet nach kurzer Zeit von selbst.
  const [courseSaveToast, setCourseSaveToast] = useState<string | null>(null);
  useEffect(() => {
    if (!courseSaveToast) return;
    const t = window.setTimeout(() => setCourseSaveToast(null), 2400);
    return () => window.clearTimeout(t);
  }, [courseSaveToast]);
  const [featuredBusyId, setFeaturedBusyId] = useState<string | null>(null);
  // Busy-State für den Banner-Quick-Picker direkt auf der Kurskachel (siehe
  // handleUpdateBanner unten) — dieselbe Idee wie featuredBusyId, nur für
  // starts_at/seats_remaining/custom_banner statt is_featured.
  const [bannerBusyId, setBannerBusyId] = useState<string | null>(null);
  // Fehler-/Hinweistext direkt am Banner-Quick-Picker (statt nur im weit
  // entfernten courseFormStatus oben im Kursformular, das man bei einem
  // Klick auf der Kurskachel unten nie sieht) — siehe handleUpdateBanner.
  const [bannerError, setBannerError] = useState<{ id: string; msg: string } | null>(null);
  // Skill-Zuordnung fuer den Kurs im Formular (kritischer Fix, siehe
  // kritische-prozess-analyse.md): OHNE diese Zuordnung kann das
  // Matching-System einen selbst angelegten Kurs NIE als persoenliche
  // Empfehlung ausspielen, egal wie gut er passen wuerde — covered_skill_uris
  // war im Formular bisher schlicht nicht editierbar. courseSkillUris ist die
  // tatsaechliche Auswahl (wird beim Speichern mitgeschickt); skillLabelCache
  // sammelt die Klartext-Labels JEDER bisher im Formular durchsuchten
  // Zielrolle, damit auch beim Bearbeiten eines bestehenden Kurses (dessen
  // covered_skill_uris nur rohe URIs sind) lesbare Chips angezeigt werden
  // koennen, sobald die passende Rolle einmal durchsucht wurde.
  const [courseSkillUris, setCourseSkillUris] = useState<Set<string>>(new Set());
  const [skillLabelCache, setSkillLabelCache] = useState<Record<string, string>>({});
  const [skillPickerRoleId, setSkillPickerRoleId] = useState("");
  const [skillPickerSkills, setSkillPickerSkills] = useState<RoleSkillStatus[]>([]);
  const [skillPickerLoading, setSkillPickerLoading] = useState(false);
  const [skillPickerError, setSkillPickerError] = useState<string | null>(null);
  // Automatische Skill-Erkennung aus der Kursbeschreibung (siehe
  // handleDetectManualSkills): Vorschlaege landen NICHT direkt in
  // courseSkillUris, sondern hier — erst ein bewusster Klick ("+ übernehmen"
  // an jedem Vorschlags-Chip, oder "Alle übernehmen") schiebt sie in die
  // tatsaechliche, gespeicherte Zuordnung. Das ist die "Freigabe" durch den
  // Mitarbeiter; wer nichts uebernimmt, ordnet Skills wie bisher ueber den
  // Zielrollen-Picker oben zu.
  const [manualSuggestedSkills, setManualSuggestedSkills] = useState<MatchedSkill[]>([]);
  const [manualSkillDetectBusy, setManualSkillDetectBusy] = useState(false);
  const [manualSkillDetectError, setManualSkillDetectError] = useState<string | null>(null);
  // KI-Tiefenanalyse fuer die Kurs-Skill-Erkennung (siehe handleDetectSkillsWithAI
  // weiter unten): ergaenzt handleDetectManualSkills um dieselbe
  // "cv-depth-analysis"-Function, die JourneyPage.tsx schon fuer Lebenslaeufe
  // nutzt — statt nur woertliche/fuzzy Treffer gegen den Skill-Katalog zu
  // suchen, liest die KI die Kursbeschreibung inhaltlich und erkennt auch
  // Skills, die nur UMSCHRIEBEN vorkommen (z.B. "Daten professionell
  // auswerten" -> SQL/Excel/Datenanalyse), was reines Substring-/Fuzzy-
  // Matching strukturell nicht kann. Braucht dafuer mindestens eine
  // ausgewaehlte Zielrolle (courseForm.targetRoleIds), weil die Function pro
  // Aufruf die Kern-Skills EINER Rolle bewertet — ohne Zielrolle gibt es
  // keine sinnvolle Skill-Menge, die geprueft werden koennte.
  const [aiSkillDetectBusy, setAiSkillDetectBusy] = useState(false);
  const [aiSkillDetectError, setAiSkillDetectError] = useState<string | null>(null);
  // Erfahrungslevel je zugeordnetem Skill (siehe ExperienceLevel in core.ts) —
  // Key ist die ESCO-URI, wie in courseSkillUris. Wird beim Übernehmen eines
  // Vorschlags (approveManualSuggestedSkill) bzw. beim manuellen Ankreuzen
  // (toggleCourseSkillUri) per lokaler Heuristik (guessExperienceLevel)
  // vorbelegt und bleibt danach über die Level-Chips in der UI frei
  // veränderbar — siehe handleRefineSkillLevels für die optionale
  // KI-Verfeinerung.
  const [courseSkillLevels, setCourseSkillLevels] = useState<Record<string, ExperienceLevel>>({});
  const [levelRefineBusy, setLevelRefineBusy] = useState(false);
  const [levelRefineError, setLevelRefineError] = useState<string | null>(null);
  // Live-ESCO-Suche im Kursformular (siehe handleSkillSearch weiter unten) —
  // unabhaengig von der Beschreibungs-basierten Erkennung: hier tippt die
  // Person direkt einen Skill-Namen und bekommt sofort echte Treffer aus der
  // ESCO-Datenbank zum Hinzufuegen, ohne Umweg ueber Kurstext oder Zielrolle.
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [skillSearchResults, setSkillSearchResults] = useState<MatchedSkill[]>([]);
  const [skillSearchBusy, setSkillSearchBusy] = useState(false);
  const [skillSearchError, setSkillSearchError] = useState<string | null>(null);
  // Zielrollen-Vorschlaege (siehe suggestTargetRoles weiter unten): rankt alle
  // Zielrollen per Gap-Analyse gegen den aktuellen Kurstext und zeigt die
  // besten Treffer als anklickbare Chips ueber dem Zielrollen-Select.
  const [targetRoleSuggestions, setTargetRoleSuggestions] = useState<{ role: TargetRole; percentage: number }[]>([]);
  const [targetRoleSuggestBusy, setTargetRoleSuggestBusy] = useState(false);
  /** True sobald fuer den AKTUELLEN Kurstext einmal ein Zielrollen-Abgleich
   *  durchgelaufen ist — anders als bei manualSkillDetectError gibt es hier
   *  kein "nichts gefunden"-Fehlerfeld (targetRoleSuggestions bleibt bei null
   *  Treffern einfach leer), daher separat verfolgt. Nur fuer die "Ladephase"-
   *  Fortschrittsanzeige beim URL-Import gebraucht (siehe
   *  url-import-progress-Schritt "Passende Zielrolle ermitteln" weiter unten). */
  const [targetRoleSuggestAttempted, setTargetRoleSuggestAttempted] = useState(false);
  // true, sobald der Nutzer die Bereichs-Auswahl selbst angefasst hat (Klick
  // auf Checkbox/Chip) ODER ein bestehender Kurs mit echten, gespeicherten
  // Bereichen geladen wurde (startEditCourse) — erst DANN hoert die Auswahl
  // auf, automatisch dem Text zu folgen (15.09., "soll auch schon
  // vorausgefüllt sein und veränderbar"). Vor dem ersten Anfassen bleibt sie
  // live an suggestBereicheForText() gekoppelt.
  const [bereichKeysTouched, setBereichKeysTouched] = useState(false);
  // Zielrollen-Auswahl als kompakte Combobox statt einer dauerhaft
  // ausgeklappten Checkbox-Liste (Version 24 — die Liste füllte bei vielen
  // Zielrollen die ganze Seite, siehe DASHBOARD_ZIELROLLEN_REDESIGN weiter
  // unten): roleComboQuery ist der Suchtext, roleComboOpen steuert, ob das
  // Ergebnis-Dropdown gerade sichtbar ist (nur bei Fokus/Eingabe, sonst
  // nimmt es keinen Platz ein). Ausgewählte Rollen erscheinen als Chips
  // über dem Eingabefeld, siehe role-chip-row.
  const [roleComboQuery, setRoleComboQuery] = useState("");
  const [roleComboOpen, setRoleComboOpen] = useState(false);
  // "+ Neue Zielrolle anlegen" — Mini-Formular direkt im Kurs-Formular
  // (Version 24). Braucht laut Backend (requireProduct(tenant, "admin"))
  // einen API-Key mit Produkt "admin" oder "all" — ein normaler
  // Bildungsträger-Key kann Zielrollen weiterhin nur lesen, das Anlegen
  // schlägt dann mit "Zugriff verweigert" fehl (kein Frontend-Bug).
  const [newRoleFormOpen, setNewRoleFormOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleSkillQuery, setNewRoleSkillQuery] = useState("");
  const [newRoleSkillResults, setNewRoleSkillResults] = useState<SkillSearchResult[]>([]);
  const [newRoleSkillSearchBusy, setNewRoleSkillSearchBusy] = useState(false);
  const [newRoleSelectedSkills, setNewRoleSelectedSkills] = useState<TargetRoleSkillInput[]>([]);
  const [newRoleBusy, setNewRoleBusy] = useState(false);
  const [newRoleError, setNewRoleError] = useState<string | null>(null);
  // KI-Vorschlag fuer die Kurzbeschreibung (siehe handleSuggestDescription) —
  // sowie der gemeinsame Modulhandbuch-Upload-Flow (siehe handleHandbookUpload):
  // beide nutzen dieselbe course-copy-assist-Function.
  const [descSuggestBusy, setDescSuggestBusy] = useState(false);
  const [descSuggestError, setDescSuggestError] = useState<string | null>(null);
  const [handbookFileName, setHandbookFileName] = useState("");
  const [handbookStage, setHandbookStage] = useState<"" | "reading" | "analyzing" | "matching" | "done">("");
  const [handbookError, setHandbookError] = useState<string | null>(null);
  const [handbookDragOver, setHandbookDragOver] = useState(false);
  // null = neuen Kurs anlegen, sonst course_id des gerade bearbeiteten Kurses
  // (siehe startEditCourse) — steuert u.a. Formular-Ueberschrift und
  // Erfolgsmeldung, die Kurs-ID selbst bleibt beim Bearbeiten unveraendert
  // (sonst wuerde aus einem Update versehentlich ein neuer Kurs).
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const courseFormRef = useRef<HTMLDetailsElement>(null);
  // Session-lokale Klick-Zählung ("welcher Kurs wird am meisten angesehen"). Nicht
  // dauerhaft gespeichert und nicht tenant-übergreifend — siehe Hinweis im Reports-Tab
  // und die Empfehlung, das analog zum bestehenden Test-Tracking im Backend nachzubauen.
  const [courseClicks, setCourseClicks] = useState<Record<string, number>>({});
  // Kurs-CSV-Import — siehe Kommentar bei den Helper-Funktionen oben.
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importDataRows, setImportDataRows] = useState<string[][]>([]);
  const [importMapping, setImportMapping] = useState<ImportMapping>(DEFAULT_IMPORT_MAPPING);
  const [importFileName, setImportFileName] = useState("");
  const [importParseError, setImportParseError] = useState<string | null>(null);
  // Steuert die Drag-over-Optik der CSV-Dropzone (siehe .csv-dropzone unten),
  // analog zu handbookDragOver bei der Modulhandbuch-Dropzone.
  const [csvDragOver, setCsvDragOver] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [importSummary, setImportSummary] = useState<{ ok: number; failed: number; errors: string[] } | null>(null);
  // Automatische Skill-Erkennung fuer den CSV-Import (siehe
  // handleDetectImportSkills): pro Zeilen-Index (ImportRowResult.index) die
  // gefundenen Vorschlaege sowie — anders als beim manuellen Formular — schon
  // VORAB uebernommene URIs (importApprovedSkillUris), da bei vielen Zeilen
  // ein Klick pro Skill zu muehsam waere. Trotzdem echte "Freigabe": jeder
  // Vorschlags-Chip laesst sich vor dem eigentlichen Import per "×" wieder
  // entfernen (toggleImportApprovedSkillUri), erst "X Kurse importieren"
  // schickt das Ergebnis tatsaechlich ab.
  const [importSkillSuggestions, setImportSkillSuggestions] = useState<Record<number, MatchedSkill[]>>({});
  const [importApprovedSkillUris, setImportApprovedSkillUris] = useState<Record<number, string[]>>({});
  const [importSkillDetectBusy, setImportSkillDetectBusy] = useState(false);
  const [importSkillDetectProgress, setImportSkillDetectProgress] = useState({ done: 0, total: 0 });
  const [importSkillDetectError, setImportSkillDetectError] = useState<string | null>(null);
  // Erfahrungslevel je Import-Zeile + Skill (siehe courseSkillLevels oben) —
  // äußerer Key ist der Zeilen-Index (ImportRowResult.index), innerer die
  // ESCO-URI. Wird beim automatischen Erkennen (handleDetectImportSkills) per
  // Heuristik vorbelegt und bleibt über die Level-Chips änderbar.
  const [importSkillLevels, setImportSkillLevels] = useState<Record<number, Record<string, ExperienceLevel>>>({});
  // ---------- Kurs-Import per URL/Domain (Version 33, 14.09. — dritter Weg
  // neben Formular/CSV, siehe course-url-import-index.ts). Extrahierte
  // Entwuerfe werden NIE direkt gespeichert, sondern befuellen das
  // bestehende manuelle Formular oben (courseForm) zur Pruefung — kein
  // eigener, zweiter Speicher-Pfad noetig, siehe applyCourseUrlDraftToForm.
  const [urlImportDomain, setUrlImportDomain] = useState("");
  const [urlImportSingleUrl, setUrlImportSingleUrl] = useState("");
  const [urlImportDiscoverBusy, setUrlImportDiscoverBusy] = useState(false);
  const [urlImportDiscoverError, setUrlImportDiscoverError] = useState<string | null>(null);
  const [urlImportCandidates, setUrlImportCandidates] = useState<string[]>([]);
  const [urlImportSelected, setUrlImportSelected] = useState<Set<string>>(new Set());
  const [urlImportSitemapUrl, setUrlImportSitemapUrl] = useState<string | null>(null);
  const [urlImportTruncated, setUrlImportTruncated] = useState(false);
  // Warteschlange fuer den "ein Kurs nach dem anderen zur Pruefung"-Ablauf
  // (siehe startUrlImportQueue/advanceUrlImportQueue): urlImportQueue sind
  // die noch NICHT begonnenen URLs, urlImportCurrentUrl die gerade ins
  // Formular geladene.
  const [urlImportQueue, setUrlImportQueue] = useState<string[]>([]);
  const [urlImportQueueTotal, setUrlImportQueueTotal] = useState(0);
  const [urlImportQueueDone, setUrlImportQueueDone] = useState(0);
  const [urlImportCurrentUrl, setUrlImportCurrentUrl] = useState<string | null>(null);
  const [urlImportExtractBusy, setUrlImportExtractBusy] = useState(false);
  const [urlImportExtractError, setUrlImportExtractError] = useState<string | null>(null);
  // "Später fortsetzen" (Version 2, 14.09., Nachfrage "man das aber auch
  // später machen können"): die Warteschlange wird bei jeder Änderung in
  // localStorage gespiegelt (siehe Effekt weiter unten) — verlässt man die
  // Seite oder schließt den Tab mitten in der Kurs-für-Kurs-Prüfung, bleibt
  // der Rest erhalten und wird beim naechsten Öffnen als Banner zum
  // Fortsetzen/Verwerfen angeboten, statt verloren zu gehen. "Import beenden"
  // bleibt die BEWUSSTE Variante, den Rest zu verwerfen.
  const [urlImportResumeAvailable, setUrlImportResumeAvailable] = useState<{
    remainingUrls: string[];
    total: number;
    done: number;
  } | null>(null);
  // Welche Feldnamen des zuletzt geladenen Entwurfs ein verifiziertes
  // Belegzitat hatten (siehe verified_fields in CourseUrlExtractResponse) —
  // fuers "✓ von Seite bestaetigt"-Badge im Formular oben.
  const [urlImportVerifiedFields, setUrlImportVerifiedFields] = useState<string[]>([]);
  // Woertliche Dauer-Rohangabe (z.B. "89 Stunden ..."), wenn die Seite keine
  // explizite Unterrichtseinheiten(UE)-Angabe macht, sondern nur Stunden o.ae.
  // nennt (siehe duration_hint in CourseUrlExtractDraft) — wird bewusst NICHT
  // automatisch in teachingUnits umgerechnet (1 Stunde != 1 UE), sondern nur
  // als Hinweis direkt am UE-Feld angezeigt, damit der Mensch selbst entscheidet.
  const [urlImportDurationHint, setUrlImportDurationHint] = useState<string | null>(null);
  // ------------------------------------------------------------
  // Live-Beispiele fuer den Rundgang: "Kurs manuell anlegen" und "Kurse per
  // CSV importieren" (siehe EXAMPLE_COURSE_FORM/EXAMPLE_CSV_* oben). Anders
  // als die reinen Anzeige-Demodaten weiter unten (tourDemoLead etc.) landet
  // das Beispiel hier im ECHTEN Formular-/Import-State und stoesst die ECHTE
  // Skill-Erkennung an (echter API-Call mit dem Beispieltext) — nur der
  // jeweilige Speichern-/Import-Klick bleibt eine bewusste, separate
  // Nutzer-Aktion, es wird also nichts automatisch an die API geschickt.
  // Die Refs sorgen dafuer, dass das pro Tour-Durchlauf nur EINMAL passiert
  // (sonst wuerden eigene Aenderungen waehrend der Tour immer wieder
  // ueberschrieben, sobald der Schritt erneut aktiv wird, z.B. per "Zurück").
  const manualExampleAppliedRef = useRef(false);
  const manualExampleDetectRef = useRef(false);
  const csvExampleAppliedRef = useRef(false);
  const csvExampleDetectRef = useRef(false);
  useEffect(() => {
    if (!tourOpen) {
      manualExampleAppliedRef.current = false;
      csvExampleAppliedRef.current = false;
      return;
    }
    if (
      tourStepSelector === '[data-tour="kurse-manual-form"]' &&
      !manualExampleAppliedRef.current &&
      !editingCourseId &&
      !courseForm.courseName.trim()
    ) {
      manualExampleAppliedRef.current = true;
      setCourseForm({ ...EXAMPLE_COURSE_FORM, provider: tenantName });
    }
    if (tourStepSelector === '[data-tour="kurse-csv-import"]' && !csvExampleAppliedRef.current && importDataRows.length === 0) {
      csvExampleAppliedRef.current = true;
      loadExampleCsvImport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourOpen, tourStepSelector]);
  // Sobald das Beispiel im manuellen Formular steht, einmal automatisch
  // "Skills automatisch ermitteln" ausloesen, damit der Rundgang echte
  // Vorschlags-Chips zeigt statt eines leeren Formulars.
  useEffect(() => {
    if (!tourOpen) {
      manualExampleDetectRef.current = false;
      return;
    }
    if (
      live &&
      tourStepSelector === '[data-tour="kurse-manual-form"]' &&
      !manualExampleDetectRef.current &&
      courseForm.description.trim() === EXAMPLE_COURSE_FORM.description &&
      manualSuggestedSkills.length === 0 &&
      courseSkillUris.size === 0
    ) {
      manualExampleDetectRef.current = true;
      void handleDetectManualSkills();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourOpen, tourStepSelector, courseForm.description, live]);
  // Analog fuer den CSV-Import: sobald die Beispielzeilen + die
  // Beschreibungs-Spalte gesetzt sind, einmal automatisch Skills ermitteln.
  useEffect(() => {
    if (!tourOpen) {
      csvExampleDetectRef.current = false;
      return;
    }
    if (
      live &&
      tourStepSelector === '[data-tour="kurse-csv-import"]' &&
      !csvExampleDetectRef.current &&
      importMapping.description >= 0 &&
      importDataRows.length > 0 &&
      Object.keys(importSkillSuggestions).length === 0
    ) {
      csvExampleDetectRef.current = true;
      void handleDetectImportSkills();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourOpen, tourStepSelector, importMapping.description, importDataRows.length, live]);
  /** Setzt den CSV-Import-State auf das Beispiel aus EXAMPLE_CSV_HEADERS/
   *  EXAMPLE_CSV_ROWS — exakt derselbe Weg wie beim Einlesen einer echten
   *  Datei (handleImportFile), nur ohne Datei-Upload. Rein fuer den
   *  Rundgang; wird NICHT aufgerufen, wenn bereits eine echte Datei geladen
   *  wurde (siehe Aufrufstelle oben). */
  function loadExampleCsvImport() {
    setImportFileName("kurse-beispiel.csv");
    setImportParseError(null);
    setImportSummary(null);
    setImportHeaders(EXAMPLE_CSV_HEADERS);
    setImportDataRows(EXAMPLE_CSV_ROWS);
    setImportMapping(guessImportMapping(EXAMPLE_CSV_HEADERS));
  }
  async function connect() {
    // Ohne Zugangsschlüssel wird gar nicht erst angefragt — der Schlüssel wird
    // im Verbindungs-Panel eingetragen und nicht mit der Seite ausgeliefert.
    if (!apiKey.trim()) {
      setLive(false);
      setConnStatus({ msg: "Bitte zuerst deinen Zugangsschlüssel eintragen.", kind: "err" });
      return;
    }
    setConnecting(true);
    setConnStatus({ msg: "Lade…", kind: "" });
    try {
      const [rolesRes, leadsRes, reportRes, coursesRes] = await Promise.allSettled([
        fetchTargetRoles(baseUrl, apiKey),
        fetchLeads(baseUrl, apiKey),
        fetchOrbitReport(baseUrl, apiKey),
        fetchCourses(baseUrl, apiKey),
      ]);
      const failed: string[] = [];
      if (rolesRes.status === "fulfilled") {
        const rolesValue = rolesRes.value;
        setRoles(rolesValue);
        setLeadForm((f) => ({
          ...f,
          targetRoleId:
            f.targetRoleId ||
            rolesValue.find((r) => r.role_id === "data-analyst")?.role_id ||
            rolesValue[0]?.role_id ||
            "",
        }));
      } else {
        failed.push("Zielrollen");
      }
      if (leadsRes.status === "fulfilled") {
        setLeads(leadsRes.value.leads || []);
      } else {
        failed.push("Leads");
      }
      if (reportRes.status === "fulfilled") {
        setReport(reportRes.value);
      } else {
        failed.push("Report");
      }
      if (coursesRes.status === "fulfilled") {
        setCourses(coursesRes.value.courses || []);
      } else {
        failed.push("Kurse");
      }
      const anySucceeded = failed.length < 4;
      setLive(anySucceeded);
      if (failed.length === 0) {
        setConnStatus({ msg: "Verbunden — Daten aktuell.", kind: "ok" });
      } else if (anySucceeded) {
        setConnStatus({
          msg: `Teilweise geladen — fehlgeschlagen: ${failed.join(", ")}. Bitte Verbindung/Server prüfen.`,
          kind: "err",
        });
      } else {
        setConnStatus({ msg: "Fehlgeschlagen: läuft dein Server?", kind: "err" });
      }
    } finally {
      setConnecting(false);
    }
  }
  // Im Whitelabel-Modus (Connection-Panel ausgeblendet) gibt es keinen "Verbinden &
  // laden"-Button, auf den ein Kunde klicken könnte — also einmalig beim Laden selbst
  // verbinden. Läuft absichtlich nur einmal beim Mount.
  useEffect(() => {
    if (!showConnectionPanel && apiKey.trim()) {
      void connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function refreshAll() {
    await connect();
  }
  async function handleCreateLead() {
    const trimmedText = leadForm.text.trim();
    if (trimmedText.length < MIN_PROFILE_TEXT_LENGTH) {
      setLeadFormStatus({ msg: `Profil-Text ist zu kurz (mindestens ${MIN_PROFILE_TEXT_LENGTH} Zeichen).`, kind: "err" });
      return;
    }
    setCreating(true);
    setLeadFormStatus({ msg: "Lege Lead an…", kind: "" });
    let created: LeadResponse;
    try {
      created = await createLead(baseUrl, apiKey, {
        text: trimmedText,
        target_role_id: leadForm.targetRoleId,
        lead_name: leadForm.name.trim() || null,
        contact_email: leadForm.email.trim() || null,
        contact_phone: leadForm.phone.trim() || null,
        desired_start: leadForm.desiredStart || null,
        employment_type: leadForm.employmentType || null,
        work_location: leadForm.workLocation || null,
        consultation_requested: leadForm.wantsConsultation,
      });
    } catch (err) {
      setLeadFormStatus({ msg: `Fehler: ${err instanceof Error ? err.message : String(err)}`, kind: "err" });
      setCreating(false);
      return;
    }
    // Kursverknüpfung/Buchungsstatus sind in LeadCreateRequest nicht
    // vorgesehen (siehe Kommentar dort) — deshalb hier als Folge-Calls auf
    // die gerade erzeugte Lead-ID, genau wie beim nachträglichen Verknüpfen
    // in der Lead-Liste (siehe handleToggleLinkedCourse). Ein Fehler hier
    // darf die bereits erfolgreiche Lead-Anlage nicht als Fehlschlag zeigen.
    let followUpWarning = "";
    try {
      if (leadForm.linkedCourseIds.length > 0) {
        await setLeadLinkedCourses(baseUrl, apiKey, created.lead_id, leadForm.linkedCourseIds);
      }
      if (leadForm.booked) {
        await setLeadBooked(baseUrl, apiKey, created.lead_id, true);
      }
    } catch (err) {
      console.error("[DashboardPage] handleCreateLead (Kurse/Buchung):", err);
      followUpWarning = " — Weiterbildungen/Buchungsstatus konnten nicht gespeichert werden, bitte in der Lead-Liste nachtragen.";
    }
    setLeadFormStatus({ msg: `✓ Lead angelegt.${followUpWarning}`, kind: followUpWarning ? "err" : "ok" });
    try {
      const [leadsRes, reportRes] = await Promise.all([fetchLeads(baseUrl, apiKey), fetchOrbitReport(baseUrl, apiKey)]);
      setLeads(leadsRes.leads || []);
      setReport(reportRes);
    } catch {
      setLeadFormStatus({
        msg: "✓ Lead angelegt, Ansicht konnte aber nicht aktualisiert werden — bitte oben auf „Aktualisieren“ klicken.",
        kind: "ok",
      });
    } finally {
      setCreating(false);
    }
  }
  async function handleToggleBooked(lead: LeadResponse) {
    setBookingBusyId(lead.lead_id);
    try {
      const updated = await setLeadBooked(baseUrl, apiKey, lead.lead_id, !lead.booked);
      setLeads((prev) => prev.map((l) => (l.lead_id === updated.lead_id ? updated : l)));
    } catch (err) {
      setConnStatus({
        msg: `Buchungsstatus konnte nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}`,
        kind: "err",
      });
      setBookingBusyId(null);
      return;
    }
    try {
      const reportRes = await fetchOrbitReport(baseUrl, apiKey);
      setReport(reportRes);
    } catch {
      // Buchung ist gespeichert — nur die Report-Kachel ist kurz veraltet, kein Nutzerfehler.
    } finally {
      setBookingBusyId(null);
    }
  }
  /**
   * Löscht einen Lead unwiderruflich (Version 28, Recht auf Löschung / Art. 17
   * DSGVO — siehe deleteLead() in orbit.ts, ausgelöst über "Lead endgültig
   * löschen" im Detail-Modal unten). Bewusst mit einer nativen Bestätigung
   * (window.confirm) abgesichert, weil es — anders als "Als gebucht
   * markieren" — nicht rückgängig zu machen ist. Bei Erfolg wird der Lead aus
   * der lokalen Liste entfernt und die Detailansicht geschlossen; schlägt der
   * Aufruf fehl (z.B. weil das Backend den Endpunkt noch nicht kennt), bleibt
   * der Lead unverändert sichtbar und es erscheint eine Fehlermeldung statt
   * eines stillen Fehlschlags.
   */
  async function handleDeleteLead(lead: LeadResponse) {
    const label = lead.lead_name || lead.contact_email || lead.target_role_name;
    if (!window.confirm(`Lead „${label}“ wirklich endgültig löschen? Das kann nicht rückgängig gemacht werden.`)) {
      return;
    }
    setDeleteBusyId(lead.lead_id);
    try {
      await deleteLead(baseUrl, apiKey, lead.lead_id);
      setLeads((prev) => prev.filter((l) => l.lead_id !== lead.lead_id));
      setSelectedLeadId((prev) => (prev === lead.lead_id ? null : prev));
      setConnStatus({ msg: "✓ Lead endgültig gelöscht.", kind: "ok" });
    } catch (err) {
      setConnStatus({
        msg: `Lead konnte nicht gelöscht werden: ${err instanceof Error ? err.message : String(err)}`,
        kind: "err",
      });
    } finally {
      setDeleteBusyId(null);
    }
  }
  /** Markiert das angefragte Beratungsgespräch als durchgeführt (oder macht
   * das rückgängig) — genau dasselbe Muster wie handleToggleBooked oben, nur
   * für consultation_completed statt booked. Das Datum (consultation_completed_at)
   * setzt der Server, nicht das Frontend. */
  async function handleToggleConsultationCompleted(lead: LeadResponse) {
    setConsultationBusyId(lead.lead_id);
    try {
      const updated = await setLeadConsultationCompleted(baseUrl, apiKey, lead.lead_id, !lead.consultation_completed);
      setLeads((prev) => prev.map((l) => (l.lead_id === updated.lead_id ? updated : l)));
    } catch (err) {
      setConnStatus({
        msg: `Beratungsstatus konnte nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}`,
        kind: "err",
      });
    } finally {
      setConsultationBusyId(null);
    }
  }
  /** Trägt das Termin-Datum fürs Beratungsgespräch ein oder entfernt es
   * (Version 22, siehe consultation_scheduled_for in orbit.ts) — unabhängig
   * von handleToggleConsultationCompleted: hier geht es nur um WANN der
   * Termin vereinbart wurde/stattfinden soll, nicht ob er schon
   * durchgeführt wurde. scheduledFor: "YYYY-MM-DD" oder null zum Entfernen. */
  async function handleSetConsultationScheduled(lead: LeadResponse, scheduledFor: string | null) {
    setConsultationScheduleBusyId(lead.lead_id);
    try {
      const updated = await setLeadConsultationScheduled(baseUrl, apiKey, lead.lead_id, scheduledFor);
      setLeads((prev) => prev.map((l) => (l.lead_id === updated.lead_id ? updated : l)));
    } catch (err) {
      setConnStatus({
        msg: `Termin konnte nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}`,
        kind: "err",
      });
    } finally {
      setConsultationScheduleBusyId(null);
    }
  }
  /** Weist einen Lead einem Bearbeiter zu oder entfernt die Zuweisung
   * (Version 23, siehe assigned_to in orbit.ts). */
  async function handleSetAssignedTo(lead: LeadResponse, assignedTo: string | null) {
    setAssignBusyId(lead.lead_id);
    try {
      const updated = await setLeadAssignedTo(baseUrl, apiKey, lead.lead_id, assignedTo);
      setLeads((prev) => prev.map((l) => (l.lead_id === updated.lead_id ? updated : l)));
    } catch (err) {
      setConnStatus({
        msg: `Zuweisung konnte nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}`,
        kind: "err",
      });
    } finally {
      setAssignBusyId(null);
    }
  }
  /** Aktiviert das Beratungsgespräch-Feld manuell für einen Lead, der es
   * selbst nicht in der Journey angefragt hat (Version 23, siehe
   * consultation_requested in orbit.ts). */
  async function handleEnableConsultation(lead: LeadResponse) {
    setEnableConsultationBusyId(lead.lead_id);
    try {
      const updated = await setLeadConsultationRequested(baseUrl, apiKey, lead.lead_id, true);
      setLeads((prev) => prev.map((l) => (l.lead_id === updated.lead_id ? updated : l)));
    } catch (err) {
      setConnStatus({
        msg: `Beratungsgespräch konnte nicht angelegt werden: ${err instanceof Error ? err.message : String(err)}`,
        kind: "err",
      });
    } finally {
      setEnableConsultationBusyId(null);
    }
  }
  /** Verlinkt/entfernt einen Kurs aus dem eigenen Katalog manuell bei einem
   * Lead (Version 23, siehe linked_course_ids in orbit.ts) — schickt immer
   * die komplette neue Liste, siehe setLeadLinkedCourses. */
  async function handleToggleLinkedCourse(lead: LeadResponse, courseId: string) {
    const current = lead.linked_course_ids ?? [];
    const next = current.includes(courseId) ? current.filter((id) => id !== courseId) : [...current, courseId];
    setLinkedCoursesBusyId(lead.lead_id);
    try {
      const updated = await setLeadLinkedCourses(baseUrl, apiKey, lead.lead_id, next);
      setLeads((prev) => prev.map((l) => (l.lead_id === updated.lead_id ? updated : l)));
    } catch (err) {
      setConnStatus({
        msg: `Kurs-Verknüpfung konnte nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}`,
        kind: "err",
      });
    } finally {
      setLinkedCoursesBusyId(null);
    }
  }
  async function handleToggleFeatured(course: OrbitCourse) {
    setFeaturedBusyId(course.course_id);
    try {
      const updated = await setCourseFeatured(baseUrl, apiKey, course.course_id, !course.is_featured);
      setCourses((prev) => prev.map((c) => (c.course_id === updated.course_id ? updated : c)));
    } catch (err) {
      setCourseFormStatus({ msg: `Fehler: ${err instanceof Error ? err.message : String(err)}`, kind: "err" });
    } finally {
      setFeaturedBusyId(null);
    }
  }
  /**
   * Speichert die Konversions-Banner-Felder (starts_at/seats_remaining/
   * custom_banner) direkt von der Kurskachel aus — ohne erst "✎ Bearbeiten"
   * zu öffnen, genau wie handleToggleFeatured oben "Top" per Klick setzt.
   * Es gibt dafür keinen eigenen Endpunkt (anders als /featured), deshalb
   * wird der volle Kurs per upsertCourse gespeichert; nur die per `patch`
   * übergebenen Felder ändern sich. Kein eigener Endpoint nötig, weil
   * upsertCourse ohnehin den kompletten Kurs akzeptiert.
   */
  async function handleUpdateBanner(
    course: OrbitCourse,
    patch: { starts_at?: string | null; seats_remaining?: number | null; custom_banner?: string | null }
  ) {
    setBannerBusyId(course.course_id);
    setBannerError(null);
    try {
      const updated = await upsertCourse(baseUrl, apiKey, {
        course_id: course.course_id,
        course_name: course.course_name,
        provider: course.provider,
        duration_weeks: course.duration_weeks,
        covered_skill_uris: course.covered_skill_uris,
        covered_skills: course.covered_skills,
        is_featured: course.is_featured,
        description: course.description,
        target_role_id: course.target_role_id,
        target_role_name: course.target_role_name,
        target_role_ids: course.target_role_ids,
        target_role_names: course.target_role_names,
        location: course.location,
        is_remote: course.is_remote,
        location_mode: course.location_mode,
        // Muss hier genau wie location_mode mitgeschickt werden — upsertCourse
        // ersetzt den kompletten Kurs, ohne dieses Feld würde jeder Banner-
        // Quick-Pick/Top-Toggle die einmal gesetzte Beschäftigungsart wieder
        // stillschweigend löschen (siehe employment_mode in orbit.ts).
        employment_mode: course.employment_mode,
        starts_at: course.starts_at,
        seats_remaining: course.seats_remaining,
        custom_banner: course.custom_banner,
        // Bug-Fix (15.09., "ich kann im Kursprogramm die Bereiche nicht
        // hinterlegen, das wird immer noch nicht gespeichert"): bereich_key(s)
        // fehlten hier komplett — genau derselbe Fehlertyp wie beim
        // CSV-Import-Bugfix oben (handleRunImport). upsertCourse ersetzt den
        // kompletten Kurs; ohne diese Felder hat jeder Klick auf die
        // Banner-Schnellbearbeitung (Startdatum/Plätze/Banner-Text direkt von
        // der Kachel aus, ohne "✎ Bearbeiten" zu öffnen) einen zuvor im
        // Formular gesetzten Bereich stillschweigend geloescht.
        bereich_key: course.bereich_key,
        bereich_label: course.bereich_label,
        bereich_keys: course.bereich_keys,
        bereich_labels: course.bereich_labels,
        // Version 32 — dieselbe Begruendung wie bei employment_mode oben:
        // ohne diese Felder wuerde ein Banner-Quick-Pick jeden im Formular
        // gepflegten Preis/Förderung/Abschluss wieder stillschweigend
        // loeschen (upsertCourse ersetzt den kompletten Kurs).
        price_eur: course.price_eur,
        price_vat_exempt: course.price_vat_exempt,
        exam_fee_eur: course.exam_fee_eur,
        teaching_units: course.teaching_units,
        funding_types: course.funding_types,
        funding_measure_number: course.funding_measure_number,
        qualification_type: course.qualification_type,
        dqr_level: course.dqr_level,
        target_group: course.target_group,
        ...patch,
      });
      setCourses((prev) => prev.map((c) => (c.course_id === updated.course_id ? updated : c)));
      // Server hat geantwortet, aber das gesendete Feld kommt anders zurueck
      // als geschickt -- klassisches Zeichen, dass das Backend custom_banner
      // (noch) nicht speichert/zurueckliefert (additives Feld, siehe Kommentar
      // an OrbitCourse in orbit.ts). Ohne diese Meldung sieht der Klick nach
      // aussen wie "tut nichts", obwohl der Request technisch erfolgreich war.
      if (patch.custom_banner !== undefined && updated.custom_banner !== patch.custom_banner) {
        setBannerError({
          id: course.course_id,
          msg: "Gespeichert, aber vom Server ohne den Banner-Text zurückgekommen — dein Backend unterstützt das Feld custom_banner vermutlich noch nicht.",
        });
      }
    } catch (err) {
      const msg = `Fehler: ${err instanceof Error ? err.message : String(err)}`;
      setCourseFormStatus({ msg, kind: "err" });
      setBannerError({ id: course.course_id, msg });
    } finally {
      setBannerBusyId(null);
    }
  }
  async function handleAddCourse() {
    // Bereich ist seit 15.09. Pflichtfeld, seit 15.09. Mehrfachauswahl
    // moeglich (siehe bereichKeys in CourseFormState) — Button ist zwar schon
    // disabled, aber defensiv auch hier geprueft, falls handleAddCourse je
    // programmatisch aufgerufen wird.
    if (courseForm.bereichKeys.length === 0) {
      setCourseFormStatus({ msg: "Bitte einen Bereich auswählen — ohne Bereich kann der Kurs in der Journey nicht zugeordnet werden.", kind: "err" });
      return;
    }
    setSavingCourse(true);
    setCourseFormStatus({ msg: editingCourseId ? "Aktualisiere Kurs…" : "Speichere Kurs…", kind: "" });
    try {
      const rawDuration = Number(courseForm.durationWeeks);
      // Backend kennt nur duration_weeks — bei "Monate" hier umrechnen
      // (gleicher Faktor wie parseDurationWeeks() beim CSV-Import, damit
      // beide Wege konsistent runden).
      const parsedDuration =
        courseForm.durationUnit === "months"
          ? Math.round(rawDuration * 4.345)
          : Math.round(rawDuration);
      const durationWeeks = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 1;
      // Mehrere Zielrollen möglich (siehe targetRoleIds oben) — target_role_id/
      // target_role_name bleiben zusätzlich als ERSTE ausgewählte Rolle gesetzt,
      // rein für ein Backend, das nur das alte Einzelfeld kennt.
      const targetRolesSelected = courseForm.targetRoleIds
        .map((id) => roles.find((r) => r.role_id === id))
        .filter((r): r is TargetRole => Boolean(r));
      const coveredSkills: CourseSkillEntry[] = Array.from(courseSkillUris).map((uri) => ({
        esco_uri: uri,
        experience_level: courseSkillLevels[uri] ?? null,
      }));
      const saved = await upsertCourse(baseUrl, apiKey, {
        course_id: courseForm.courseId.trim(),
        course_name: courseForm.courseName.trim(),
        provider: courseForm.provider.trim(),
        duration_weeks: durationWeeks,
        description: courseForm.description.trim() || undefined,
        // Kritischer Fix (siehe kritische-prozess-analyse.md, Finding 1): ohne
        // dieses Feld ist covers_gap_percentage fuer diesen Kurs immer 0 und
        // er kann in der Journey nie als persoenliche Empfehlung erscheinen.
        covered_skill_uris: Array.from(courseSkillUris),
        // Zusaetzlich mit Erfahrungslevel je Skill (rein additiv, siehe
        // CourseSkillEntry in orbit.ts) sowie optionalen Zielrollen.
        covered_skills: coveredSkills,
        target_role_id: targetRolesSelected[0]?.role_id ?? null,
        target_role_name: targetRolesSelected[0]?.role_name ?? null,
        target_role_ids: targetRolesSelected.length ? targetRolesSelected.map((r) => r.role_id) : null,
        target_role_names: targetRolesSelected.length ? targetRolesSelected.map((r) => r.role_name) : null,
        // Bereich/Kategorie — Pflichtfeld (siehe Validierung oben in
        // handleAddCourse), Grundlage fuer die Bereichs-/Rollen-Sichtbarkeit
        // in der Journey (siehe bereich_key/-keys in orbit.ts). bereich_key/
        // -label bleiben zusaetzlich als ERSTER gewaehlter Bereich gesetzt
        // (Backward-Compat), bereich_keys/-labels tragen die volle
        // Mehrfachauswahl — gleiches Muster wie target_role_id/-ids oben.
        bereich_key: courseForm.bereichKeys[0] ?? null,
        bereich_label: BEREICH_OPTIONS.find((b) => b.key === courseForm.bereichKeys[0])?.label ?? null,
        bereich_keys: courseForm.bereichKeys.length ? courseForm.bereichKeys : null,
        bereich_labels: courseForm.bereichKeys.length
          ? courseForm.bereichKeys.map((k) => BEREICH_OPTIONS.find((b) => b.key === k)?.label ?? k)
          : null,
        // is_remote bleibt fuer einfache Konsumenten ein Boolean (true bei
        // remote UND hybrid — beide Formate schliessen eine Online-Teilnahme
        // ein); location_mode liefert zusaetzlich die praezise 3-Wege-Angabe.
        // Beides additiv, wie die uebrigen neuen Felder.
        is_remote: courseForm.locationMode !== "vor_ort",
        location: courseForm.locationMode === "remote" ? null : courseForm.location.trim() || null,
        location_mode: courseForm.locationMode,
        // Beschäftigungsart (Version 25, siehe employment_mode in orbit.ts) —
        // wie location_mode immer ein echter Wert, nie leer (Toggle statt
        // freiem Feld), Grundlage für das Präferenz-Matching in courseMatcher.ts.
        employment_mode: courseForm.employmentMode,
        // Konversions-Banner (siehe Kommentar an OrbitCourse in orbit.ts) —
        // alle drei optional/additiv, leer = nicht gesetzt.
        starts_at: courseForm.startsAt || null,
        seats_remaining: courseForm.seatsRemaining.trim() === "" ? null : Math.max(0, Math.round(Number(courseForm.seatsRemaining))),
        custom_banner: courseForm.customBanner.trim() || null,
        // Preis-/Förder-/Abschluss-Felder (Version 32, siehe Kommentar an
        // denselben Feldern in orbit.ts) — durchweg additiv/optional, leer =
        // nicht gesetzt statt erzwungener 0.
        price_eur: courseForm.priceEur.trim() === "" ? null : Math.max(0, Number(courseForm.priceEur)),
        price_vat_exempt: courseForm.priceVatExempt,
        exam_fee_eur: courseForm.examFeeEur.trim() === "" ? null : Math.max(0, Number(courseForm.examFeeEur)),
        teaching_units: courseForm.teachingUnits.trim() === "" ? null : Math.max(0, Math.round(Number(courseForm.teachingUnits))),
        funding_types: courseForm.fundingTypes.length > 0 ? courseForm.fundingTypes : null,
        funding_measure_number: courseForm.fundingMeasureNumber.trim() || null,
        qualification_type: courseForm.qualificationType || null,
        dqr_level: courseForm.dqrLevel.trim() === "" ? null : Math.max(1, Math.min(8, Math.round(Number(courseForm.dqrLevel)))),
        target_group: courseForm.targetGroup.trim() || null,
      });
      setCourses((prev) => {
        const exists = prev.some((c) => c.course_id === saved.course_id);
        return exists ? prev.map((c) => (c.course_id === saved.course_id ? saved : c)) : [...prev, saved];
      });
      const wasEditing = Boolean(editingCourseId);
      // War dieser Kurs Teil einer URL-Import-Warteschlange (nicht: eine
      // bestehende bereits gespeicherte URL-Import-Karteikarte editieren)?
      // Nur dann nach dem Speichern automatisch zum naechsten Kurs
      // weiterspringen (siehe advanceUrlImportQueue) — beim manuellen
      // Bearbeiten eines Kurses waere ein automatischer Sprung ueberraschend.
      const wasUrlImportDraft = Boolean(urlImportCurrentUrl) && !wasEditing;
      // Ehrliche Rueckmeldung, falls der Server den gesendeten Bereich nicht
      // zurueckliefert (z.B. weil das Backend bereich_key/-keys noch nicht
      // kennt) — sonst sieht der Klick nach aussen wie "tut nichts", obwohl
      // der Request technisch erfolgreich war (gleiches Muster wie die
      // custom_banner-Warnung bei handleUpdateBanner oben).
      const sentBereichKeys = [...courseForm.bereichKeys].sort().join(",");
      const savedBereichKeys = [...(saved.bereich_keys ?? (saved.bereich_key ? [saved.bereich_key] : []))]
        .sort()
        .join(",");
      if (sentBereichKeys !== savedBereichKeys) {
        setCourseFormStatus({
          msg: "Gespeichert, aber der Bereich kam vom Server nicht zurück — dein Backend unterstützt das Feld bereich_key/bereich_keys vermutlich noch nicht.",
          kind: "err",
        });
      } else {
        setCourseFormStatus({ msg: wasEditing ? "✓ Kurs aktualisiert." : "✓ Kurs gespeichert.", kind: "ok" });
      }
      setCourseSaveToast(wasEditing ? "Kurs aktualisiert." : "Kurs gespeichert.");
      resetCourseForm();
      if (wasUrlImportDraft) {
        // Kurze Verzoegerung, damit das Popup erst sichtbar wird, bevor die
        // Ladeanzeige fuer den naechsten Kurs (falls noch welche in der
        // Warteschlange sind) startet bzw. der Import bei leerer
        // Warteschlange endet.
        window.setTimeout(() => {
          if (urlImportQueue.length > 0) {
            advanceUrlImportQueue();
          } else {
            endUrlImportQueue();
          }
        }, 900);
      }
    } catch (err) {
      setCourseFormStatus({ msg: `Fehler: ${err instanceof Error ? err.message : String(err)}`, kind: "err" });
    } finally {
      setSavingCourse(false);
    }
  }
  function resetCourseForm() {
    setCourseForm({ ...DEFAULT_COURSE_FORM, provider: tenantName });
    setUrlImportVerifiedFields([]);
    setUrlImportDurationHint(null);
    setCourseSkillUris(new Set());
    setCourseSkillLevels({});
    setSkillPickerRoleId("");
    setSkillPickerSkills([]);
    setSkillPickerError(null);
    setEditingCourseId(null);
    setManualSuggestedSkills([]);
    setManualSkillDetectError(null);
    setLevelRefineError(null);
    setSkillSearchQuery("");
    setSkillSearchResults([]);
    setSkillSearchError(null);
    setTargetRoleSuggestions([]);
    setTargetRoleSuggestAttempted(false);
    setBereichKeysTouched(false);
    setDescSuggestError(null);
    setHandbookFileName("");
    setHandbookStage("");
    setHandbookError(null);
    setHandbookDragOver(false);
  }
  /** Text, der der automatischen Skill-Erkennung UND der Erfahrungslevel-
   *  Heuristik zugrunde liegt: Kursname UND Beschreibung kombiniert, damit
   *  auch ein aussagekräftiger Kursname allein (z.B. "SQL für Fortgeschrittene")
   *  schon Treffer liefert, selbst wenn noch keine oder nur eine kurze
   *  Beschreibung eingetragen ist — "so interaktiv wie möglich, Namen mit
   *  Skills gematcht". */
  function manualDetectText(): string {
    return [courseForm.courseName.trim(), courseForm.description.trim()].filter(Boolean).join(". ");
  }
  /** Schickt die Kursbeschreibung an denselben LOKALEN Katalog-Matcher, den
   *  auch der Lebenslauf-Abgleich der Journey nutzt (matchSkills, siehe
   *  ../data/skillMatcher, hier ueber matchSkillsLocal) und sammelt die
   *  Treffer als VORSCHLAEGE in manualSuggestedSkills — landen NICHT
   *  automatisch in courseSkillUris, das passiert erst durch
   *  approveManualSuggestedSkill / approveAllManualSuggestedSkills. */
  async function handleDetectManualSkills() {
    // Namensbasiertes Matching (siehe manualDetectText): ein aussagekräftiger
    // Kursname allein reicht schon fuer erste Vorschlaege.
    const text = manualDetectText();
    if (text.length < MIN_DESCRIPTION_FOR_SKILL_DETECT) return;
    setManualSkillDetectBusy(true);
    setManualSkillDetectError(null);
    try {
      const matches: MatchedSkill[] = matchSkillsLocal(text, { maxResults: 12, minScore: 60 });
      const fresh = matches.filter((m) => !courseSkillUris.has(m.esco_uri));
      setManualSuggestedSkills(fresh);
      setSkillLabelCache((prev) => {
        const next = { ...prev };
        for (const m of matches) next[m.esco_uri] = m.preferred_label;
        return next;
      });
      if (fresh.length === 0) {
        setManualSkillDetectError(
          matches.length > 0
            ? "Alle erkannten Skills sind schon zugeordnet."
            : "Keine passenden Skills in Name/Beschreibung erkannt — bitte über die Zielrolle oben manuell zuordnen."
        );
      }
    } catch (err) {
      setManualSkillDetectError(err instanceof Error ? err.message : "Skill-Erkennung fehlgeschlagen.");
      setManualSuggestedSkills([]);
    } finally {
      setManualSkillDetectBusy(false);
    }
  }
  // Automatische, entprellte Skill-Erkennung: sobald sich Kursname oder
  // -beschreibung ändern, wird ohne Klick automatisch neu gesucht — "so
  // interaktiv wie möglich", siehe Nutzerwunsch (Vorschläge, Name mit Skills
  // gematcht). Der Button bleibt zusätzlich bestehen, u.a. um sofort erneut
  // zu prüfen. Während der Tour übernimmt der eigene Tour-Effekt oben das
  // Auslösen (Beispieltext), deshalb hier bewusst ausgenommen, sonst würde
  // doppelt angefragt.
  const autoDetectTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (tourOpen) return;
    if (manualDetectText().length < MIN_DESCRIPTION_FOR_SKILL_DETECT) return;
    if (autoDetectTimerRef.current) window.clearTimeout(autoDetectTimerRef.current);
    autoDetectTimerRef.current = window.setTimeout(() => {
      void handleDetectManualSkills();
    }, 900);
    return () => {
      if (autoDetectTimerRef.current) window.clearTimeout(autoDetectTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseForm.courseName, courseForm.description, tourOpen]);
  /** "Freigabe" eines einzelnen Vorschlags: verschiebt ihn von
   *  manualSuggestedSkills in die tatsaechliche Zuordnung courseSkillUris —
   *  inkl. einer per Heuristik vorbelegten Erfahrungslevel-Schätzung (siehe
   *  courseSkillLevels), die danach über die Level-Chips frei änderbar bleibt. */
  function approveManualSuggestedSkill(uri: string) {
    const skill = manualSuggestedSkills.find((m) => m.esco_uri === uri);
    if (skill) {
      const guess = guessExperienceLevel(manualDetectText(), skill.matched_on, skill.preferred_label);
      setCourseSkillLevels((prev) => ({ ...prev, [uri]: guess.level }));
    }
    setCourseSkillUris((prev) => new Set(prev).add(uri));
    setManualSuggestedSkills((prev) => prev.filter((m) => m.esco_uri !== uri));
  }
  function approveAllManualSuggestedSkills() {
    const text = manualDetectText();
    setCourseSkillLevels((prev) => {
      const next = { ...prev };
      for (const m of manualSuggestedSkills) {
        next[m.esco_uri] = guessExperienceLevel(text, m.matched_on, m.preferred_label).level;
      }
      return next;
    });
    setCourseSkillUris((prev) => {
      const next = new Set(prev);
      for (const m of manualSuggestedSkills) next.add(m.esco_uri);
      return next;
    });
    setManualSuggestedSkills([]);
  }
  function dismissManualSuggestedSkill(uri: string) {
    setManualSuggestedSkills((prev) => prev.filter((m) => m.esco_uri !== uri));
  }
  /** Rangfolge fuer confidence-Vergleiche, wenn dieselbe esco_uri von mehreren
   *  Zielrollen-Aufrufen zurueckkommt — behaelt die zuversichtlichere Bewertung. */
  function confidenceRank(c: DepthSkillAssessment["confidence"]): number {
    return c === "hoch" ? 3 : c === "mittel" ? 2 : c === "niedrig" ? 1 : 0;
  }
  /** Wandelt eine per KI-Tiefenanalyse bestaetigte Skill-Bewertung in dieselbe
   *  MatchedSkill-Form um, die auch handleDetectManualSkills liefert, damit
   *  beide Quellen in derselben manualSuggestedSkills-Liste/UI landen.
   *  matched_on traegt hier bewusst das woertliche Belegzitat (oder ersatzweise
   *  die Begruendung) statt eines Katalog-Alias — wird als Tooltip am Chip
   *  angezeigt (siehe skill_type === "ki-tiefenanalyse" in der Chip-Zeile). */
  function depthAssessmentToMatchedSkill(a: DepthSkillAssessment): MatchedSkill {
    const confidenceScore = a.confidence === "hoch" ? 95 : a.confidence === "mittel" ? 75 : a.confidence === "niedrig" ? 55 : 50;
    return {
      esco_uri: a.esco_uri,
      preferred_label: a.preferred_label,
      skill_type: "ki-tiefenanalyse",
      matched_on: a.evidence_quote?.trim() || a.explanation || a.preferred_label,
      score: confidenceScore,
    };
  }
  /** Ergaenzt handleDetectManualSkills um eine inhaltliche KI-Pruefung: ruft
   *  fuer jede am Kurs hinterlegte Zielrolle (courseForm.targetRoleIds, siehe
   *  State-Kommentar oben) die "cv-depth-analysis"-Function mit dem Kurstext
   *  auf und uebernimmt jeden Skill mit evidence_found=true als zusaetzlichen
   *  Vorschlag — auch wenn der fuzzy Abgleich ihn NICHT gefunden hat, weil er
   *  in der Beschreibung nur umschrieben statt woertlich vorkommt. Laeuft
   *  bewusst NICHT automatisch mit (anders als handleDetectManualSkills),
   *  sondern nur per Klick, wie handleSuggestDescription/handleRefineSkillLevels
   *  auch — echter KI-Aufruf, also langsamer/teurer als der Fuzzy-Abgleich. */
  async function handleDetectSkillsWithAI() {
    const text = manualDetectText();
    if (text.length < MIN_DESCRIPTION_FOR_SKILL_DETECT) return;
    if (courseForm.targetRoleIds.length === 0) {
      setAiSkillDetectError("Bitte zuerst mindestens eine Zielrolle für den Kurs auswählen — die KI prüft gezielt deren Kern-Skills.");
      return;
    }
    setAiSkillDetectBusy(true);
    setAiSkillDetectError(null);
    try {
      // Auf die ersten 3 Zielrollen begrenzt: genug fuer die ueblichen Faelle
      // (meist 1-2 Rollen pro Kurs), verhindert aber, dass ein Kurs mit vielen
      // verknuepften Rollen ploetzlich viele parallele KI-Aufrufe ausloest.
      const roleIds = courseForm.targetRoleIds.slice(0, 3);
      const results = await Promise.allSettled(
        roleIds.map((roleId) => fetchDepthAnalysis(depthAnalysisBaseUrl(baseUrl), apiKey, { text, target_role_id: roleId }))
      );
      const bestByUri = new Map<string, DepthSkillAssessment>();
      let anySucceeded = false;
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        anySucceeded = true;
        for (const s of r.value.skills) {
          if (!s.evidence_found) continue;
          const existing = bestByUri.get(s.esco_uri);
          if (!existing || confidenceRank(s.confidence) > confidenceRank(existing.confidence)) {
            bestByUri.set(s.esco_uri, s);
          }
        }
      }
      if (!anySucceeded) {
        throw new Error("KI-Tiefenanalyse gerade nicht erreichbar.");
      }
      const newMatches = Array.from(bestByUri.values()).map(depthAssessmentToMatchedSkill);
      setManualSuggestedSkills((prev) => {
        const existingUris = new Set([...prev.map((m) => m.esco_uri), ...courseSkillUris]);
        const fresh = newMatches.filter((m) => !existingUris.has(m.esco_uri));
        return [...prev, ...fresh];
      });
      setSkillLabelCache((prev) => {
        const next = { ...prev };
        for (const m of newMatches) next[m.esco_uri] = m.preferred_label;
        return next;
      });
      if (newMatches.length === 0) {
        setAiSkillDetectError("Die KI hat in der Beschreibung keine weiteren Skills der ausgewählten Zielrolle(n) erkannt.");
      }
    } catch (err) {
      setAiSkillDetectError(err instanceof Error ? err.message : "KI-Tiefenanalyse fehlgeschlagen.");
    } finally {
      setAiSkillDetectBusy(false);
    }
  }
  /** Setzt/überschreibt das Erfahrungslevel eines bereits zugeordneten Skills
   *  (siehe .skill-level-badge in dashboard.css) — jederzeit frei klickbar,
   *  unabhängig davon, ob das Level per Heuristik, KI-Verfeinerung oder gar
   *  nicht vorbelegt war. */
  function setCourseSkillLevel(uri: string, level: ExperienceLevel) {
    setCourseSkillLevels((prev) => ({ ...prev, [uri]: level }));
  }
  /** Optionale KI-Verfeinerung der Erfahrungslevel aller aktuell zugeordneten
   *  Skills über die separate "skill-level-detect"-Function (siehe orbit.ts)
   *  — ersetzt die lokale Heuristik-Schätzung in courseSkillLevels nur bei
   *  Erfolg; schlägt der Aufruf fehl, bleibt die bisherige Schätzung
   *  unverändert nutzbar. */
  async function handleRefineSkillLevels() {
    const text = manualDetectText();
    const skillsToRefine = Array.from(courseSkillUris)
      .filter((uri) => skillLabelCache[uri])
      .map((uri) => ({ esco_uri: uri, preferred_label: skillLabelCache[uri] }));
    if (text.length < MIN_DESCRIPTION_FOR_SKILL_DETECT || skillsToRefine.length === 0) {
      setLevelRefineError("Bitte Kursname/-beschreibung sowie mindestens einen zugeordneten Skill angeben.");
      return;
    }
    setLevelRefineBusy(true);
    setLevelRefineError(null);
    try {
      const res = await fetchSkillLevelDetect(skillLevelDetectBaseUrl(baseUrl), apiKey, { text, skills: skillsToRefine });
      setCourseSkillLevels((prev) => {
        const next = { ...prev };
        for (const r of res.results) next[r.esco_uri] = r.experience_level;
        return next;
      });
    } catch (err) {
      setLevelRefineError(
        err instanceof Error ? err.message : "KI-Verfeinerung fehlgeschlagen — bisherige Schätzung bleibt bestehen."
      );
    } finally {
      setLevelRefineBusy(false);
    }
  }
  // ---------- Live-ESCO-Skill-Suche (siehe skillSearchQuery oben) ----------
  // Entprellte Direktsuche unabhaengig von Kurstext/Zielrolle — Treffer
  // kommen wie ueberall sonst aus dem LOKALEN Katalog-Matcher
  // (matchSkillsLocal), nie erfunden. Frueher fetchSkillMatch (echter
  // Backend-ESCO-Matcher) — das schrieb echte ESCO-URIs in courseSkillUris,
  // die die Journey-Gap-Analyse nie matchen konnte (siehe Kommentar bei
  // matchSkillsLocal oben). Der Name "ESCO-Skill-Suche" bleibt bewusst
  // stehen (UI-Text/Variablennamen unveraendert), nur die Datenquelle
  // dahinter ist jetzt der lokale Katalog.
  useEffect(() => {
    const q = skillSearchQuery.trim();
    if (q.length < 2) {
      setSkillSearchResults([]);
      setSkillSearchError(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSkillSearchBusy(true);
      setSkillSearchError(null);
      try {
        const matches = matchSkillsLocal(q, { maxResults: 10, minScore: 55 });
        if (cancelled) return;
        setSkillSearchResults(matches);
        setSkillLabelCache((prev) => {
          const next = { ...prev };
          for (const m of matches) next[m.esco_uri] = m.preferred_label;
          return next;
        });
      } catch (err) {
        if (cancelled) return;
        setSkillSearchError(err instanceof Error ? err.message : "Suche fehlgeschlagen.");
        setSkillSearchResults([]);
      } finally {
        if (!cancelled) setSkillSearchBusy(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillSearchQuery]);
  /** Übernimmt einen Treffer aus der Live-ESCO-Suche direkt in die Zuordnung
   *  — mit derselben Heuristik-Vorbelegung wie überall sonst. */
  function addSearchedSkill(m: MatchedSkill) {
    if (!courseSkillLevels[m.esco_uri]) {
      const guess = guessExperienceLevel(manualDetectText() || m.preferred_label, m.matched_on, m.preferred_label);
      setCourseSkillLevels((prev) => ({ ...prev, [m.esco_uri]: guess.level }));
    }
    setCourseSkillUris((prev) => new Set(prev).add(m.esco_uri));
  }
  // ---------- Zielrollen-Vorschläge (siehe targetRoleSuggestions oben) ----------
  // Rankt alle Zielrollen per bestehender Gap-Analyse (leerer Text-Trick
  // entfällt hier bewusst — der tatsächliche Kurstext wird genutzt) gegen
  // den aktuellen Kurstext und zeigt die besten Treffer als Vorschlags-Chips.
  useEffect(() => {
    if (tourOpen) return;
    const text = manualDetectText();
    if (text.length < MIN_DESCRIPTION_FOR_SKILL_DETECT || roles.length === 0) {
      setTargetRoleSuggestions([]);
      setTargetRoleSuggestAttempted(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setTargetRoleSuggestBusy(true);
      try {
        const results = await Promise.all(
          roles.slice(0, 15).map(async (role) => {
            try {
              const res = await fetchGapAnalysis(baseUrl, apiKey, { text, target_role_id: role.role_id, lang: ESCO_LANG });
              return { role, percentage: res.match_percentage };
            } catch {
              return { role, percentage: 0 };
            }
          })
        );
        if (cancelled) return;
        setTargetRoleSuggestions(
          results
            .filter((r) => r.percentage > 0)
            .sort((a, b) => b.percentage - a.percentage)
            .slice(0, 3)
        );
      } finally {
        if (!cancelled) {
          setTargetRoleSuggestBusy(false);
          setTargetRoleSuggestAttempted(true);
        }
      }
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseForm.courseName, courseForm.description, roles, tourOpen]);
  // Bereichs-Vorschläge (siehe suggestBereicheForText oben) — rein
  // synchron/lokal, deshalb ohne Debounce/Busy-State wie beim
  // Zielrollen-Abgleich oben (der echte Netzwerk-Calls macht).
  useEffect(() => {
    if (tourOpen || bereichKeysTouched) return;
    // Solange der Nutzer die Auswahl noch nicht selbst angefasst hat, live
    // vorausfuellen (15.09., "soll auch schon vorausgefüllt sein und
    // veränderbar") — sobald er einmal manuell togglet (oder ein Kurs mit
    // echten Bereichen geladen wird, siehe startEditCourse), uebernimmt er
    // die Kontrolle und hier wird nichts mehr ueberschrieben.
    const suggested = suggestBereicheForText(manualDetectText());
    setCourseForm((f) => ({ ...f, bereichKeys: suggested }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseForm.courseName, courseForm.description, tourOpen, bereichKeysTouched]);
  /** Fügt einen Bereich zur Mehrfachauswahl hinzu bzw. entfernt ihn wieder —
   *  gleiches Muster wie toggleCourseTargetRole unten. Markiert die Auswahl
   *  als vom Nutzer angefasst (siehe bereichKeysTouched oben), damit die
   *  Live-Vorausfüllung ab jetzt nichts mehr überschreibt. */
  function toggleCourseBereich(key: string) {
    setBereichKeysTouched(true);
    setCourseForm((f) => ({
      ...f,
      bereichKeys: f.bereichKeys.includes(key) ? f.bereichKeys.filter((k) => k !== key) : [...f.bereichKeys, key],
    }));
  }
  /** Fügt eine Zielrolle zur Mehrfachauswahl hinzu bzw. entfernt sie wieder
   *  (Klick auf einen bereits aktiven Vorschlag/Checkbox-Eintrag toggelt) —
   *  ersetzt das frühere Ein-Klick-Ersetzen aus der Zeit der Einzelauswahl. */
  function toggleCourseTargetRole(roleId: string) {
    setCourseForm((f) => ({
      ...f,
      targetRoleIds: f.targetRoleIds.includes(roleId)
        ? f.targetRoleIds.filter((id) => id !== roleId)
        : [...f.targetRoleIds, roleId],
    }));
  }
  /** Wählt eine bestehende Zielrolle aus der Combobox-Dropdown-Liste aus
   *  (Version 24) — fügt sie hinzu (nie doppelt) und räumt Suchfeld/Dropdown
   *  wieder auf, damit man direkt die nächste Rolle suchen kann. */
  function selectRoleFromCombo(roleId: string) {
    setCourseForm((f) => (f.targetRoleIds.includes(roleId) ? f : { ...f, targetRoleIds: [...f.targetRoleIds, roleId] }));
    setRoleComboQuery("");
    setRoleComboOpen(false);
  }
  function openNewRoleForm(prefillName: string) {
    setNewRoleFormOpen(true);
    setNewRoleName(prefillName.trim());
    setNewRoleSkillQuery("");
    setNewRoleSkillResults([]);
    setNewRoleSelectedSkills([]);
    setNewRoleError(null);
    setRoleComboOpen(false);
  }
  function closeNewRoleForm() {
    setNewRoleFormOpen(false);
    setNewRoleError(null);
  }
  function addNewRoleSkill(s: SkillSearchResult) {
    setNewRoleSelectedSkills((prev) =>
      prev.some((x) => x.esco_uri === s.esco_uri) ? prev : [...prev, { esco_uri: s.esco_uri, weight: 1 }]
    );
  }
  function removeNewRoleSkill(uri: string) {
    setNewRoleSelectedSkills((prev) => prev.filter((s) => s.esco_uri !== uri));
  }
  function setNewRoleSkillWeight(uri: string, weight: number) {
    if (!Number.isFinite(weight) || weight <= 0) return;
    setNewRoleSelectedSkills((prev) => prev.map((s) => (s.esco_uri === uri ? { ...s, weight } : s)));
  }
  // Entprellte ESCO-Skill-Suche fuers "+ Neue Zielrolle"-Mini-Formular —
  // dasselbe Muster wie bei skillSearchQuery oben, nur ueber
  // GET /api/v1/skills/search (Namenssuche) statt POST /api/v1/skill-match
  // (Freitext-Fuzzy-Match): hier soll gezielt nach einzelnen Skill-Begriffen
  // gesucht werden, nicht ein ganzer Text abgeglichen werden.
  useEffect(() => {
    if (!newRoleFormOpen) return;
    const q = newRoleSkillQuery.trim();
    if (q.length < 2) {
      setNewRoleSkillResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setNewRoleSkillSearchBusy(true);
      try {
        const res = await searchEscoSkills(baseUrl, apiKey, q, 15);
        if (cancelled) return;
        setNewRoleSkillResults(res.results);
        // In den geteilten Label-Cache mit aufnehmen (siehe skillLabelCache
        // oben) — so bleibt der Anzeigename eines schon ausgewählten Skills
        // auch dann verfügbar, wenn die Suchanfrage sich inzwischen geändert
        // hat und newRoleSkillResults ihn nicht mehr enthält.
        setSkillLabelCache((prev) => {
          const next = { ...prev };
          for (const s of res.results) next[s.esco_uri] = s.preferred_label;
          return next;
        });
      } catch {
        if (!cancelled) setNewRoleSkillResults([]);
      } finally {
        if (!cancelled) setNewRoleSkillSearchBusy(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newRoleSkillQuery, newRoleFormOpen]);
  /** Legt die neue Zielrolle an (POST /api/v1/target-roles) und übernimmt sie
   *  direkt in die Auswahl des aktuellen Kurses — spart den Umweg, sie nach
   *  dem Anlegen erst wieder suchen zu müssen. */
  async function handleCreateNewRole() {
    const name = newRoleName.trim();
    if (!name) {
      setNewRoleError("Bitte einen Namen für die Zielrolle eingeben.");
      return;
    }
    if (newRoleSelectedSkills.length === 0) {
      setNewRoleError("Bitte mindestens einen Skill hinzufügen.");
      return;
    }
    // role_id wird aus dem Namen abgeleitet (wie z.B. "data-analyst") — bei
    // einer Kollision mit einer bestehenden role_id haengt der Server das
    // Anlegen nicht ab, sondern ERSETZT deren Skill-Profil (Upsert), siehe
    // upsertTargetRole im Backend. Ein Zeitstempel-Suffix bei Kollision
    // verhindert das versehentliche Ueberschreiben einer fremden Rolle.
    const baseSlug =
      name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "rolle";
    const roleId = roles.some((r) => r.role_id === baseSlug) ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug;
    setNewRoleBusy(true);
    setNewRoleError(null);
    try {
      await upsertTargetRole(baseUrl, apiKey, { role_id: roleId, role_name: name, skills: newRoleSelectedSkills });
      setRoles((prev) => [...prev, { role_id: roleId, role_name: name, required_skill_count: newRoleSelectedSkills.length }]);
      setCourseForm((f) => ({ ...f, targetRoleIds: [...f.targetRoleIds, roleId] }));
      closeNewRoleForm();
    } catch (err) {
      setNewRoleError(err instanceof Error ? err.message : "Zielrolle konnte nicht angelegt werden.");
    } finally {
      setNewRoleBusy(false);
    }
  }
  // ---------- Kurzbeschreibung per KI vorschlagen ----------
  async function handleSuggestDescription() {
    const courseName = courseForm.courseName.trim();
    if (!courseName) {
      setDescSuggestError("Bitte zuerst einen Kursnamen eingeben.");
      return;
    }
    // Ohne bestehende Verbindung (siehe `live`) lief dieser Klick bisher direkt
    // in einen 401/403 vom course-copy-assist-Endpunkt, der als generische
    // "Zugriff verweigert"-Meldung ankam und leicht mit einem echten Server-
    // Defekt verwechselt werden konnte. Stattdessen hier vorab klarstellen,
    // dass zuerst oben im Verbindungs-Panel "Verbinden & laden" nötig ist.
    if (!live) {
      setDescSuggestError(
        'Nicht verbunden — bitte zuerst oben im Verbindungs-Panel „Verbinden & laden" klicken.'
      );
      return;
    }
    setDescSuggestBusy(true);
    setDescSuggestError(null);
    try {
      const res = await fetchCourseCopyAssist(courseCopyAssistBaseUrl(baseUrl), apiKey, {
        course_name: courseName,
        raw_text: courseForm.description.trim(),
      });
      if (res.suggested_description) {
        setCourseForm((f) => ({ ...f, description: res.suggested_description }));
      } else {
        setDescSuggestError("Kein Vorschlag erhalten — bitte Kursname/Beschreibung prüfen.");
      }
    } catch (err) {
      setDescSuggestError(err instanceof Error ? err.message : "Beschreibungs-Vorschlag gerade nicht verfügbar.");
    } finally {
      setDescSuggestBusy(false);
    }
  }
  // ---------- Kurs-Import per URL/Domain ----------
  //
  // Obergrenze fuer die automatische Vorauswahl nach "Kurs-Seiten finden" —
  // bewusst niedrig gehalten, damit ein Klick auf "Ausgewaehlte importieren"
  // nicht versehentlich dutzende teure LLM-Aufrufe auf einmal lostritt; der
  // Bildungstraeger kann trotzdem beliebig viele der gefundenen URLs manuell
  // dazu-haken.
  const URL_IMPORT_AUTO_SELECT_LIMIT = 15;

  // Dieselbe Slug-Logik wie bei role_id in handleCreateRole (siehe dort) -
  // fuer Konsistenz unveraendert uebernommen, statt eine zweite,
  // abweichende Transliteration (z.B. "ä" -> "ae" statt nur "a") einzufuehren.
  function slugifyForCourseId(name: string): string {
    const base = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return base || "kurs";
  }

  /** Haengt bei Kollision "-2"/"-3"/... an, damit ein importierter Entwurf nie
   *  versehentlich einen bestehenden Kurs per gleicher Kurs-ID ueberschreibt
   *  (upsertCourse() ERSETZT den kompletten Datensatz, siehe Kommentar dort). */
  function uniqueCourseId(base: string): string {
    const existingIds = new Set(courses.map((c) => c.course_id));
    if (!existingIds.has(base)) return base;
    let i = 2;
    while (existingIds.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  }

  /** Uebernimmt einen Extraktions-Entwurf ins bestehende manuelle Formular
   *  (courseForm) statt einen zweiten, parallelen Speicher-Pfad zu bauen —
   *  die Pruefung/Korrektur passiert dadurch an genau der Stelle, die
   *  ohnehin schon jedes Feld/jede Validierung kennt. editingCourseId wird
   *  bewusst zurueckgesetzt: ein importierter Entwurf ist IMMER ein neuer
   *  Kurs, nie eine versehentliche Aktualisierung eines bestehenden. */
  function applyCourseUrlDraftToForm(res: CourseUrlExtractResponse) {
    const d = res.course;
    const name = d.course_name?.trim() ?? "";
    setEditingCourseId(null);
    setCourseForm(() => ({
      ...DEFAULT_COURSE_FORM,
      courseId: name ? uniqueCourseId(slugifyForCourseId(name)) : "",
      courseName: name,
      // provider ist im Formular ein Pflichtfeld (siehe disabled-Bedingung am
      // "Kurs speichern"-Button), wird von der Extraktion aber oft nicht
      // sicher gefunden (auf Kurs-Seiten steht meist nur der Markenname im
      // Seitenkopf, nicht als eigenes "Anbieter"-Feld). Fallback auf
      // tenantName statt etwas zu erfinden — derselbe Wert, den auch
      // resetCourseForm()/das leere Formular per Default nutzt.
      provider: d.provider?.trim() || tenantName,
      description: d.description?.trim() ?? "",
      durationWeeks: d.duration_weeks != null ? String(Math.max(1, Math.round(d.duration_weeks))) : DEFAULT_COURSE_FORM.durationWeeks,
      durationUnit: "weeks",
      // locationMode/employmentMode sind echte Pflichtfelder ohne leeren
      // Zustand (siehe CourseFormState-Kommentar) — nur ueberschreiben, wenn
      // die Extraktion wirklich etwas gefunden hat, sonst beim Default
      // bleiben statt einen leeren/falschen Wert zu erzwingen.
      locationMode: d.location_mode ?? DEFAULT_COURSE_FORM.locationMode,
      employmentMode: d.employment_mode ?? DEFAULT_COURSE_FORM.employmentMode,
      startsAt: d.starts_at ?? "",
      priceEur: d.price_eur != null ? String(d.price_eur) : "",
      priceVatExempt: d.price_vat_exempt ?? false,
      examFeeEur: d.exam_fee_eur != null ? String(d.exam_fee_eur) : "",
      teachingUnits: d.teaching_units != null ? String(d.teaching_units) : "",
      fundingTypes: d.funding_types ?? [],
      fundingMeasureNumber: d.funding_measure_number?.trim() ?? "",
      qualificationType: d.qualification_type ?? "",
      dqrLevel: d.dqr_level != null ? String(d.dqr_level) : "",
      targetGroup: d.target_group?.trim() ?? "",
    }));
    setUrlImportVerifiedFields(res.verified_fields);
    setUrlImportDurationHint(d.duration_hint?.trim() || null);
    setCourseFormOpen(true);
    window.setTimeout(() => courseFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function handleDiscoverCourseUrls() {
    const domain = urlImportDomain.trim();
    if (!domain) {
      setUrlImportDiscoverError("Bitte zuerst eine Domain eingeben.");
      return;
    }
    if (!live) {
      setUrlImportDiscoverError(
        'Nicht verbunden — bitte zuerst oben im Verbindungs-Panel „Verbinden & laden" klicken.'
      );
      return;
    }
    setUrlImportDiscoverBusy(true);
    setUrlImportDiscoverError(null);
    setUrlImportCandidates([]);
    setUrlImportSelected(new Set());
    try {
      const res = await fetchCourseUrlDiscover(courseUrlImportBaseUrl(baseUrl), apiKey, { domain });
      setUrlImportCandidates(res.candidate_urls);
      setUrlImportSitemapUrl(res.sitemap_url);
      setUrlImportTruncated(res.truncated);
      setUrlImportSelected(new Set(res.candidate_urls.slice(0, URL_IMPORT_AUTO_SELECT_LIMIT)));
      if (res.candidate_urls.length === 0) {
        setUrlImportDiscoverError(
          "Keine Kurs-typischen URLs in der Sitemap gefunden — bitte stattdessen eine einzelne Kurs-Seiten-URL unten einfügen."
        );
      }
    } catch (err) {
      setUrlImportDiscoverError(err instanceof Error ? err.message : "Domain konnte nicht durchsucht werden.");
    } finally {
      setUrlImportDiscoverBusy(false);
    }
  }

  function toggleUrlImportCandidate(url: string) {
    setUrlImportSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function runUrlImportExtraction(url: string) {
    setUrlImportExtractBusy(true);
    setUrlImportExtractError(null);
    setUrlImportCurrentUrl(url);
    // Fortschritts-Reset fuer die "Ladephase"-Anzeige (url-import-progress
    // weiter unten): ohne das wuerden bei mehreren Kursen in der
    // Warteschlange kurz die Skill-/Zielrollen-Ergebnisse des VORHERIGEN
    // Kurses als "fertig" angezeigt, waehrend der naechste noch laedt.
    setManualSuggestedSkills([]);
    setManualSkillDetectError(null);
    setTargetRoleSuggestions([]);
    setTargetRoleSuggestAttempted(false);
    try {
      const res = await fetchCourseUrlExtract(courseUrlImportBaseUrl(baseUrl), apiKey, { url });
      applyCourseUrlDraftToForm(res);
    } catch (err) {
      setUrlImportExtractError(err instanceof Error ? err.message : `Konnte nicht gelesen werden: ${url}`);
    } finally {
      setUrlImportExtractBusy(false);
    }
  }

  /** Startet die "ein Kurs nach dem anderen"-Warteschlange mit den
   *  ausgewaehlten Kandidaten-URLs — die erste wird sofort extrahiert, die
   *  weiteren folgen erst per "Weiter zum naechsten Kurs" (siehe
   *  advanceUrlImportQueue), NICHT automatisch alle auf einmal: jeder Entwurf
   *  soll erst geprueft/gespeichert oder bewusst uebersprungen werden. */
  function startUrlImportQueue(urls: string[]) {
    if (urls.length === 0 || !live) {
      if (!live) {
        setUrlImportDiscoverError(
          'Nicht verbunden — bitte zuerst oben im Verbindungs-Panel „Verbinden & laden" klicken.'
        );
      }
      return;
    }
    setUrlImportQueue(urls.slice(1));
    setUrlImportQueueTotal(urls.length);
    setUrlImportQueueDone(0);
    void runUrlImportExtraction(urls[0]);
  }

  function advanceUrlImportQueue() {
    setUrlImportQueueDone((n) => n + 1);
    setUrlImportQueue((prev) => {
      if (prev.length === 0) {
        setUrlImportCurrentUrl(null);
        return prev;
      }
      const [next, ...rest] = prev;
      void runUrlImportExtraction(next);
      return rest;
    });
  }

  function handleImportSingleUrl() {
    const url = urlImportSingleUrl.trim();
    if (!url) {
      setUrlImportDiscoverError("Bitte zuerst eine Kurs-Seiten-URL einfügen.");
      return;
    }
    startUrlImportQueue([url]);
  }

  function endUrlImportQueue() {
    setUrlImportQueue([]);
    setUrlImportQueueTotal(0);
    setUrlImportQueueDone(0);
    setUrlImportCurrentUrl(null);
    setUrlImportExtractError(null);
  }

  // ---------- URL-Import: Warteschlange "später fortsetzen" ----------
  // Pro API-Key ein eigener localStorage-Eintrag (mehrere Bildungstraeger
  // koennten theoretisch denselben Browser nutzen) — rein clientseitig,
  // nichts davon geht ans Backend. Bewusst best-effort: schlaegt
  // localStorage fehl (privater Modus o.ae.), geht die Warteschlange beim
  // Verlassen der Seite halt verloren, wie bisher — kein harter Fehler.
  function urlImportQueueStorageKey(): string {
    return `dyd_orbit_url_import_queue::${apiKey}`;
  }
  function clearPersistedUrlImportQueue() {
    try {
      window.localStorage.removeItem(urlImportQueueStorageKey());
    } catch {
      // siehe Kommentar oben
    }
  }
  // Spiegelt die aktuelle Warteschlange (aktuell geladene URL + noch nicht
  // begonnene) bei jeder Aenderung in localStorage — inkl. dem Leerzustand,
  // wodurch ein natuerlich zuende gelaufener oder per "Import beenden"
  // abgebrochener Import den gespeicherten Eintrag automatisch wieder
  // entfernt, ohne dass endUrlImportQueue() das separat tun muss.
  useEffect(() => {
    if (!apiKey) return;
    const remaining = urlImportCurrentUrl ? [urlImportCurrentUrl, ...urlImportQueue] : urlImportQueue;
    try {
      if (remaining.length === 0) {
        window.localStorage.removeItem(urlImportQueueStorageKey());
      } else {
        window.localStorage.setItem(
          urlImportQueueStorageKey(),
          JSON.stringify({ remainingUrls: remaining, total: urlImportQueueTotal, done: urlImportQueueDone })
        );
      }
    } catch {
      // siehe Kommentar oben
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlImportQueue, urlImportCurrentUrl, urlImportQueueTotal, urlImportQueueDone, apiKey]);
  // Einmaliger Check beim Verbinden, ob aus einer fruehren Sitzung noch eine
  // offene Warteschlange existiert — zeigt dann das Fortsetzen/Verwerfen-
  // Banner an, statt automatisch loszulaufen (der Mensch entscheidet).
  useEffect(() => {
    if (!apiKey || urlImportQueueTotal > 0) return;
    try {
      const raw = window.localStorage.getItem(urlImportQueueStorageKey());
      if (!raw) return;
      const saved = JSON.parse(raw) as { remainingUrls?: unknown; total?: unknown; done?: unknown };
      if (Array.isArray(saved.remainingUrls) && saved.remainingUrls.length > 0) {
        setUrlImportResumeAvailable({
          remainingUrls: saved.remainingUrls as string[],
          total: typeof saved.total === "number" ? saved.total : saved.remainingUrls.length,
          done: typeof saved.done === "number" ? saved.done : 0,
        });
      }
    } catch {
      // korrupter/fehlender Eintrag - einfach ignorieren
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);
  function handleResumeUrlImportQueue() {
    if (!urlImportResumeAvailable) return;
    const { remainingUrls, total, done } = urlImportResumeAvailable;
    setUrlImportResumeAvailable(null);
    setUrlImportQueue(remainingUrls.slice(1));
    setUrlImportQueueTotal(total);
    setUrlImportQueueDone(done);
    void runUrlImportExtraction(remainingUrls[0]);
  }
  function discardUrlImportResume() {
    setUrlImportResumeAvailable(null);
    clearPersistedUrlImportQueue();
  }

  // ---------- Modulhandbuch-Upload ----------
  //
  // Modulhandbuecher koennen sehr gross sein (mehrere hundert Seiten). Frueher
  // wurde der extrahierte Text VOR jeder Analyse auf 12.000 Zeichen gekuerzt —
  // schnell, aber verlustbehaftet: Skills, die erst spaeter im Dokument
  // auftauchen, wurden nie gefunden. Die beiden Analyseschritte bleiben
  // bewusst getrennt, mit unterschiedlichem Kompromiss:
  //  1. Der lokale Katalog-Matcher (matchSkillsLocal, siehe Kommentar dort
  //     oben) laeuft in EINEM synchronen Durchgang ueber das KOMPLETTE
  //     Dokument (bis HANDBOOK_MATCH_MAX_CHARS) — kein Netzwerk-Roundtrip
  //     mehr noetig, also auch kein Grund mehr fuer die frueher hier
  //     verwendete Chunk-Faecherung (die war reine Nebenwirkung des
  //     HTTP-Payload-/Parallelitaets-Kompromisses beim Backend-ESCO-Aufruf,
  //     fetchSkillMatch, und hat als Nebenwirkung sogar Verneinungen an
  //     Chunk-Grenzen zerreissen koennen — z.B. "keine Erfahrung mit" am Ende
  //     eines Chunks, "SQL" erst im naechsten).
  //  2. Der teure LLM-Aufruf fuer die Kursbeschreibung (fetchCourseCopyAssist)
  //     bekommt bewusst NICHT das ganze Dokument, sondern nur den
  //     Dokument-Anfang plus die Namen der bereits vollstaendig erkannten
  //     Skills aus Schritt 1 — bleibt dadurch klein/schnell, ist aber inhaltlich
  //     durch die komplette Analyse informiert statt durch einen zufaellig
  //     abgeschnittenen Rohausschnitt.
  const HANDBOOK_MATCH_MAX_CHARS = 160_000; // gleiche Obergrenze wie zuvor implizit durch HANDBOOK_CHUNK_CHARS(4000) * HANDBOOK_MAX_CHUNKS(40) — Deckel gegen absurd grosse Dateien
  const HANDBOOK_INTRO_CHARS = 2000;

  function filenameToCourseName(filename: string): string {
    const base = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    return base.length > 0 ? base : "Neuer Kurs";
  }
  function handleHandbookUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // erlaubt erneutes Hochladen derselben Datei
    if (!file) return;
    void runHandbookAnalysis(file);
  }
  async function runHandbookAnalysis(file: File) {
    setHandbookFileName(file.name);
    setHandbookError(null);
    setHandbookStage("reading");
    let extractedText = "";
    try {
      // Wiederverwendet denselben Extraktions-Endpunkt wie der
      // Lebenslauf-Upload der Journey (PDF/DOCX/TXT, siehe core.ts) —
      // liefert bei zu grossen/ungeeigneten Dateien bereits freundliche,
      // konkrete Fehlermeldungen (z.B. "Datei ist zu gross").
      const res = await extractDocumentText(baseUrl, apiKey, file);
      extractedText = res.text;
    } catch (err) {
      setHandbookError(err instanceof Error ? err.message : "Datei konnte nicht gelesen werden.");
      setHandbookStage("");
      return;
    }
    if (!extractedText.trim()) {
      setHandbookError("Aus der Datei konnte kein Text extrahiert werden.");
      setHandbookStage("");
      return;
    }
    if (!courseForm.courseName.trim()) {
      setCourseForm((f) => ({ ...f, courseName: filenameToCourseName(file.name) }));
    }
    const courseName = courseForm.courseName.trim() || filenameToCourseName(file.name);

    // ---------- Schritt 1: Skills auf dem KOMPLETTEN Dokument abgleichen ----------
    setHandbookStage("matching");
    let allMatches: MatchedSkill[];
    try {
      const clean = extractedText.replace(/\r\n/g, "\n").trim().slice(0, HANDBOOK_MATCH_MAX_CHARS);
      allMatches = matchSkillsLocal(clean, { maxResults: 40, minScore: 55 });
    } catch (err) {
      setHandbookError(err instanceof Error ? err.message : "Skill-Erkennung aus dem Handbuch fehlgeschlagen.");
      setHandbookStage("");
      return;
    }
    setManualSuggestedSkills((prev) => {
      const existingUris = new Set([...prev.map((m) => m.esco_uri), ...courseSkillUris]);
      return [...prev, ...allMatches.filter((m) => !existingUris.has(m.esco_uri))];
    });
    setSkillLabelCache((prev) => {
      const next = { ...prev };
      for (const m of allMatches) next[m.esco_uri] = m.preferred_label;
      return next;
    });

    // ---------- Schritt 2: Kurzbeschreibung per KI + KI-Skill-Vertiefung, ----------
    // beide auf demselben kompakten Digest (Dokument-Anfang + bereits per
    // Fuzzy-Abgleich erkannte Skill-Namen als Kontext) — siehe Kommentar oben,
    // warum bewusst NICHT das ganze Dokument. Beide Aufrufe sind optional und
    // laufen parallel: Schritt 1 hat die Skills bereits vollstaendig UND
    // woertlich erkannt, das hier ergaenzt nur noch die Beschreibung und
    // zusaetzliche, nur UMSCHRIEBEN im Text vorkommende Skills der
    // ausgewaehlten Zielrolle(n) (siehe handleDetectSkillsWithAI).
    setHandbookStage("analyzing");
    const intro = extractedText.replace(/\r\n/g, "\n").trim().slice(0, HANDBOOK_INTRO_CHARS);
    const skillDigest = allMatches.slice(0, 25).map((m) => m.preferred_label).join(", ");
    const digestText = skillDigest ? `${intro}\n\nErkannte Themen/Skills: ${skillDigest}` : intro;
    const copyAssistPromise = fetchCourseCopyAssist(courseCopyAssistBaseUrl(baseUrl), apiKey, {
      course_name: courseName,
      raw_text: digestText,
    }).catch(() => null);
    const depthRoleIds = courseForm.targetRoleIds.slice(0, 3);
    const depthPromise =
      depthRoleIds.length > 0
        ? Promise.allSettled(
            depthRoleIds.map((roleId) => fetchDepthAnalysis(depthAnalysisBaseUrl(baseUrl), apiKey, { text: intro, target_role_id: roleId }))
          )
        : Promise.resolve([] as PromiseSettledResult<DepthAnalysisResponse>[]);
    const [assist, depthResults] = await Promise.all([copyAssistPromise, depthPromise]);
    if (assist?.suggested_description && !courseForm.description.trim()) {
      setCourseForm((f) => ({ ...f, description: assist.suggested_description }));
    }
    // KI-Beschreibung ist optional — die Skills aus Schritt 1 sind bereits
    // vollstaendig erkannt und unabhaengig davon nutzbar, siehe
    // SUPABASE_FUNCTION_course-copy-assist.md.
    const depthBestByUri = new Map<string, DepthSkillAssessment>();
    for (const r of depthResults) {
      if (r.status !== "fulfilled") continue;
      for (const s of r.value.skills) {
        if (!s.evidence_found) continue;
        const existing = depthBestByUri.get(s.esco_uri);
        if (!existing || confidenceRank(s.confidence) > confidenceRank(existing.confidence)) {
          depthBestByUri.set(s.esco_uri, s);
        }
      }
    }
    if (depthBestByUri.size > 0) {
      const depthMatches = Array.from(depthBestByUri.values()).map(depthAssessmentToMatchedSkill);
      setManualSuggestedSkills((prev) => {
        const existingUris = new Set([...prev.map((m) => m.esco_uri), ...courseSkillUris]);
        return [...prev, ...depthMatches.filter((m) => !existingUris.has(m.esco_uri))];
      });
      setSkillLabelCache((prev) => {
        const next = { ...prev };
        for (const m of depthMatches) next[m.esco_uri] = m.preferred_label;
        return next;
      });
    }
    setHandbookStage("done");
  }
  /** Liest und parst eine CSV-Datei — von processImportFile(File) direkt
   *  aufrufbar (Drag&Drop, siehe .csv-dropzone) UND über handleImportFile
   *  (klassischer <input type="file">-onChange). */
  function processImportFile(file: File) {
    resetImport();
    setImportFileName(file.name);
    file
      .text()
      .then((text) => {
        const parsed = parseCsv(text);
        if (parsed.length < 2) {
          setImportParseError("Die Datei enthält keine erkennbaren Datenzeilen (nur eine Kopfzeile oder leer).");
          return;
        }
        const [header, ...dataRows] = parsed;
        setImportHeaders(header);
        setImportDataRows(dataRows);
        setImportMapping(guessImportMapping(header));
      })
      .catch(() => setImportParseError("Datei konnte nicht gelesen werden — bitte als CSV (UTF-8) erneut exportieren."));
  }
  function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // erlaubt erneutes Hochladen derselben Datei
    if (!file) return;
    processImportFile(file);
  }
  /** Baut aus den rohen CSV-Zeilen + der aktuellen Spalten-Zuordnung eine
   * Vorschau samt Validierung — dieselbe Funktion liefert auch die Zeilen, die
   * beim eigentlichen Import tatsächlich verschickt werden. */
  function buildImportPreview(): ImportRowResult[] {
    const usedIds = new Set<string>();
    return importDataRows.map((cols, idx) => {
      const rawName = importMapping.courseName >= 0 ? (cols[importMapping.courseName] ?? "").trim() : "";
      const rawProvider = importMapping.provider >= 0 ? (cols[importMapping.provider] ?? "").trim() : "";
      const rawDuration = importMapping.durationWeeks >= 0 ? (cols[importMapping.durationWeeks] ?? "").trim() : "";
      const description = importMapping.description >= 0 ? (cols[importMapping.description] ?? "").trim() : "";
      let courseId = importMapping.courseId >= 0 ? (cols[importMapping.courseId] ?? "").trim() : "";
      if (!courseId && rawName) courseId = slugifyCourseId(rawName);
      if (courseId && usedIds.has(courseId)) {
        let n = 2;
        while (usedIds.has(`${courseId}-${n}`)) n++;
        courseId = `${courseId}-${n}`;
      }
      if (courseId) usedIds.add(courseId);
      const durationWeeks = rawDuration ? parseDurationWeeks(rawDuration) : null;
      // Preis/UE: reine Zahlenspalten, tolerant gegenüber "2.590,00 €" o.ä.
      // (gleiche Komma->Punkt-Normalisierung wie parseDurationWeeks oben) —
      // nicht erkennbar = null, zaehlt NICHT als Import-Fehler (anders als
      // die Dauer), da beide Felder optional sind.
      const rawPrice = importMapping.priceEur >= 0 ? (cols[importMapping.priceEur] ?? "").trim() : "";
      const priceMatch = rawPrice.replace(/\./g, "").replace(",", ".").match(/[\d.]+/);
      const priceEur = priceMatch ? Math.round(parseFloat(priceMatch[0]) * 100) / 100 : null;
      const rawUnits = importMapping.teachingUnits >= 0 ? (cols[importMapping.teachingUnits] ?? "").trim() : "";
      const unitsMatch = rawUnits.replace(",", ".").match(/[\d.]+/);
      const teachingUnits = unitsMatch ? Math.round(parseFloat(unitsMatch[0])) : null;
      const fundingMeasureNumber =
        importMapping.fundingMeasureNumber >= 0 ? (cols[importMapping.fundingMeasureNumber] ?? "").trim() : "";
      const targetGroup = importMapping.targetGroup >= 0 ? (cols[importMapping.targetGroup] ?? "").trim() : "";
      let reason: string | undefined;
      if (!rawName) reason = "Kein Kursname";
      else if (!courseId) reason = "Keine Kurs-ID ableitbar";
      else if (durationWeeks === null) reason = "Dauer nicht erkannt";
      return {
        index: idx,
        courseId,
        courseName: rawName,
        provider: rawProvider,
        durationWeeks,
        description,
        priceEur,
        teachingUnits,
        fundingMeasureNumber,
        targetGroup,
        valid: !reason,
        reason,
        willUpdate: courses.some((c) => c.course_id === courseId),
      };
    });
  }
  /** Schickt die Beschreibung jeder gültigen, gemappten Import-Zeile durch
   *  dieselbe Skill-Match-Engine wie handleDetectManualSkills — läuft
   *  sequenziell wie handleRunImport (kein Bulk-Endpunkt), damit sich
   *  Fortschritt anzeigen lässt und ein einzelner Fehler nicht alle anderen
   *  Zeilen abbricht. Anders als im manuellen Formular werden Treffer HIER
   *  direkt als "übernommen" vorbelegt (importApprovedSkillUris) — bei vielen
   *  Zeilen wäre ein Klick pro Skill zu mühsam; die eigentliche Freigabe
   *  passiert stattdessen durch Entfernen falscher Vorschläge (Chip-"×") vor
   *  dem Klick auf "Kurse importieren" weiter unten. */
  async function handleDetectImportSkills() {
    if (importMapping.description < 0) return;
    const rows = buildImportPreview().filter((r) => r.valid && r.description.length >= MIN_DESCRIPTION_FOR_SKILL_DETECT);
    if (rows.length === 0) return;
    setImportSkillDetectBusy(true);
    setImportSkillDetectError(null);
    setImportSkillDetectProgress({ done: 0, total: rows.length });
    const nextSuggestions: Record<number, MatchedSkill[]> = {};
    const nextApproved: Record<number, string[]> = {};
    const nextLevels: Record<number, Record<string, ExperienceLevel>> = {};
    let failedCount = 0;
    for (const row of rows) {
      try {
        // Namensbasiertes Matching wie im manuellen Formular (siehe
        // manualDetectText): Kursname + Beschreibung kombiniert, statt nur die
        // Beschreibungs-Spalte — "Namen mit Skills gematcht". Nutzt denselben
        // lokalen Katalog wie ueberall sonst im Dashboard (matchSkillsLocal) —
        // frueher fetchSkillMatch (Backend-ESCO), dessen Treffer hier OHNE
        // Review automatisch als "übernommen" vorbelegt wurden (siehe
        // Kommentar oben) und dadurch besonders zuverlaessig Kurse mit einem
        // Skill-Namensraum importierten, den die Journey-Gap-Analyse nie
        // matchen konnte.
        const detectText = [row.courseName, row.description].filter(Boolean).join(". ");
        const matches = matchSkillsLocal(detectText, { maxResults: 8, minScore: 60 });
        nextSuggestions[row.index] = matches;
        nextApproved[row.index] = matches.map((m) => m.esco_uri);
        const levels: Record<string, ExperienceLevel> = {};
        for (const m of matches) {
          levels[m.esco_uri] = guessExperienceLevel(detectText, m.matched_on, m.preferred_label).level;
        }
        nextLevels[row.index] = levels;
        setSkillLabelCache((prev) => {
          const next = { ...prev };
          for (const m of matches) next[m.esco_uri] = m.preferred_label;
          return next;
        });
      } catch {
        failedCount++;
      } finally {
        setImportSkillDetectProgress((p) => ({ ...p, done: p.done + 1 }));
        // Lokales Matching ist synchron/CPU-gebunden statt Netzwerk-I/O — ohne
        // diesen kurzen Yield wuerde der Fortschrittsbalken bei vielen Zeilen
        // nicht mehr sichtbar mitlaufen, sondern erst ganz am Ende auf einmal
        // springen (kein natuerliches await mehr, das dem Browser Zeit zum
        // Neuzeichnen gibt).
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    setImportSkillSuggestions((prev) => ({ ...prev, ...nextSuggestions }));
    setImportApprovedSkillUris((prev) => ({ ...prev, ...nextApproved }));
    setImportSkillLevels((prev) => ({ ...prev, ...nextLevels }));
    if (failedCount > 0) {
      setImportSkillDetectError(
        `${failedCount} von ${rows.length} Beschreibungen konnten nicht geprüft werden — bei den betroffenen Kursen bitte Skills nach dem Import über „✎ Bearbeiten" ergänzen.`
      );
    }
    setImportSkillDetectBusy(false);
  }
  /** Entfernt/ergänzt einen einzelnen vorgeschlagenen Skill an einer
   *  Import-Zeile — die eigentliche "Freigabe" vor dem Import (siehe
   *  Kommentar bei handleDetectImportSkills). */
  function toggleImportApprovedSkillUri(rowIndex: number, uri: string) {
    setImportApprovedSkillUris((prev) => {
      const current = prev[rowIndex] ?? [];
      const next = current.includes(uri) ? current.filter((u) => u !== uri) : [...current, uri];
      return { ...prev, [rowIndex]: next };
    });
  }
  /** Setzt/überschreibt das Erfahrungslevel eines Skill-Vorschlags einer
   *  Import-Zeile (siehe importSkillLevels/setCourseSkillLevel oben). */
  function setImportSkillLevel(rowIndex: number, uri: string, level: ExperienceLevel) {
    setImportSkillLevels((prev) => ({
      ...prev,
      [rowIndex]: { ...(prev[rowIndex] ?? {}), [uri]: level },
    }));
  }
  async function handleRunImport() {
    const rows = buildImportPreview().filter((r) => r.valid);
    if (rows.length === 0) return;
    setImportBusy(true);
    setImportSummary(null);
    setImportProgress({ done: 0, total: rows.length });
    let ok = 0;
    const errors: string[] = [];
    // Nachschlagewerk für "willUpdate"-Zeilen (siehe ImportRowResult) —
    // upsertCourse ERSETZT den kompletten Kurs, ohne dieses Nachschlagewerk
    // würde ein CSV-Reimport einer bereits bestehenden Kurs-ID alle Felder
    // loeschen, die die CSV-Spalten gar nicht abdecken (location_mode,
    // Preis/Förderung etc. — gleiches Prinzip wie bei handleUpdateBanner oben).
    const existingByCourseId = new Map(courses.map((c) => [c.course_id, c]));
    for (const row of rows) {
      try {
        const approvedUris = importApprovedSkillUris[row.index] ?? [];
        const rowLevels = importSkillLevels[row.index] ?? {};
        const coveredSkills: CourseSkillEntry[] = approvedUris.map((uri) => ({
          esco_uri: uri,
          experience_level: rowLevels[uri] ?? null,
        }));
        const saved = await upsertCourse(baseUrl, apiKey, {
          course_id: row.courseId,
          course_name: row.courseName,
          provider: row.provider,
          duration_weeks: row.durationWeeks ?? 1,
          description: row.description || undefined,
          // Freigegebene (bzw. nicht wieder entfernte) automatisch erkannte
          // Skills, siehe handleDetectImportSkills/toggleImportApprovedSkillUri.
          // Ohne vorherige Erkennung (kein Beschreibungs-Mapping, kein Klick auf
          // "Skills ermitteln") einfach leer — wie bisher.
          covered_skill_uris: approvedUris,
          // Zusaetzlich mit Erfahrungslevel je Skill, siehe covered_skills oben.
          covered_skills: coveredSkills,
          // Siehe ImportMapping-Kommentar oben — nur die vier reinen Text-/
          // Zahlenfelder, die sich zuverlaessig auf eine einzelne Spalte
          // abbilden lassen. ACHTUNG: upsertCourse ERSETZT den kompletten
          // Kurs (siehe Kommentar bei employment_mode in handleUpdateBanner
          // oben) — bei "willUpdate"-Zeilen (siehe ImportRowResult) wuerde
          // ein CSV-Reimport diese UND die uebrigen neuen, hier nicht per
          // Spalte gemappten Felder sonst stillschweigend loeschen, wenn sie
          // zuvor im manuellen Formular gepflegt wurden. Deshalb bei
          // bestehender Kurs-ID jeweils den bisherigen Wert als Fallback
          // uebernehmen, statt hart null zu setzen.
          price_eur: row.priceEur ?? existingByCourseId.get(row.courseId)?.price_eur ?? null,
          teaching_units: row.teachingUnits ?? existingByCourseId.get(row.courseId)?.teaching_units ?? null,
          funding_measure_number:
            row.fundingMeasureNumber || existingByCourseId.get(row.courseId)?.funding_measure_number || null,
          target_group: row.targetGroup || existingByCourseId.get(row.courseId)?.target_group || null,
          price_vat_exempt: existingByCourseId.get(row.courseId)?.price_vat_exempt ?? null,
          exam_fee_eur: existingByCourseId.get(row.courseId)?.exam_fee_eur ?? null,
          funding_types: existingByCourseId.get(row.courseId)?.funding_types ?? null,
          qualification_type: existingByCourseId.get(row.courseId)?.qualification_type ?? null,
          dqr_level: existingByCourseId.get(row.courseId)?.dqr_level ?? null,
          // Bug-Fix 15.09.: bereich_key(s) fehlten hier komplett — da
          // upsertCourse den Kurs komplett ersetzt, hat jeder CSV-(Re-)Import
          // einen zuvor im Formular gesetzten Bereich stillschweigend
          // geloescht ("warum kann ich bei den Kursen nicht die Kategorie
          // auswaehlen"). Gleicher Fallback wie bei price_eur usw. oben: alten
          // Wert behalten, wenn die CSV-Zeile selbst keinen liefert. Fehlt
          // auch der, wird lokal aus Kursname+Beschreibung vorgeschlagen
          // (suggestBereicheForText, siehe Kommentar dort) — reine
          // Bestenfalls-Automatik ohne Aenderung an der externen
          // course-url-import Edge Function.
          bereich_key:
            existingByCourseId.get(row.courseId)?.bereich_key ??
            suggestBereicheForText(`${row.courseName} ${row.description ?? ""}`)[0] ??
            null,
          bereich_keys:
            existingByCourseId.get(row.courseId)?.bereich_keys ??
            (() => {
              const suggested = suggestBereicheForText(`${row.courseName} ${row.description ?? ""}`);
              return suggested.length ? suggested : null;
            })(),
        });
        setCourses((prev) => {
          const exists = prev.some((c) => c.course_id === saved.course_id);
          return exists ? prev.map((c) => (c.course_id === saved.course_id ? saved : c)) : [...prev, saved];
        });
        ok++;
      } catch (err) {
        errors.push(`${row.courseName || row.courseId}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setImportProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    }
    setImportSummary({ ok, failed: errors.length, errors });
    setImportBusy(false);
    // Sicherheits-Refresh am Ende: garantiert einen konsistenten Stand, auch
    // falls einzelne Zeilen fehlgeschlagen sind und der lokale State dadurch
    // vom echten Serverstand abweichen könnte.
    try {
      const res = await fetchCourses(baseUrl, apiKey);
      setCourses(res.courses || []);
    } catch {
      // Import ist gespeichert — nur die Liste ist kurz veraltet, kein Nutzerfehler.
    }
  }
  function resetImport() {
    setImportHeaders([]);
    setImportDataRows([]);
    setImportMapping(DEFAULT_IMPORT_MAPPING);
    setImportFileName("");
    setImportParseError(null);
    setImportSummary(null);
    setImportProgress({ done: 0, total: 0 });
    setImportSkillSuggestions({});
    setImportApprovedSkillUris({});
    setImportSkillLevels({});
    setImportSkillDetectError(null);
    setImportSkillDetectProgress({ done: 0, total: 0 });
  }
  /** Laedt die vollstaendige Skill-Liste einer Zielrolle fuer den Skill-Picker
   * im Kursformular — nutzt denselben Kniff wie der Fragebogen-Schritt der
   * Journey (leerer Text -> alle Rollen-Skills kommen als gap_skills zurueck,
   * keine eigene Route noetig). Ergaenzt nebenbei den Label-Cache, damit auch
   * bereits zugeordnete Skills anderer Rollen lesbar bleiben. */
  async function loadSkillPickerRole(roleId: string) {
    setSkillPickerRoleId(roleId);
    if (!roleId) {
      setSkillPickerSkills([]);
      return;
    }
    setSkillPickerLoading(true);
    setSkillPickerError(null);
    try {
      const res = await fetchGapAnalysis(baseUrl, apiKey, { text: "", target_role_id: roleId, lang: ESCO_LANG });
      const all = [...res.covered_skills, ...res.gap_skills];
      setSkillPickerSkills(all);
      setSkillLabelCache((prev) => {
        const next = { ...prev };
        for (const s of all) next[s.esco_uri] = s.preferred_label;
        return next;
      });
    } catch (err) {
      setSkillPickerError(err instanceof Error ? err.message : "Skills konnten nicht geladen werden.");
      setSkillPickerSkills([]);
    } finally {
      setSkillPickerLoading(false);
    }
  }
  function toggleCourseSkillUri(uri: string) {
    const alreadySelected = courseSkillUris.has(uri);
    setCourseSkillUris((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
    // Beim Hinzufügen über den Zielrollen-Picker (nicht über einen
    // Skill-Vorschlag, siehe approveManualSuggestedSkill) gibt es keinen
    // matched_on-Kontext — die Heuristik sucht dann nach dem Klartext-Label
    // im kombinierten Kursname+Beschreibung-Text.
    if (!alreadySelected && !courseSkillLevels[uri]) {
      const label = skillLabelCache[uri] ?? "";
      const text = manualDetectText();
      const guess = label && text ? guessExperienceLevel(text, label, label) : null;
      setCourseSkillLevels((prev) => ({ ...prev, [uri]: guess?.level ?? "fortgeschritten" }));
    }
  }
  /** Oeffnet das Kurs-Formular vorbefuellt mit einem bestehenden Kurs — u.a.
   * damit VOR diesem Fix angelegte Kurse (ohne jede Skill-Zuordnung, siehe
   * course-manage-card-Warnhinweis) nachtraeglich zugeordnet werden koennen. */
  function startEditCourse(course: OrbitCourse) {
    setEditingCourseId(course.course_id);
    setCourseForm({
      courseId: course.course_id,
      courseName: course.course_name,
      // Zeigt den tatsächlich gespeicherten Anbieter dieses Kurses (das Feld
      // ist änderbar, siehe Kommentar beim courseForm-State oben) — fällt nur
      // auf den aktuellen Mandanten zurück, falls ein Kurs noch keinen
      // Anbieter hat.
      provider: course.provider || tenantName,
      // Backend liefert nur Wochen zurück — beim Bearbeiten deshalb immer in
      // Wochen angezeigt, unabhängig davon, in welcher Einheit ursprünglich
      // eingegeben wurde.
      durationWeeks: String(course.duration_weeks),
      durationUnit: "weeks",
      // Nur vorhanden, wenn das Backend die Beschreibung bereits zurückliefert
      // (siehe description in orbit.ts) — sonst leer, wie bisher.
      description: course.description ?? "",
      // target_role_ids ist die vollständige Mehrfachauswahl (neues Feld);
      // liefert ein älteres Backend nur target_role_id, wird daraus eine
      // Ein-Element-Liste, damit bestehende Kurse nicht "leer" erscheinen.
      targetRoleIds: course.target_role_ids ?? (course.target_role_id ? [course.target_role_id] : []),
      // Leer = Kurs stammt von vor diesem Feature (Pflichtfeld seit 15.09.) —
      // die "Bereich fehlt"-Validierung beim Speichern zwingt dann zur
      // Nachpflege genau wie beim Skill-Zuordnungs-Warnhinweis oben.
      bereichKeys: course.bereich_keys ?? (course.bereich_key ? [course.bereich_key] : []),
      location: course.location ?? "",
      // location_mode ist die praezisere Quelle (kennt "hybrid"); ein
      // Backend, das nur is_remote liefert, faellt auf remote/vor_ort zurueck.
      locationMode: course.location_mode ?? (course.is_remote ? "remote" : "vor_ort"),
      // Fällt auf "beides" zurück, wenn der Kurs noch aus der Zeit vor Version
      // 25 stammt (Feld noch nicht gesetzt) — damit ein alter Kurs beim
      // Präferenz-Matching nicht fälschlich als "nur Vollzeit" gilt.
      employmentMode: course.employment_mode ?? "beides",
      startsAt: course.starts_at ?? "",
      seatsRemaining: course.seats_remaining != null ? String(course.seats_remaining) : "",
      customBanner: course.custom_banner ?? "",
      priceEur: course.price_eur != null ? String(course.price_eur) : "",
      priceVatExempt: course.price_vat_exempt ?? false,
      examFeeEur: course.exam_fee_eur != null ? String(course.exam_fee_eur) : "",
      teachingUnits: course.teaching_units != null ? String(course.teaching_units) : "",
      fundingTypes: course.funding_types ?? [],
      fundingMeasureNumber: course.funding_measure_number ?? "",
      qualificationType: course.qualification_type ?? "",
      dqrLevel: course.dqr_level != null ? String(course.dqr_level) : "",
      targetGroup: course.target_group ?? "",
    });
    setCourseSkillUris(new Set(course.covered_skill_uris));
    // Erfahrungslevel aus covered_skills übernehmen, falls das Backend sie
    // bereits zurückliefert (sonst bleiben die Chips ohne aktives Level,
    // frei setzbar wie bei einem neuen Kurs).
    const levels: Record<string, ExperienceLevel> = {};
    for (const entry of course.covered_skills ?? []) {
      if (entry.experience_level) levels[entry.esco_uri] = entry.experience_level;
    }
    setCourseSkillLevels(levels);
    setSkillPickerRoleId("");
    setSkillPickerSkills([]);
    setManualSuggestedSkills([]);
    setManualSkillDetectError(null);
    setLevelRefineError(null);
    setSkillSearchQuery("");
    setSkillSearchResults([]);
    setSkillSearchError(null);
    setTargetRoleSuggestions([]);
    setTargetRoleSuggestAttempted(false);
    // Bereits "angefasst" markieren — course.bereich_keys sind echte,
    // gespeicherte Werte (siehe bereichKeys oben in setCourseForm), die die
    // Live-Vorausfüllung aus Name/Beschreibung nicht überschreiben soll.
    setBereichKeysTouched(true);
    setDescSuggestError(null);
    setHandbookFileName("");
    setHandbookStage("");
    setHandbookError(null);
    setHandbookDragOver(false);
    setCourseFormStatus({ msg: "", kind: "" });
    setCourseFormOpen(true);
    window.setTimeout(() => courseFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }
  function trackCourseClick(courseName: string | null | undefined) {
    if (!courseName) return;
    setCourseClicks((prev) => ({ ...prev, [courseName]: (prev[courseName] ?? 0) + 1 }));
  }
  function handleNavKeyDown(e: KeyboardEvent, next: Tab) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setTab(next);
    }
  }
  function handleRefreshKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void refreshAll();
    }
  }
  const clickEntries = Object.entries(courseClicks)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const maxClicks = clickEntries.length ? Math.max(...clickEntries.map(([, count]) => count)) : 0;
  const notConnectedYet = !live && !connecting;
  // ------------------------------------------------------------
  // Demo-Daten fuer den gefuehrten Rundgang
  // ------------------------------------------------------------
  // Diese Daten existieren ausschliesslich im React-State/Render und
  // werden niemals an die API oder Supabase geschrieben. Sobald der
  // Rundgang geschlossen wird, zeigt das Dashboard wieder die echten
  // Daten bzw. den normalen Empty-State.
  const tourDemoMode = tourOpen;
  const tourDemoLead = {
    lead_id: "tour-demo-anna-mueller",
    lead_name: "Anna Müller",
    target_role_name: "Projektmanagerin",
    contact_email: "anna.mueller@beispiel.de",
    qualified: true,
    booked: false,
    current_match_percentage: 72,
    projected_match_percentage: 91,
    matched_skills: ["Projektmanagement", "Kommunikation", "Agile Methoden"],
    gap_skills: ["Datenanalyse", "Power BI"],
    recommended_course: {
      course_id: "tour-demo-data-analytics",
      course_name: "Data Analytics & Power BI",
      provider: "Beispiel Akademie",
      covers_gap_percentage: 91,
    },
    // Zusätzlich verlinkter Kurs (siehe linked_course_ids in orbit.ts) — rein
    // fürs Demo-Bild im Rundgang, damit der "alle Weiterbildungen direkt auf
    // der Kachel"-Schritt unten (lead-list) auch wirklich einen zweiten,
    // zusätzlichen Kurs neben recommended_course zeigt.
    linked_course_ids: ["tour-demo-communication"],
  } as LeadResponse;
  const tourDemoCourses: OrbitCourse[] = [
    {
      course_id: "tour-demo-pm",
      course_name: "Projektmanagement Basics",
      provider: "Beispiel Akademie",
      duration_weeks: 4,
      covered_skill_uris: ["demo:project-management"],
      is_featured: true,
    },
    {
      course_id: "tour-demo-data",
      course_name: "Data Analytics & Power BI",
      provider: "Beispiel Akademie",
      duration_weeks: 6,
      covered_skill_uris: ["demo:data-analysis"],
      is_featured: true,
      // Rein fürs Demo-Bild im Rundgang (siehe Banner-Quick-Picker-Schritt
      // unten): echtes nahes Datum + niedrige Platzzahl, damit im Rundgang
      // tatsächlich "Startet in Kürze" UND "Nur noch X Plätze" zu sehen sind,
      // statt eines leeren Kartenzustands.
      starts_at: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      seats_remaining: 3,
    },
    {
      course_id: "tour-demo-communication",
      course_name: "Kommunikation im Beruf",
      provider: "Beispiel Akademie",
      duration_weeks: 3,
      covered_skill_uris: ["demo:communication"],
      is_featured: false,
    },
  ] as OrbitCourse[];
  const tourDemoSkillGaps = [
    { skill_name: "Digitale Kommunikation", percentage: 68 },
    { skill_name: "Projektmanagement", percentage: 54 },
    { skill_name: "Datenanalyse", percentage: 41 },
    { skill_name: "Präsentation", percentage: 36 },
  ];
  const tourDemoTopCourses = [
    { course_id: "tour-demo-pm", course_name: "Projektmanagement Basics", lead_count: 34 },
    { course_id: "tour-demo-data", course_name: "Data Analytics & Power BI", lead_count: 27 },
    { course_id: "tour-demo-communication", course_name: "Kommunikation im Beruf", lead_count: 21 },
  ];
  const displayedLeads = tourDemoMode ? [tourDemoLead] : leads;
  const displayedCourses = tourDemoMode ? tourDemoCourses : courses;
  const displayedSkillGaps = tourDemoMode ? tourDemoSkillGaps : (report?.top_skill_gaps ?? []);
  const displayedTopCourses = tourDemoMode ? tourDemoTopCourses : (report?.top_courses ?? []);
  const displayedLeadCount = tourDemoMode ? 128 : report?.total_leads ?? 0;
  const displayedTests = tourDemoMode ? 128 : report?.total_tests ?? 0;
  const displayedSkillGapCount = tourDemoMode ? 47 : report?.distinct_skill_gap_count ?? 0;
  const displayedRecommendations = tourDemoMode ? 86 : report?.tests_with_recommendation ?? 0;
  const displayedBooked = tourDemoMode ? 31 : report?.booked_leads ?? 0;
  const displayedAverageMatch = tourDemoMode ? 82 : report?.average_match_percentage ?? 0;
  const displayedQualified = tourDemoMode ? 76 : report?.qualified_leads ?? 0;
  const displayedConversion = tourDemoMode ? 24.2 : report?.conversion_rate ?? 0;
  const maxCourseLeads = displayedTopCourses.length
    ? Math.max(...displayedTopCourses.map((c) => c.lead_count))
    : 0;
  function refreshIcon(extraTitle?: string) {
    return (
      <div
        className={`icon-btn ${connecting ? "spinning" : ""}`}
        onClick={refreshAll}
        onKeyDown={handleRefreshKeyDown}
        role="button"
        tabIndex={0}
        aria-label="Aktualisieren"
        title={extraTitle || "Aktualisieren"}
      >
        ⟳
      </div>
    );
  }
  return (
    <div className="shell">
      {courseSaveToast && (
        <div className="course-save-toast" role="status" aria-live="polite">
          ✓ {courseSaveToast}
        </div>
      )}
      <button className="tour-trigger-btn" onClick={() => setTourOpen(true)} type="button">
        🎓 <span className="tour-trigger-label">Rundgang starten</span>
      </button>
      <DashboardTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        activeTab={tab}
        onChangeTab={setTab}
        onStepChange={setTourStepSelector}
      />
      <aside className="sidebar">
        <div className="sidebar-inner">
          <div className="dyd-mark">
            <svg width="38" height="38" viewBox="0 0 40 40" fill="none">
              <circle cx="20" cy="9.5" r="5.5" stroke="var(--dyd-brand-green)" strokeWidth={3} />
              <path d="M20 15 V22" stroke="var(--dyd-brand-green)" strokeWidth={3} strokeLinecap="round" />
              <path d="M20 22 L9 33" stroke="var(--dyd-brand-green)" strokeWidth={3} strokeLinecap="round" />
              <path d="M20 22 L31 33" stroke="var(--dyd-brand-green)" strokeWidth={3} strokeLinecap="round" />
              <path
                d="M25 28 L31 33 L25 34.5"
                stroke="var(--dyd-brand-green)"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="dyd-mark-text">
              <div className="dyd-name">DYD</div>
              <div className="dyd-tagline">DECIDE YOUR DREAM</div>
            </div>
          </div>
          <div className="product-tag">
            <span className="dotmark" />
            <div>
              <div className="product-tag-text">ORBIT</div>
              <div className="product-tag-sub">Lead-Intelligence-Modul für Bildungsträger</div>
            </div>
          </div>
          <div className="trust-row">
            <div className="trust-item">
              {/* Bewusst nicht mehr "DSGVO-konform" (Version 28) — siehe
                  gleichlautender Kommentar bei der Journey-trust-row in
                  JourneyPage.tsx: eine pauschale Compliance-Behauptung ohne
                  verlinkte Datenschutzerklärung war angreifbar. */}
              <span className="tick">✓</span>Datenschutz nach EU-Standard
            </div>
            <div className="trust-item">
              <span className="tick">✓</span>ESCO-Standard
            </div>
            <div className="trust-item">
              <span className="tick">✓</span>Made in Germany
            </div>
          </div>
          <div
            className="tenant-block"
            data-tour="tenant-block"
            title="Ingredient Branding: DYD sichtbar als Hauptmarke, Kunden-Branding als Mandanten-Slot daneben."
          >
            <div className="tenant-logo-placeholder">
              {tenantLogoUrl ? (
                <img
                  src={tenantLogoUrl}
                  alt={`${tenantName} Logo`}
                  style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: "inherit" }}
                />
              ) : (
                "?"
              )}
            </div>
            <div>
              <div className="tenant-label">Angemeldet als</div>
              <div className="tenant-name">{tenantName}</div>
            </div>
          </div>
          <div className="orbit-letters">
            <div className="orbit-letter" title="Optimized">O</div>
            <div className="orbit-letter" title="Reskilling">R</div>
            <div className="orbit-letter" title="Business">B</div>
            <div className="orbit-letter" title="Intelligence">I</div>
            <div className="orbit-letter" title="Tool">T</div>
          </div>
          <nav className="nav" role="tablist" aria-label="Hauptnavigation" data-tour="nav">
            <div
              role="tab"
              aria-selected={tab === "leads"}
              tabIndex={0}
              className={`nav-item ${tab === "leads" ? "active" : ""}`}
              onClick={() => setTab("leads")}
              onKeyDown={(e) => handleNavKeyDown(e, "leads")}
            >
              <span className="icon" aria-hidden="true">◎</span>Leads
            </div>
            <div className="nav-item disabled" aria-disabled="true">
              <span className="icon" aria-hidden="true">⌁</span>Matching<span className="soon-tag">bald</span>
            </div>
            <div
              role="tab"
              aria-selected={tab === "kurse"}
              tabIndex={0}
              className={`nav-item ${tab === "kurse" ? "active" : ""}`}
              onClick={() => setTab("kurse")}
              onKeyDown={(e) => handleNavKeyDown(e, "kurse")}
            >
              <span className="icon" aria-hidden="true">▤</span>Kurse
            </div>
            <div
              role="tab"
              aria-selected={tab === "reports"}
              tabIndex={0}
              className={`nav-item ${tab === "reports" ? "active" : ""}`}
              onClick={() => setTab("reports")}
              onKeyDown={(e) => handleNavKeyDown(e, "reports")}
            >
              <span className="icon" aria-hidden="true">◫</span>Reports
            </div>
          </nav>
          <div className="sidebar-spacer" />
          {showConnectionPanel && (
            <div className="conn-block">
              <div className="conn-block-head">
                <span className="conn-title">Verbindung</span>
                <span className="live-dot-row">
                  <span className={`live-dot ${live ? "" : "off"}`} />
                  <span>{live ? "verbunden" : "offline"}</span>
                </span>
              </div>
              <div className="conn-field">
                <label htmlFor="baseUrl">API-Adresse</label>
                <input id="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              </div>
              <div className="conn-field">
                <label htmlFor="apiKey">API-Key</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    id="apiKey"
                    type={showApiKey ? "text" : "password"}
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}
                    onClick={() => setShowApiKey((v) => !v)}
                    aria-label={showApiKey ? "API-Key verbergen" : "API-Key anzeigen"}
                    title={showApiKey ? "Verbergen" : "Anzeigen"}
                  >
                    {showApiKey ? "🙈" : "👁"}
                  </button>
                </div>
              </div>
              <button className="conn-btn" onClick={connect} disabled={connecting}>
                {connecting ? "Verbinde…" : "Verbinden & laden"}
              </button>
              {connStatus.msg && (
                <div className={`conn-status ${connStatus.kind}`} aria-live="polite">
                  {connStatus.msg}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
      <main className="main">
        <div className="main-inner">
          {showConnectionPanel && (
            <div className="banner">
              <span className="icon" aria-hidden="true">⚠</span>
              <div>
                <b>Entwickler-Ansicht.</b> Dieses Panel (Server-Adresse/API-Key, dieser Hinweis) ist nur im
                Entwicklungsmodus sichtbar und wird für echte Bildungsträger-Kunden automatisch ausgeblendet
                (<code>showConnectionPanel=false</code>) — die zeigen dann direkt live echte Daten ihrer eigenen
                API-Verbindung, ohne je eine Server-Adresse oder einen API-Key zu sehen.
              </div>
            </div>
          )}
          {tab === "leads" && (
            <div role="tabpanel" aria-label="Leads">
              <div className="page-head">
                <div>
                  <div className="eyebrow">DYD ORBIT · FÜR BILDUNGSTRÄGER &amp; AKADEMIEN</div>
                  <h1 className="display">Lead Intelligence</h1>
                  <div className="sub">Qualifizierte Weiterbildungs-Leads · Schritt 6 des Skill-Matching-Prozesses</div>
                </div>
                <div className="head-actions">
                  <div className={`live-pill ${live ? "" : "offline"}`}>
                    <span>●</span> {live ? "live" : "offline"}
                  </div>
                  {refreshIcon()}
                </div>
              </div>
              <div className="tile-row" data-tour="tile-row-leads">
                <div className="tile" style={{ animationDelay: ".02s" }}>
                  <div className="tile-top">
                    <div className="tile-label">Anzahl der Tests</div>
                    <div className="tile-icon-chip mint">◎</div>
                  </div>
                  <div className="tile-value display">{report || tourDemoMode ? <AnimatedNumber value={displayedTests} /> : "—"}</div>
                  <div className="tile-foot">
                    <div className="ratio-caption">inkl. Abbrecher ohne Kontaktformular</div>
                  </div>
                </div>
                <div className="tile" style={{ animationDelay: ".08s" }}>
                  <div className="tile-top">
                    <div className="tile-label">Skill-Gaps</div>
                    <div className="tile-icon-chip amber">◪</div>
                  </div>
                  <div className="tile-value display">
                    {report || tourDemoMode ? <AnimatedNumber value={displayedSkillGapCount} /> : "—"}
                  </div>
                  <div className="tile-foot">
                    <div className="ratio-caption">unterschiedliche Skills identifiziert</div>
                  </div>
                </div>
                <div className="tile" style={{ animationDelay: ".14s" }}>
                  <div className="tile-top">
                    <div className="tile-label">Vorgeschlagene Weiterbildungen</div>
                    <div className="tile-icon-chip blue">▤</div>
                  </div>
                  <div className="tile-value display">
                    {report || tourDemoMode ? <AnimatedNumber value={displayedRecommendations} /> : "—"}
                  </div>
                  <div className="tile-foot">
                    <div className="ratio-caption">von {displayedTests} Tests</div>
                  </div>
                </div>
                <div className="tile" style={{ animationDelay: ".20s" }}>
                  <div className="tile-top">
                    <div className="tile-label">Gebuchte Weiterbildungen</div>
                    <div className="tile-icon-chip violet">✓</div>
                  </div>
                  <div className="tile-value display">{report || tourDemoMode ? <AnimatedNumber value={displayedBooked} /> : "—"}</div>
                  <div className="tile-foot">
                    <div className="ratio-caption">manuell markiert, von {displayedLeadCount} Leads</div>
                  </div>
                </div>
              </div>
              <details className="app-card collapsible-card" data-tour="leads-manual-form">
                <summary>
                  <span>+ Lead manuell anlegen</span>
                  <span className="collapsible-hint">für Tests/Demos — echte Leads entstehen über die Endnutzer-Journey</span>
                </summary>
                <div className="app-card-body">
                  <div className="lead-form">
                    <div className="lf-field">
                      <label>Profil-Text</label>
                      <textarea value={leadForm.text} onChange={(e) => setLeadForm((f) => ({ ...f, text: e.target.value }))} />
                    </div>
                    <div className="row2">
                      <div className="lf-field">
                        <label>Name (optional)</label>
                        <input value={leadForm.name} onChange={(e) => setLeadForm((f) => ({ ...f, name: e.target.value }))} />
                      </div>
                      <div className="lf-field">
                        <label>Zielrolle</label>
                        <select
                          value={leadForm.targetRoleId}
                          onChange={(e) => setLeadForm((f) => ({ ...f, targetRoleId: e.target.value }))}
                        >
                          {roles.length === 0 && <option value="">— erst verbinden —</option>}
                          {roles.map((r) => (
                            <option key={r.role_id} value={r.role_id}>
                              {r.role_name || r.role_id}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="row2">
                      <div className="lf-field">
                        <label>E-Mail (optional)</label>
                        <input
                          type="email"
                          placeholder="name@beispiel.de"
                          value={leadForm.email}
                          onChange={(e) => setLeadForm((f) => ({ ...f, email: e.target.value }))}
                        />
                      </div>
                      <div className="lf-field">
                        <label>Wunschstart (optional)</label>
                        <select
                          value={leadForm.desiredStart}
                          onChange={(e) => setLeadForm((f) => ({ ...f, desiredStart: e.target.value }))}
                        >
                          <option value="">— nicht angegeben —</option>
                          {Object.entries(DESIRED_START_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="row2">
                      <div className="lf-field">
                        <label>Telefon (optional)</label>
                        <input
                          type="tel"
                          placeholder="+49 …"
                          value={leadForm.phone}
                          onChange={(e) => setLeadForm((f) => ({ ...f, phone: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="row2">
                      <div className="lf-field">
                        <label>Beschäftigungsart (optional)</label>
                        <select
                          value={leadForm.employmentType}
                          onChange={(e) => setLeadForm((f) => ({ ...f, employmentType: e.target.value }))}
                        >
                          <option value="">— nicht angegeben —</option>
                          {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="lf-field">
                        <label>Arbeitsort (optional)</label>
                        <select
                          value={leadForm.workLocation}
                          onChange={(e) => setLeadForm((f) => ({ ...f, workLocation: e.target.value }))}
                        >
                          <option value="">— nicht angegeben —</option>
                          {Object.entries(WORK_LOCATION_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="lf-field">
                      <label>Interessante/gebuchte Weiterbildungen (optional)</label>
                      {courses.length === 0 ? (
                        <div className="hint">Noch keine Kurse im Katalog.</div>
                      ) : (
                        <>
                          {courses.length > 6 && (
                            <input
                              className="role-filter-input"
                              type="text"
                              placeholder="Kurs suchen…"
                              value={leadFormCourseQuery}
                              onChange={(e) => setLeadFormCourseQuery(e.target.value)}
                              style={{ marginBottom: 10 }}
                            />
                          )}
                          <div className="course-pick-grid">
                            {courses
                              .filter((c) => c.course_name.toLowerCase().includes(leadFormCourseQuery.trim().toLowerCase()))
                              .map((c) => {
                                const checked = leadForm.linkedCourseIds.includes(c.course_id);
                                return (
                                  <label key={c.course_id} className={`course-pick-card ${checked ? "checked" : ""}`}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() =>
                                        setLeadForm((f) => ({
                                          ...f,
                                          linkedCourseIds: checked
                                            ? f.linkedCourseIds.filter((id) => id !== c.course_id)
                                            : [...f.linkedCourseIds, c.course_id],
                                        }))
                                      }
                                    />
                                    <div className="course-pick-card-body">
                                      <div className="course-pick-card-name">{c.course_name}</div>
                                      <div className="course-pick-card-meta">
                                        {c.provider} · {c.duration_weeks} Wochen
                                      </div>
                                    </div>
                                    <span className="course-pick-check" aria-hidden="true">
                                      {checked ? "✓" : ""}
                                    </span>
                                  </label>
                                );
                              })}
                          </div>
                        </>
                      )}
                    </div>
                    <label className="lf-checkbox-field">
                      <input
                        type="checkbox"
                        checked={leadForm.wantsConsultation}
                        onChange={(e) => setLeadForm((f) => ({ ...f, wantsConsultation: e.target.checked }))}
                      />
                      Beratungsgespräch gewünscht
                    </label>
                    <label className="lf-checkbox-field">
                      <input
                        type="checkbox"
                        checked={leadForm.booked}
                        onChange={(e) => setLeadForm((f) => ({ ...f, booked: e.target.checked }))}
                        disabled={leadForm.linkedCourseIds.length === 0}
                      />
                      Bereits gebucht{leadForm.linkedCourseIds.length === 0 ? " (erst eine Weiterbildung oben auswählen)" : ""}
                    </label>
                    <button className="btn-primary" onClick={handleCreateLead} disabled={creating || !leadForm.targetRoleId}>
                      {creating ? "Lege an…" : "Lead erstellen →"}
                    </button>
                    {leadFormStatus.msg && (
                      <div className={`form-status ${leadFormStatus.kind}`} aria-live="polite">
                        {leadFormStatus.msg}
                      </div>
                    )}
                  </div>
                </div>
              </details>
              <div className="app-card" data-tour="lead-list">
                <div className="app-card-header">
                  <div>
                    <h2>Deine Leads</h2>
                    <div className="sub">
                      {displayedLeads.length ? `${displayedLeads.length} Lead${displayedLeads.length === 1 ? "" : "s"} insgesamt` : "Qualifizierte Weiterbildungs-Leads"}
                    </div>
                  </div>
                </div>
                <div className="app-card-body">
                  {displayedLeads.length === 0 ? (
                    <div className="empty-state">
                      <span className="icon" aria-hidden="true">◎</span>
                      {notConnectedYet
                        ? "Noch keine Daten — links auf „Verbinden & laden“ klicken."
                        : "Noch keine Leads — sobald jemand die Endnutzer-Journey abschließt, erscheint er hier."}
                    </div>
                  ) : (
                    displayedLeads
                      .slice()
                      .reverse()
                      .map((l, i) => (
                        <div
                          className="lead-card clickable"
                          key={l.lead_id}
                          style={{ animationDelay: `${Math.min(i, 6) * 0.05}s` }}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedLeadId(l.lead_id)}
                          onKeyDown={(e) => {
                            // Nur wenn nicht schon ein verschachteltes Steuerelement (Button,
                            // Checkbox, Datums-Feld, Kurs-Zeile) den Tastendruck behandelt hat —
                            // die stoppen die Weitergabe jeweils selbst per stopPropagation.
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedLeadId(l.lead_id);
                            }
                          }}
                          aria-label={`Details zu ${l.lead_name || l.lead_id} öffnen`}
                        >
                          <div className="lead-top">
                            <div className="lead-who">
                              <div className="avatar">{initials(l.lead_name || l.lead_id)}</div>
                              <div>
                                <div className="lead-name">{l.lead_name || l.lead_id}</div>
                                <div className="lead-role">
                                  → {l.target_role_name}
                                  {l.contact_email ? ` · ${l.contact_email}` : ""}
                                  {/* Telefonnummer (Version 27), siehe contact_phone in
                                     LeadCreateRequest/LeadResponse (orbit.ts) — additiv wie
                                     contact_email. */}
                                  {l.contact_phone ? ` · ${l.contact_phone}` : ""}
                                </div>
                                {l.assigned_to && <div className="lead-assigned-chip">👤 {l.assigned_to}</div>}
                              </div>
                            </div>
                            {/* Eigene Steuerelemente in der Karte (Buchen-Button etc.) müssen die
                               Klick-Weitergabe an die jetzt ganze Karte stoppen, sonst würde ein
                               Klick darauf zusätzlich ungewollt das Detail-Modal öffnen. */}
                            <div className="lead-badges" onClick={(e) => e.stopPropagation()}>
                              <div className={`match-badge ${l.qualified ? "qualified" : "pending"}`}>
                                <span className="bdot" />
                                {l.qualified ? "Qualifiziert" : "Noch nicht qualifiziert"}
                              </div>
                              <button
                                className={`booked-toggle ${l.booked ? "booked" : ""}`}
                                onClick={() => { if (!tourDemoMode) void handleToggleBooked(l); }}
                                disabled={tourDemoMode || bookingBusyId === l.lead_id}
                                title="Manuell markieren, sobald die Buchung im eigenen System des Bildungsträgers erfolgt ist"
                              >
                                {bookingBusyId === l.lead_id ? "…" : l.booked ? "✓ Gebucht" : "Als gebucht markieren"}
                              </button>
                            </div>
                          </div>
                          {(formatLeadDate(l.created_at) ||
                            (l.desired_start && DESIRED_START_LABELS[l.desired_start]) ||
                            (l.employment_type && EMPLOYMENT_TYPE_LABELS[l.employment_type]) ||
                            (l.work_location && WORK_LOCATION_LABELS[l.work_location]) ||
                            (l.funding_preference && FUNDING_PREFERENCE_LABELS[l.funding_preference])) && (
                            <div className="lead-meta-row">
                              {formatLeadDate(l.created_at) && (
                                <span className="lead-meta-item" title="Eingegangen am">
                                  📅 {formatLeadDate(l.created_at)}
                                </span>
                              )}
                              {l.desired_start && DESIRED_START_LABELS[l.desired_start] && (
                                <span className="lead-meta-item" title="Gewünschter Startzeitpunkt">
                                  🚀 {DESIRED_START_LABELS[l.desired_start]}
                                </span>
                              )}
                              {l.employment_type && EMPLOYMENT_TYPE_LABELS[l.employment_type] && (
                                <span className="lead-meta-item" title="Beschäftigungsart">
                                  💼 {EMPLOYMENT_TYPE_LABELS[l.employment_type]}
                                </span>
                              )}
                              {l.work_location && WORK_LOCATION_LABELS[l.work_location] && (
                                <span className="lead-meta-item" title="Gewünschter Arbeitsort">
                                  📍 {WORK_LOCATION_LABELS[l.work_location]}
                                </span>
                              )}
                              {l.funding_preference && FUNDING_PREFERENCE_LABELS[l.funding_preference] && (
                                <span className="lead-meta-item" title="Förderungs-Präferenz">
                                  🎓 {FUNDING_PREFERENCE_LABELS[l.funding_preference]}
                                </span>
                              )}
                            </div>
                          )}
                          {/* Eigenes, gut sichtbares Feld statt nur eines kleinen Badges (Version 22) —
                             zwei unabhängige Stufen: "Vereinbart" mit selbst eintragbarem Termin-Datum
                             (siehe handleSetConsultationScheduled) und "Durchgeführt" mit vom Server
                             automatisch gesetztem Datum (siehe handleToggleConsultationCompleted). Ein
                             Termin kann vereinbart sein, ohne dass das Gespräch schon stattgefunden hat,
                             und umgekehrt. Nur sichtbar, wenn überhaupt ein Beratungsgespräch angefragt wurde. */}
                          {l.consultation_requested && (
                            <div
                              className={`consultation-field ${l.consultation_completed ? "done" : ""}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="consultation-field-header">
                                <span className="consultation-field-icon" aria-hidden="true">🗣️</span>
                                <div className="consultation-field-title">Beratungsgespräch angefragt</div>
                              </div>
                              <div className="consultation-field-stages">
                                <div className="consultation-field-stage">
                                  <label className="consultation-field-toggle">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(l.consultation_scheduled_for)}
                                      disabled={tourDemoMode || consultationScheduleBusyId === l.lead_id}
                                      onChange={(e) => {
                                        if (tourDemoMode) return;
                                        void handleSetConsultationScheduled(l, e.target.checked ? todayIso() : null);
                                      }}
                                    />
                                    {consultationScheduleBusyId === l.lead_id ? "…" : "Vereinbart"}
                                  </label>
                                  {l.consultation_scheduled_for && (
                                    <input
                                      type="date"
                                      className="consultation-date-input"
                                      value={l.consultation_scheduled_for}
                                      disabled={tourDemoMode || consultationScheduleBusyId === l.lead_id}
                                      onChange={(e) => {
                                        if (!tourDemoMode && e.target.value) void handleSetConsultationScheduled(l, e.target.value);
                                      }}
                                    />
                                  )}
                                </div>
                                <div className="consultation-field-stage">
                                  <label className="consultation-field-toggle">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(l.consultation_completed)}
                                      disabled={tourDemoMode || consultationBusyId === l.lead_id}
                                      onChange={() => { if (!tourDemoMode) void handleToggleConsultationCompleted(l); }}
                                    />
                                    {consultationBusyId === l.lead_id ? "…" : "Durchgeführt"}
                                  </label>
                                  {l.consultation_completed && formatLeadDate(l.consultation_completed_at) && (
                                    <span className="consultation-field-sub">
                                      am {formatLeadDate(l.consultation_completed_at)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                          <div className="match-bar-block">
                            <div className="match-bar-labels">
                              <span>
                                Aktueller Match: <b>{l.current_match_percentage}%</b>
                              </span>
                              <span>
                                Projiziert nach Kurs: <b>{l.projected_match_percentage}%</b>
                              </span>
                            </div>
                            <div className="match-bar-track">
                              <div className="match-bar-projected" style={{ width: `${l.projected_match_percentage}%` }} />
                              <div className="match-bar-current" style={{ width: `${l.current_match_percentage}%` }} />
                            </div>
                          </div>
                          {(l.matched_skills.length > 0 || l.gap_skills.length > 0) && (
                            <div className="skill-block">
                              <div className="chip-row">
                                {l.matched_skills.map((s) => (
                                  <span className="chip" key={s}>
                                    {s}
                                  </span>
                                ))}
                                {l.gap_skills.map((s) => (
                                  <span className="chip gap" key={s}>
                                    Gap: {s}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* ALLE Weiterbildungen des Leads direkt auf der Kachel, nicht erst im
                             Detail-Modal — egal ob manuell im Dashboard hinzugefügt (siehe
                             handleCreateLead/linkedCourseIds) oder vom Nutzer selbst in der
                             Journey mehrfach ausgewählt (siehe additionalCourseIds/
                             setLeadLinkedCourses in JourneyPage.tsx): beide landen in
                             linked_course_ids. recommended_course zuerst (einzige mit
                             Match-Prozentzahl, siehe covers_gap_percentage), alle weiteren
                             verlinkten Kurse direkt darunter in derselben Zeilen-Optik. */}
                          {l.recommended_course && (
                            <div
                              className="course-row"
                              role="button"
                              tabIndex={0}
                              style={{ cursor: "pointer" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                trackCourseClick(l.recommended_course?.course_name);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  trackCourseClick(l.recommended_course?.course_name);
                                }
                              }}
                              aria-label={`Kursempfehlung ansehen: ${l.recommended_course.course_name}`}
                            >
                              <div className="course-row-left">
                                <div className="course-icon">📘</div>
                                <div>
                                  <div className="course-name">{l.recommended_course.course_name}</div>
                                  <div className="course-sub">passt zur Zielrolle · {l.recommended_course.provider}</div>
                                </div>
                              </div>
                              <div className="course-score">{l.recommended_course.covers_gap_percentage}%</div>
                            </div>
                          )}
                          {(() => {
                            const linkedIds = l.linked_course_ids ?? [];
                            const extraLinked = courses.filter(
                              (c) => linkedIds.includes(c.course_id) && c.course_id !== l.recommended_course?.course_id
                            );
                            return extraLinked.map((c) => (
                              <div
                                key={c.course_id}
                                className="course-row"
                                role="button"
                                tabIndex={0}
                                style={{ cursor: "pointer" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  trackCourseClick(c.course_name);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    trackCourseClick(c.course_name);
                                  }
                                }}
                                aria-label={`Verlinkten Kurs ansehen: ${c.course_name}`}
                              >
                                <div className="course-row-left">
                                  <div className="course-icon">📘</div>
                                  <div>
                                    <div className="course-name">{c.course_name}</div>
                                    <div className="course-sub">zusätzlich interessant/gebucht · {c.provider}</div>
                                  </div>
                                </div>
                              </div>
                            ));
                          })()}
                          {/* Kleiner Hinweis, dass die Kachel klickbar ist und im Detail-Modal
                             mehr zeigt (Bearbeiter, Beratungsgespräch, Kurse nachträglich
                             ändern) — sonst wirkt der Klick auf die Kachel unmotiviert, jetzt wo
                             die Kurse schon direkt sichtbar sind. */}
                          <div className="lead-card-more-hint">💡 Kachel anklicken für weitere Details</div>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          )}
          {tab === "kurse" && (
            <div role="tabpanel" aria-label="Kurse">
              <div className="page-head">
                <div>
                  <div className="eyebrow">DYD ORBIT · FÜR BILDUNGSTRÄGER &amp; AKADEMIEN</div>
                  <h1 className="display">Kurskatalog</h1>
                  <div className="sub">
                    Markiere Kurse als „Top" — sie erscheinen dann zusätzlich zur individuellen Empfehlung unten im
                    Kurs-Schritt der Endnutzer-Journey.
                  </div>
                </div>
                <div className="head-actions">
                  <div className={`live-pill ${live ? "" : "offline"}`}>
                    <span>●</span> {live ? "live" : "offline"}
                  </div>
                  {refreshIcon()}
                </div>
              </div>
              <details
                className="app-card collapsible-card"
                ref={courseFormRef}
                open={courseFormOpen}
                onToggle={(e) => setCourseFormOpen(e.currentTarget.open)}
                data-tour="kurse-manual-form"
              >
                <summary>
                  <span>{editingCourseId ? `✎ Kurs bearbeiten: ${courseForm.courseName || editingCourseId}` : "+ Neuen Kurs hinzufügen"}</span>
                  <span className="collapsible-hint">Kurs-ID, Name, Anbieter, Dauer, Beschreibung, Skill-Zuordnung</span>
                </summary>
                <div className="app-card-body">
                  <div className="lead-form">
                    <div className="row2">
                      <div className="lf-field">
                        <label>Kurs-ID (eindeutig, z.B. course-excel-basics)</label>
                        <input
                          value={courseForm.courseId}
                          onChange={(e) => setCourseForm((f) => ({ ...f, courseId: e.target.value }))}
                          disabled={Boolean(editingCourseId)}
                        />
                      </div>
                      <div className="lf-field">
                        <label>Kursname</label>
                        <input value={courseForm.courseName} onChange={(e) => setCourseForm((f) => ({ ...f, courseName: e.target.value }))} />
                      </div>
                    </div>
                    <div className="row2">
                      <div className="lf-field">
                        <label>Anbieter</label>
                        <input
                          value={courseForm.provider}
                          onChange={(e) => setCourseForm((f) => ({ ...f, provider: e.target.value }))}
                          placeholder={tenantName}
                          required
                        />
                        <div className="hint">Vorbelegt mit deinem Mandanten (identisch mit dem für die API hinterlegten Anbieter) — bei Bedarf änderbar, darf aber nicht leer sein.</div>
                      </div>
                      <div className="lf-field">
                        <label>Dauer</label>
                        <div className="duration-picker">
                          <div className="duration-stepper">
                            <button
                              type="button"
                              className="duration-step-btn"
                              onClick={() =>
                                setCourseForm((f) => ({
                                  ...f,
                                  durationWeeks: String(Math.max(1, (parseInt(f.durationWeeks, 10) || 1) - 1)),
                                }))
                              }
                              aria-label="Verringern"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={1}
                              className="duration-number-input"
                              value={courseForm.durationWeeks}
                              onChange={(e) => setCourseForm((f) => ({ ...f, durationWeeks: e.target.value }))}
                            />
                            <button
                              type="button"
                              className="duration-step-btn"
                              onClick={() =>
                                setCourseForm((f) => ({ ...f, durationWeeks: String((parseInt(f.durationWeeks, 10) || 0) + 1) }))
                              }
                              aria-label="Erhöhen"
                            >
                              +
                            </button>
                          </div>
                          <div className="duration-unit-toggle">
                            <button
                              type="button"
                              className={`duration-unit-btn ${courseForm.durationUnit === "weeks" ? "active" : ""}`}
                              onClick={() => setCourseForm((f) => ({ ...f, durationUnit: "weeks" }))}
                            >
                              Wochen
                            </button>
                            <button
                              type="button"
                              className={`duration-unit-btn ${courseForm.durationUnit === "months" ? "active" : ""}`}
                              onClick={() => setCourseForm((f) => ({ ...f, durationUnit: "months" }))}
                            >
                              Monate
                            </button>
                          </div>
                        </div>
                        {courseForm.durationUnit === "months" && Number(courseForm.durationWeeks) > 0 && (
                          <div className="hint">≈ {Math.round(Number(courseForm.durationWeeks) * 4.345)} Wochen</div>
                        )}
                      </div>
                    </div>
                    <div className="lf-field">
                      <label>Durchführungsort</label>
                      <div className="location-toggle-row">
                        <button
                          type="button"
                          className={`location-toggle-btn ${courseForm.locationMode === "remote" ? "active" : ""}`}
                          onClick={() => setCourseForm((f) => ({ ...f, locationMode: "remote" }))}
                        >
                          💻 Remote
                        </button>
                        <button
                          type="button"
                          className={`location-toggle-btn ${courseForm.locationMode === "hybrid" ? "active" : ""}`}
                          onClick={() => setCourseForm((f) => ({ ...f, locationMode: "hybrid" }))}
                        >
                          🔀 Hybrid
                        </button>
                        <button
                          type="button"
                          className={`location-toggle-btn ${courseForm.locationMode === "vor_ort" ? "active" : ""}`}
                          onClick={() => setCourseForm((f) => ({ ...f, locationMode: "vor_ort" }))}
                        >
                          📍 Vor Ort
                        </button>
                        {courseForm.locationMode !== "remote" && (
                          <input
                            className="location-input"
                            placeholder="Ort, z.B. München oder Musterstraße 1, 80331 München"
                            value={courseForm.location}
                            onChange={(e) => setCourseForm((f) => ({ ...f, location: e.target.value }))}
                          />
                        )}
                      </div>
                      {courseForm.locationMode === "hybrid" && (
                        <div className="hint">Hybrid: Teilnehmende können sowohl remote als auch vor Ort teilnehmen.</div>
                      )}
                    </div>
                    <div className="lf-field">
                      <label>Beschäftigungsart</label>
                      <div className="location-toggle-row">
                        <button
                          type="button"
                          className={`location-toggle-btn ${courseForm.employmentMode === "vollzeit" ? "active" : ""}`}
                          onClick={() => setCourseForm((f) => ({ ...f, employmentMode: "vollzeit" }))}
                        >
                          💼 Vollzeit
                        </button>
                        <button
                          type="button"
                          className={`location-toggle-btn ${courseForm.employmentMode === "teilzeit" ? "active" : ""}`}
                          onClick={() => setCourseForm((f) => ({ ...f, employmentMode: "teilzeit" }))}
                        >
                          🕐 Teilzeit
                        </button>
                        <button
                          type="button"
                          className={`location-toggle-btn ${courseForm.employmentMode === "beides" ? "active" : ""}`}
                          onClick={() => setCourseForm((f) => ({ ...f, employmentMode: "beides" }))}
                        >
                          🔀 Beides
                        </button>
                      </div>
                      <div className="hint">
                        Fließt ins Matching ein: Personen, die im Weiterbildungs-Finder Vollzeit oder Teilzeit angeben,
                        sehen dazu passende Kurse bevorzugt.
                      </div>
                    </div>
                    <div className="lf-field">
                      <label>Konversions-Banner (optional)</label>
                      <div className="hint" style={{ marginBottom: 8 }}>
                        Werden in der Journey automatisch über die Kurskarte gelegt — nur bei echten Werten, keine
                        erfundene Dringlichkeit.
                      </div>
                      <div className="row2">
                        <div className="lf-field">
                          <label>Startdatum</label>
                          <input
                            type="date"
                            value={courseForm.startsAt}
                            onChange={(e) => setCourseForm((f) => ({ ...f, startsAt: e.target.value }))}
                          />
                          <div className="hint">Zeigt "Startet in Kürze", wenn der Termin nah ist.</div>
                        </div>
                        <div className="lf-field">
                          <label>Verbleibende Plätze</label>
                          <input
                            type="number"
                            min={0}
                            placeholder="z.B. 3"
                            value={courseForm.seatsRemaining}
                            onChange={(e) => setCourseForm((f) => ({ ...f, seatsRemaining: e.target.value }))}
                          />
                          <div className="hint">Zeigt "Nur noch X Plätze" bzw. "Ausgebucht" bei 0.</div>
                        </div>
                      </div>
                      <input
                        style={{ marginTop: 8 }}
                        type="text"
                        placeholder="Eigener Hinweis, z.B. „Neu im Programm“ (optional)"
                        value={courseForm.customBanner}
                        onChange={(e) => setCourseForm((f) => ({ ...f, customBanner: e.target.value }))}
                      />
                    </div>
                    {/* Preis-/Förder-/Abschluss-Felder (Version 32, 14.09. —
                       Antwort auf "mehr Infos wie Preise, Anzahl Stunden und
                       ob es förderfähig ist", siehe die vorangegangene
                       IHK-Bildungszentren-Recherche im Chat). Durchweg
                       optional, wie die Konversions-Banner-Felder oben. */}
                    {/* Eigener data-tour-Anker (14.09., Rundgang-Ausbau
                       "alle Features nennen, gerade beim Dashboard mit den
                       Kursen"): Preis/Förderung/Abschluss/Zielgruppe waren
                       bisher Teil des generischen "Kurs manuell anlegen"-
                       Rundgang-Schritts und wurden dort nie einzeln erwähnt. */}
                    <div data-tour="kurse-pricing-fields">
                    {urlImportVerifiedFields.length > 0 && (
                      <div className="hint url-import-verified-hint">
                        ✓ Per URL-Import von der Kurs-Seite bestätigt: {urlImportVerifiedFields.join(", ")}. Alle
                        anderen Felder unten wie eine leere/manuelle Eingabe behandeln und prüfen.
                      </div>
                    )}
                    <div className="lf-field">
                      <label>Preis &amp; Abschluss (optional)</label>
                      <div className="row2">
                        <div className="lf-field">
                          <label>Kursgebühr (€)</label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="z.B. 2590"
                            value={courseForm.priceEur}
                            onChange={(e) => setCourseForm((f) => ({ ...f, priceEur: e.target.value }))}
                          />
                        </div>
                        <div className="lf-field">
                          <label>Prüfungsgebühr (€, falls separat)</label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="z.B. 350"
                            value={courseForm.examFeeEur}
                            onChange={(e) => setCourseForm((f) => ({ ...f, examFeeEur: e.target.value }))}
                          />
                        </div>
                      </div>
                      <label className="lf-checkbox-field">
                        <input
                          type="checkbox"
                          checked={courseForm.priceVatExempt}
                          onChange={(e) => setCourseForm((f) => ({ ...f, priceVatExempt: e.target.checked }))}
                        />
                        Umsatzsteuerbefreit (§4 Nr. 21 UStG)
                      </label>
                      <div className="row2" style={{ marginTop: 8 }}>
                        <div className="lf-field">
                          <label>Unterrichtseinheiten (UE à 45 Min.)</label>
                          <input
                            type="number"
                            min={0}
                            placeholder="z.B. 60"
                            value={courseForm.teachingUnits}
                            onChange={(e) => setCourseForm((f) => ({ ...f, teachingUnits: e.target.value }))}
                          />
                          <div className="hint">Branchenübliche Dauer-Angabe, zusätzlich zur Dauer in Wochen/Monaten oben.</div>
                          {urlImportDurationHint && (
                            <div className="hint url-import-duration-hint">
                              Quelle nennt nur: „{urlImportDurationHint}" — keine automatische Umrechnung
                              (z.B. Stunden ≠ UE), bitte bei Bedarf selbst eintragen.
                            </div>
                          )}
                        </div>
                        <div className="lf-field">
                          <label>Abschlussart</label>
                          <select
                            value={courseForm.qualificationType}
                            onChange={(e) =>
                              setCourseForm((f) => ({ ...f, qualificationType: e.target.value as QualificationType | "" }))
                            }
                          >
                            <option value="">— keine Angabe —</option>
                            {QUALIFICATION_TYPE_OPTIONS.map((o) => (
                              <option key={o.key} value={o.key}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {courseForm.qualificationType && (
                        <div className="lf-field" style={{ marginTop: 8 }}>
                          <label>DQR-Niveau (optional, 1-8 — nur bei offiziell eingestuften Abschlüssen wie Fachwirt/Meister)</label>
                          <select value={courseForm.dqrLevel} onChange={(e) => setCourseForm((f) => ({ ...f, dqrLevel: e.target.value }))}>
                            <option value="">— keine Angabe —</option>
                            {[1, 2, 3, 4, 5, 6, 7, 8].map((lvl) => (
                              <option key={lvl} value={lvl}>
                                DQR {lvl}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    <div className="lf-field">
                      <label>Förderung (optional — Mehrfachauswahl möglich)</label>
                      <div className="hint" style={{ marginBottom: 8 }}>
                        Fließt in der Journey als eigene Präferenz-Frage ins Kurs-Matching ein und wird auf der
                        Kurskarte als Förder-Hinweis angezeigt.
                      </div>
                      {FUNDING_TYPE_OPTIONS.map((o) => (
                        <label className="lf-checkbox-field" key={o.key}>
                          <input
                            type="checkbox"
                            checked={courseForm.fundingTypes.includes(o.key)}
                            onChange={(e) =>
                              setCourseForm((f) => ({
                                ...f,
                                fundingTypes: e.target.checked
                                  ? [...f.fundingTypes, o.key]
                                  : f.fundingTypes.filter((k) => k !== o.key),
                              }))
                            }
                          />
                          {o.label}
                        </label>
                      ))}
                      {courseForm.fundingTypes.includes("bildungsgutschein") && (
                        <div className="lf-field" style={{ marginTop: 8 }}>
                          <label>Maßnahmenummer (AZAV, aus KURSNET)</label>
                          <input
                            type="text"
                            placeholder="z.B. 12345678"
                            value={courseForm.fundingMeasureNumber}
                            onChange={(e) => setCourseForm((f) => ({ ...f, fundingMeasureNumber: e.target.value }))}
                          />
                          <div className="hint">
                            Der Beleg, mit dem Berater:innen bei der Agentur für Arbeit/dem Jobcenter die
                            Förderfähigkeit sofort prüfen können.
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="lf-field">
                      <label>Zielgruppe / Voraussetzungen (optional)</label>
                      <textarea
                        rows={2}
                        placeholder="z.B. Grundlegende IT-Kenntnisse von Vorteil, keine Programmiererfahrung nötig"
                        value={courseForm.targetGroup}
                        onChange={(e) => setCourseForm((f) => ({ ...f, targetGroup: e.target.value }))}
                      />
                    </div>
                    </div>
                    <div className="lf-field">
                      <label>Kursbeschreibung (optional)</label>
                      <textarea
                        rows={3}
                        placeholder="Wenige Sätze reichen — Inhalte, Zielgruppe, Vorkenntnisse. Wird nur für die automatische Skill-Erkennung unten genutzt."
                        value={courseForm.description}
                        onChange={(e) => setCourseForm((f) => ({ ...f, description: e.target.value }))}
                      />
                      <div className="import-file-row" style={{ marginTop: 8 }}>
                        <button
                          type="button"
                          className={`btn-ai match ${manualSkillDetectBusy ? "busy" : ""}`}
                          onClick={handleDetectManualSkills}
                          disabled={manualSkillDetectBusy || courseForm.description.trim().length < MIN_DESCRIPTION_FOR_SKILL_DETECT}
                          title="Fuzzy-Abgleich gegen die echte ESCO-Skill-Datenbank — schnell, kein KI-Aufruf."
                        >
                          <span className="btn-ai-icon">🔍</span>
                          <span className="btn-ai-text">
                            <span className="btn-ai-label">{manualSkillDetectBusy ? "Ermittle Skills…" : "Skills automatisch erkennen"}</span>
                            <span className="btn-ai-sub">Sofort · ESCO-Datenbank</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`btn-ai generate ${descSuggestBusy ? "busy" : ""}`}
                          onClick={handleSuggestDescription}
                          disabled={descSuggestBusy || !courseForm.courseName.trim()}
                          title="Lässt eine KI einen fertigen, professionellen Beschreibungstext formulieren — bleibt danach frei editierbar."
                        >
                          <span className="btn-ai-icon">✨</span>
                          <span className="btn-ai-text">
                            <span className="btn-ai-label">{descSuggestBusy ? "Formuliere…" : "Beschreibung vorschlagen"}</span>
                            <span className="btn-ai-sub">KI-generiert</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`btn-ai match ${aiSkillDetectBusy ? "busy" : ""}`}
                          onClick={handleDetectSkillsWithAI}
                          disabled={
                            aiSkillDetectBusy ||
                            courseForm.description.trim().length + courseForm.courseName.trim().length < MIN_DESCRIPTION_FOR_SKILL_DETECT
                          }
                          title={
                            courseForm.targetRoleIds.length === 0
                              ? "Erst eine Zielrolle auswählen — die KI prüft gezielt deren Kern-Skills, auch wenn sie nur umschrieben im Text vorkommen."
                              : "KI liest die Beschreibung inhaltlich (nicht nur wörtlich) gegen die Kern-Skills der ausgewählten Zielrolle(n) — findet auch umschriebene Skills, die der schnelle Abgleich oben verpasst."
                          }
                        >
                          <span className="btn-ai-icon">🤖</span>
                          <span className="btn-ai-text">
                            <span className="btn-ai-label">{aiSkillDetectBusy ? "Analysiere…" : "Skills per KI vertiefen"}</span>
                            <span className="btn-ai-sub">
                              {courseForm.targetRoleIds.length === 0 ? "Braucht eine Zielrolle" : "Gegen Zielrolle · KI-Analyse"}
                            </span>
                          </span>
                        </button>
                        {courseForm.description.trim().length > 0 &&
                          courseForm.description.trim().length < MIN_DESCRIPTION_FOR_SKILL_DETECT && (
                            <span className="hint">Noch etwas kurz für eine zuverlässige Erkennung.</span>
                          )}
                      </div>
                      {descSuggestError && <div className="hint warn">{descSuggestError}</div>}
                      {manualSkillDetectError && <div className="hint warn">{manualSkillDetectError}</div>}
                      {aiSkillDetectError && <div className="hint warn">{aiSkillDetectError}</div>}
                      {manualSuggestedSkills.length > 0 && (
                        <div className="skill-suggest-box" data-tour="kurse-skill-suggest">
                          <div className="skill-suggest-head">
                            <span className="hint">
                              🔍 Automatisch erkannt — bitte prüfen und übernehmen ({manualSuggestedSkills.length})
                            </span>
                            <button type="button" className="skill-suggest-approve-all" onClick={approveAllManualSuggestedSkills}>
                              Alle übernehmen
                            </button>
                          </div>
                          <div className="course-skill-chip-row">
                            {manualSuggestedSkills.map((m) => (
                              <span
                                className="skill-suggest-chip"
                                key={m.esco_uri}
                                title={m.skill_type === "ki-tiefenanalyse" ? `KI-Beleg: „${m.matched_on}“` : undefined}
                              >
                                {m.skill_type === "ki-tiefenanalyse" && <span aria-hidden="true">🤖 </span>}
                                {m.preferred_label}
                                <button
                                  type="button"
                                  className="chip-add"
                                  onClick={() => approveManualSuggestedSkill(m.esco_uri)}
                                  aria-label="Skill übernehmen"
                                  title="Übernehmen"
                                >
                                  ✓
                                </button>
                                <button
                                  type="button"
                                  className="chip-remove"
                                  onClick={() => dismissManualSuggestedSkill(m.esco_uri)}
                                  aria-label="Vorschlag verwerfen"
                                  title="Verwerfen"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="lf-field handbook-upload-field" data-tour="kurse-handbook-upload">
                      <label>Oder: Modulhandbuch/Kursplan hochladen</label>
                      <div className="hint">
                        PDF, DOCX oder TXT — auch bei sehr großen Dateien vollständig: die Skill-Erkennung durchsucht das
                        komplette Dokument parallel in Abschnitten, nicht nur einen gekürzten Ausschnitt. Nur die
                        Beschreibung wird danach kompakt aus Dokument-Anfang + erkannten Skills erstellt.
                      </div>
                      {(() => {
                        const handbookBusy = handbookStage === "reading" || handbookStage === "analyzing" || handbookStage === "matching";
                        return (
                          <label
                            htmlFor="handbook-file-input"
                            className={`handbook-dropzone ${handbookDragOver ? "drag-over" : ""} ${handbookBusy ? "busy" : ""}`}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (!handbookBusy) setHandbookDragOver(true);
                            }}
                            onDragLeave={() => setHandbookDragOver(false)}
                            onDrop={(e) => {
                              e.preventDefault();
                              setHandbookDragOver(false);
                              if (handbookBusy) return;
                              const file = e.dataTransfer.files?.[0];
                              if (file) void runHandbookAnalysis(file);
                            }}
                          >
                            <input
                              id="handbook-file-input"
                              type="file"
                              accept=".pdf,.docx,.doc,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                              onChange={handleHandbookUpload}
                              disabled={handbookBusy}
                              hidden
                            />
                            <span className="handbook-dropzone-icon">{handbookBusy ? "⏳" : "📄"}</span>
                            <span className="handbook-dropzone-text">
                              {handbookFileName ? (
                                <strong>{handbookFileName}</strong>
                              ) : (
                                <>
                                  Datei hierher ziehen oder <strong>klicken zum Auswählen</strong>
                                </>
                              )}
                            </span>
                            <span className="handbook-dropzone-hint">PDF, DOCX oder TXT</span>
                          </label>
                        );
                      })()}
                      {handbookStage && (
                        <div className="handbook-progress">
                          <div className={`handbook-progress-step ${handbookStage === "reading" ? "active" : handbookStage ? "done" : ""}`}>
                            1. Datei wird gelesen
                          </div>
                          <div
                            className={`handbook-progress-step ${
                              handbookStage === "matching"
                                ? "active"
                                : handbookStage === "analyzing" || handbookStage === "done"
                                  ? "done"
                                  : ""
                            }`}
                          >
                            2. ESCO-Skills werden im ganzen Dokument gesucht
                          </div>
                          <div
                            className={`handbook-progress-step ${
                              handbookStage === "analyzing" ? "active" : handbookStage === "done" ? "done" : ""
                            }`}
                          >
                            3. Kurzbeschreibung wird erstellt
                          </div>
                        </div>
                      )}
                      {handbookFileName && handbookStage === "done" && (
                        <div className="hint">
                          ✓ „{handbookFileName}" analysiert — Vorschläge unten prüfen und übernehmen, Beschreibung ggf.
                          anpassen.
                        </div>
                      )}
                      {handbookError && <div className="hint warn">{handbookError}</div>}
                    </div>
                    <div className="lf-field">
                      <label>Bereich * (Pflichtfeld, mehrere möglich — legt fest, wo dieser Kurs in der Journey auswählbar ist)</label>
                      {/* Der separate Hinweis-Kasten ("automatisch erkannt") ist wieder
                          weg (15.09., Rückmeldung "egal was ich eingebe, es kommt immer
                          dieses Banner davor") — er erschien bei praktisch jedem Text
                          erneut, da matchSkills() schnell irgendeinen Treffer findet.
                          Die Vorausfüllung selbst bleibt (siehe useEffect oben), nur ohne
                          die zusätzliche Textzeile; welche Bereiche aktiv sind, sieht man
                          direkt an den blau markierten Pills unten. */}
                      <div className="bereich-toggle-row">
                        {BEREICH_OPTIONS.map((o) => (
                          <button
                            type="button"
                            key={o.key}
                            className={`bereich-toggle-btn ${courseForm.bereichKeys.includes(o.key) ? "active" : ""}`}
                            onClick={() => toggleCourseBereich(o.key)}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                      {courseForm.bereichKeys.length === 0 && (
                        <div className="hint warn">
                          Ohne Bereich taucht dieser Kurs in der Journey-Bereichsauswahl nicht auf.
                        </div>
                      )}
                    </div>
                    <div className="lf-field">
                      {targetRoleSuggestions.length > 0 && (
                        <div className="role-suggest-row">
                          <span className="hint">Vorschlag:</span>
                          {targetRoleSuggestions.map(({ role, percentage }) => (
                            <button
                              type="button"
                              key={role.role_id}
                              className={`role-suggest-chip ${courseForm.targetRoleIds.includes(role.role_id) ? "active" : ""}`}
                              onClick={() => toggleCourseTargetRole(role.role_id)}
                            >
                              {role.role_name || role.role_id} · {Math.round(percentage)}%
                            </button>
                          ))}
                        </div>
                      )}
                      <label>Zielrollen zuordnen (optional, mehrere möglich)</label>
                      {/* Kompakte Combobox statt dauerhaft ausgeklappter Checkbox-Liste
                         (Version 24) — ausgewählte Rollen als Chips, Ergebnisliste nur
                         als kleines Dropdown bei Fokus/Eingabe sichtbar, dazu "+ Neue
                         Zielrolle anlegen" direkt erreichbar (siehe newRoleFormOpen unten). */}
                      {courseForm.targetRoleIds.length > 0 && (
                        <div className="role-chip-row">
                          {courseForm.targetRoleIds.map((id) => {
                            const r = roles.find((x) => x.role_id === id);
                            return (
                              <span className="role-chip" key={id}>
                                {r ? r.role_name || r.role_id : id}
                                <button
                                  type="button"
                                  onClick={() => toggleCourseTargetRole(id)}
                                  aria-label={`${r ? r.role_name || r.role_id : id} entfernen`}
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      )}
                      <div className="role-combo">
                        <input
                          className="role-combo-input"
                          type="text"
                          placeholder={roles.length === 0 ? "Noch keine Zielrollen — hier eine anlegen…" : "Zielrolle suchen…"}
                          value={roleComboQuery}
                          onChange={(e) => {
                            setRoleComboQuery(e.target.value);
                            setRoleComboOpen(true);
                          }}
                          onFocus={() => setRoleComboOpen(true)}
                          onBlur={() => window.setTimeout(() => setRoleComboOpen(false), 150)}
                        />
                        {roleComboOpen &&
                          (() => {
                            const q = roleComboQuery.trim().toLowerCase();
                            const matches = roles
                              .filter((r) => !courseForm.targetRoleIds.includes(r.role_id))
                              .filter((r) => !q || (r.role_name || r.role_id).toLowerCase().includes(q))
                              .slice(0, 30);
                            return (
                              <div className="role-combo-dropdown">
                                {matches.map((r) => (
                                  <button
                                    type="button"
                                    key={r.role_id}
                                    className="role-combo-option"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => selectRoleFromCombo(r.role_id)}
                                  >
                                    {r.role_name || r.role_id}
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  className="role-combo-option role-combo-create"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => openNewRoleForm(roleComboQuery)}
                                >
                                  {roleComboQuery.trim()
                                    ? `+ „${roleComboQuery.trim()}" als neue Zielrolle anlegen`
                                    : "+ Neue Zielrolle anlegen"}
                                </button>
                              </div>
                            );
                          })()}
                      </div>
                      {newRoleFormOpen && (
                        <div className="new-role-form">
                          <div className="new-role-form-header">
                            <b>Neue Zielrolle anlegen</b>
                            <button type="button" className="new-role-form-close" onClick={closeNewRoleForm} aria-label="Abbrechen">
                              ×
                            </button>
                          </div>
                          <input
                            className="new-role-name-input"
                            type="text"
                            placeholder="Name der Zielrolle, z.B. Data Analyst"
                            value={newRoleName}
                            onChange={(e) => setNewRoleName(e.target.value)}
                          />
                          <input
                            className="skill-search-input"
                            type="text"
                            placeholder="Skills suchen und hinzufügen, z.B. SQL, Excel…"
                            value={newRoleSkillQuery}
                            onChange={(e) => setNewRoleSkillQuery(e.target.value)}
                          />
                          {newRoleSkillSearchBusy && <div className="hint">Suche…</div>}
                          {newRoleSkillResults.length > 0 && (
                            <div className="course-skill-chip-row" style={{ marginTop: 6 }}>
                              {newRoleSkillResults.map((s) => {
                                const added = newRoleSelectedSkills.some((x) => x.esco_uri === s.esco_uri);
                                return (
                                  <button
                                    type="button"
                                    key={s.esco_uri}
                                    className={added ? "course-skill-chip" : "skill-suggest-chip"}
                                    onClick={() => !added && addNewRoleSkill(s)}
                                    disabled={added}
                                  >
                                    {added ? "✓ " : "+ "}
                                    {s.preferred_label}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {newRoleSelectedSkills.length > 0 && (
                            <div className="new-role-skill-list">
                              {newRoleSelectedSkills.map((s) => (
                                <div className="new-role-skill-row" key={s.esco_uri}>
                                  <span className="new-role-skill-name">{skillLabelCache[s.esco_uri] ?? s.esco_uri}</span>
                                  <label className="new-role-skill-weight">
                                    Gewicht
                                    <input
                                      type="number"
                                      min={1}
                                      step={1}
                                      value={s.weight}
                                      onChange={(e) => setNewRoleSkillWeight(s.esco_uri, Number(e.target.value))}
                                    />
                                  </label>
                                  <button type="button" onClick={() => removeNewRoleSkill(s.esco_uri)} aria-label="Skill entfernen">
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {newRoleError && <div className="hint warn">{newRoleError}</div>}
                          <div className="new-role-form-actions">
                            <button type="button" className="btn-secondary-small" onClick={closeNewRoleForm} disabled={newRoleBusy}>
                              Abbrechen
                            </button>
                            <button type="button" className="btn-ai" onClick={() => void handleCreateNewRole()} disabled={newRoleBusy}>
                              {newRoleBusy ? "Lege an…" : "Zielrolle anlegen"}
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="hint">
                        {targetRoleSuggestBusy
                          ? "Ermittle passende Zielrollen…"
                          : "Rein informativ — ersetzt nicht die Skill-Zuordnung unten, hilft aber später bei der Einordnung."}
                      </div>
                    </div>
                    {/* Kritischer Fix: Skill-Zuordnung, siehe kritische-prozess-analyse.md
                       Finding 1 — ohne dieses Feld war ein hier angelegter Kurs fuer das
                       Matching komplett unsichtbar. Da es keinen eigenen "alle Skills"-
                       Endpunkt gibt, wird hier derselbe Kniff wie im Fragebogen-Schritt der
                       Journey genutzt: eine Zielrolle waehlen, ihre komplette Skill-Liste
                       durchsuchen und ankreuzen, was der Kurs davon abdeckt — mehrfach fuer
                       verschiedene Rollen moeglich, die Auswahl sammelt sich auf. Ergaenzend
                       (siehe oben): Skills lassen sich alternativ aus einer Kursbeschreibung
                       automatisch vorschlagen und hier nach Pruefung uebernehmen. */}
                    <div className="lf-field">
                      <label>ESCO-Skills direkt suchen</label>
                      <input
                        className="skill-search-input"
                        placeholder="Skill-Namen eintippen, z.B. Excel oder Projektmanagement…"
                        value={skillSearchQuery}
                        onChange={(e) => setSkillSearchQuery(e.target.value)}
                      />
                      {skillSearchBusy && <div className="hint">Suche…</div>}
                      {skillSearchError && <div className="hint warn">{skillSearchError}</div>}
                      {skillSearchResults.length > 0 && (
                        <div className="course-skill-chip-row" style={{ marginTop: 6 }}>
                          {skillSearchResults.map((m) => {
                            const added = courseSkillUris.has(m.esco_uri);
                            return (
                              <button
                                type="button"
                                key={m.esco_uri}
                                className={added ? "course-skill-chip" : "skill-suggest-chip"}
                                onClick={() => !added && addSearchedSkill(m)}
                                disabled={added}
                              >
                                {added ? "✓ " : "+ "}
                                {m.preferred_label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="lf-field">
                      <label>Skills manuell zuordnen — Zielrolle wählen, um ihre Skills anzuzeigen</label>
                      <select value={skillPickerRoleId} onChange={(e) => loadSkillPickerRole(e.target.value)}>
                        <option value="">— Zielrolle wählen —</option>
                        {roles.map((r) => (
                          <option key={r.role_id} value={r.role_id}>
                            {r.role_name || r.role_id}
                          </option>
                        ))}
                      </select>
                    </div>
                    {skillPickerLoading && <div className="hint">Lade Skills…</div>}
                    {skillPickerError && (
                      <div className="form-status err" aria-live="polite">
                        {skillPickerError}
                      </div>
                    )}
                    {skillPickerRoleId && !skillPickerLoading && !skillPickerError && (
                      <div className="skill-picker-list">
                        {skillPickerSkills.length === 0 ? (
                          <div className="hint">Für diese Rolle sind noch keine Skills hinterlegt.</div>
                        ) : (
                          skillPickerSkills.map((s) => {
                            const checked = courseSkillUris.has(s.esco_uri);
                            return (
                              <label key={s.esco_uri} className={`skill-picker-item ${checked ? "checked" : ""}`}>
                                <input type="checkbox" checked={checked} onChange={() => toggleCourseSkillUri(s.esco_uri)} />
                                {s.preferred_label}
                              </label>
                            );
                          })
                        )}
                      </div>
                    )}
                    <div className="lf-field">
                      <label>Zugeordnete Skills ({courseSkillUris.size})</label>
                      {courseSkillUris.size === 0 ? (
                        <div className="hint warn">
                          ⚠ Noch keine Skills zugeordnet — ohne Zuordnung kann dieser Kurs nie als persönliche
                          Empfehlung in der Journey erscheinen.
                        </div>
                      ) : (
                        <div className="course-skill-level-list">
                          <div className="course-skill-level-head">
                            <span>Skill</span>
                            <span>Erfahrungslevel nach dem Kurs</span>
                          </div>
                          {Array.from(courseSkillUris).map((uri) => (
                            <div className="course-skill-level-row" key={uri}>
                              <div className="course-skill-level-name">
                                {skillLabelCache[uri] ?? "Skill (Rolle einmal durchsuchen für den Namen)"}
                                <button
                                  type="button"
                                  className="chip-remove"
                                  onClick={() => toggleCourseSkillUri(uri)}
                                  aria-label="Skill entfernen"
                                >
                                  ×
                                </button>
                              </div>
                              <div className="experience-level-toggle">
                                {EXPERIENCE_LEVEL_ORDER.map((lvl) => (
                                  <button
                                    key={lvl}
                                    type="button"
                                    className={`experience-level-btn ${courseSkillLevels[uri] === lvl ? "active" : ""}`}
                                    onClick={() => setCourseSkillLevel(uri, lvl)}
                                  >
                                    {EXPERIENCE_LEVEL_LABELS[lvl]}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {courseSkillUris.size > 0 && (
                        <div className="import-file-row" style={{ marginTop: 8 }}>
                          <button type="button" className={`btn-ai ${levelRefineBusy ? "busy" : ""}`} onClick={handleRefineSkillLevels} disabled={levelRefineBusy}>
                            <span className="btn-ai-icon">✨</span>
                            {levelRefineBusy ? "Verfeinere…" : "Erfahrungslevel mit KI verfeinern"}
                          </button>
                          <span className="hint">
                            Optional — verfeinert die Schätzung oben per KI, ersetzt sie aber nicht: jedes Level bleibt per
                            Klick änderbar.
                          </span>
                        </div>
                      )}
                      {levelRefineError && <div className="hint warn">{levelRefineError}</div>}
                    </div>
                    <div className="course-form-actions">
                      <button
                        className="btn-primary"
                        onClick={handleAddCourse}
                        disabled={
                          savingCourse ||
                          !courseForm.courseId.trim() ||
                          !courseForm.courseName.trim() ||
                          !courseForm.provider.trim() ||
                          courseForm.bereichKeys.length === 0
                        }
                      >
                        {savingCourse ? "Speichere…" : editingCourseId ? "Änderungen speichern →" : "Kurs speichern →"}
                      </button>
                      {editingCourseId && (
                        <button type="button" className="btn-ghost" onClick={resetCourseForm} disabled={savingCourse}>
                          Abbrechen
                        </button>
                      )}
                    </div>
                    {courseFormStatus.msg && (
                      <div className={`form-status ${courseFormStatus.kind}`} aria-live="polite">
                        {courseFormStatus.msg}
                      </div>
                    )}
                  </div>
                </div>
              </details>
              <details className="app-card collapsible-card" data-tour="kurse-csv-import">
                <summary>
                  <span>📥 Kurse aus CSV importieren</span>
                  <span className="collapsible-hint">Mehrere Kurse auf einmal aus einer Excel-/CSV-Exportdatei anlegen</span>
                </summary>
                <div className="app-card-body">
                  <div className="hint">
                    Funktioniert mit jeder CSV-Datei, die mindestens Kursname und Dauer enthält — z. B. ein Export
                    aus eurer Kursverwaltungssoftware oder eine selbst gepflegte Excel-Liste (in Excel als „CSV
                    UTF-8" speichern, sonst können Umlaute falsch ankommen). Die Spalten müssen nicht exakt so
                    heißen wie bei uns — du ordnest sie im nächsten Schritt zu. Bringt die Datei eine{" "}
                    <strong>Beschreibungs-Spalte</strong> mit, lassen sich daraus unten automatisch passende Skills
                    vorschlagen (dieselbe Erkennung wie beim manuellen Anlegen) — die Vorschläge stehen als Chips vor
                    dem eigentlichen Import zur Prüfung bereit und lassen sich einzeln entfernen. Ohne
                    Beschreibungs-Spalte (oder wenn du nichts zuordnest) bleibt Skill-Zuordnung wie bisher ein
                    bewusster Schritt danach über „✎ Bearbeiten" pro Kurs.
                  </div>
                  <div className="import-file-row">
                    <div className="lf-field" style={{ flex: "1 1 260px" }}>
                      <label>CSV-Datei wählen</label>
                      <label
                        htmlFor="csv-file-input"
                        className={`handbook-dropzone csv-dropzone ${csvDragOver ? "drag-over" : ""}`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setCsvDragOver(true);
                        }}
                        onDragLeave={() => setCsvDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setCsvDragOver(false);
                          const file = e.dataTransfer.files?.[0];
                          if (file) processImportFile(file);
                        }}
                      >
                        <input id="csv-file-input" type="file" accept=".csv,text/csv" onChange={handleImportFile} hidden />
                        <span className="handbook-dropzone-icon">📊</span>
                        <span className="handbook-dropzone-text">
                          {importFileName ? (
                            <strong>{importFileName}</strong>
                          ) : (
                            <>
                              Datei hierher ziehen oder <strong>klicken zum Auswählen</strong>
                            </>
                          )}
                        </span>
                        <span className="handbook-dropzone-hint">CSV (UTF-8)</span>
                      </label>
                    </div>
                    <button type="button" className="btn-ghost" onClick={downloadImportTemplate}>
                      Vorlage herunterladen
                    </button>
                  </div>
                  {importFileName && !importParseError && (
                    <div className="hint">
                      Datei: {importFileName} · {importDataRows.length} Zeile{importDataRows.length === 1 ? "" : "n"}{" "}
                      erkannt
                    </div>
                  )}
                  {importParseError && <div className="form-status err">{importParseError}</div>}
                  {importHeaders.length > 0 && (
                    <>
                      <div className="row2">
                        <div className="lf-field">
                          <label>Spalte für Kurs-ID (optional — sonst automatisch aus Kursname)</label>
                          <select
                            value={importMapping.courseId}
                            onChange={(e) => setImportMapping((m) => ({ ...m, courseId: Number(e.target.value) }))}
                          >
                            <option value={-1}>— automatisch generieren —</option>
                            {importHeaders.map((h, i) => (
                              <option key={i} value={i}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="lf-field">
                          <label>Spalte für Kursname *</label>
                          <select
                            value={importMapping.courseName}
                            onChange={(e) => setImportMapping((m) => ({ ...m, courseName: Number(e.target.value) }))}
                          >
                            <option value={-1}>— wählen —</option>
                            {importHeaders.map((h, i) => (
                              <option key={i} value={i}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="row2">
                        <div className="lf-field">
                          <label>Spalte für Anbieter</label>
                          <select
                            value={importMapping.provider}
                            onChange={(e) => setImportMapping((m) => ({ ...m, provider: Number(e.target.value) }))}
                          >
                            <option value={-1}>— keine —</option>
                            {importHeaders.map((h, i) => (
                              <option key={i} value={i}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="lf-field">
                          <label>Spalte für Dauer *</label>
                          <select
                            value={importMapping.durationWeeks}
                            onChange={(e) => setImportMapping((m) => ({ ...m, durationWeeks: Number(e.target.value) }))}
                          >
                            <option value={-1}>— wählen —</option>
                            {importHeaders.map((h, i) => (
                              <option key={i} value={i}>
                                {h}
                              </option>
                            ))}
                          </select>
                          <div className="hint">Erkennt Zahlen, „X Monate", „X Tage", „X Stunden" — sonst wird als Wochen angenommen.</div>
                        </div>
                      </div>
                      <div className="row2">
                        <div className="lf-field">
                          <label>Spalte für Beschreibung (optional — für automatische Skill-Erkennung)</label>
                          <select
                            value={importMapping.description}
                            onChange={(e) => {
                              const value = Number(e.target.value);
                              setImportMapping((m) => ({ ...m, description: value }));
                              setImportSkillSuggestions({});
                              setImportApprovedSkillUris({});
                              setImportSkillDetectError(null);
                            }}
                          >
                            <option value={-1}>— keine —</option>
                            {importHeaders.map((h, i) => (
                              <option key={i} value={i}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </div>
                        {importMapping.description >= 0 && (
                          <div className="lf-field">
                            <label>&nbsp;</label>
                            <button
                              type="button"
                              className="btn-ghost"
                              onClick={handleDetectImportSkills}
                              disabled={importSkillDetectBusy}
                            >
                              {importSkillDetectBusy
                                ? `Ermittle Skills… (${importSkillDetectProgress.done}/${importSkillDetectProgress.total})`
                                : "🔍 Skills aus Beschreibungen ermitteln"}
                            </button>
                          </div>
                        )}
                      </div>
                      {/* Version 32, 14.09. — weitere optionale Spalten, siehe
                         Kommentar an ImportMapping oben. */}
                      <div className="row2">
                        <div className="lf-field">
                          <label>Spalte für Preis in € (optional)</label>
                          <select
                            value={importMapping.priceEur}
                            onChange={(e) => setImportMapping((m) => ({ ...m, priceEur: Number(e.target.value) }))}
                          >
                            <option value={-1}>— keine —</option>
                            {importHeaders.map((h, i) => (
                              <option key={i} value={i}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="lf-field">
                          <label>Spalte für Unterrichtseinheiten (optional)</label>
                          <select
                            value={importMapping.teachingUnits}
                            onChange={(e) => setImportMapping((m) => ({ ...m, teachingUnits: Number(e.target.value) }))}
                          >
                            <option value={-1}>— keine —</option>
                            {importHeaders.map((h, i) => (
                              <option key={i} value={i}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="row2">
                        <div className="lf-field">
                          <label>Spalte für Maßnahmenummer (optional)</label>
                          <select
                            value={importMapping.fundingMeasureNumber}
                            onChange={(e) =>
                              setImportMapping((m) => ({ ...m, fundingMeasureNumber: Number(e.target.value) }))
                            }
                          >
                            <option value={-1}>— keine —</option>
                            {importHeaders.map((h, i) => (
                              <option key={i} value={i}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="lf-field">
                          <label>Spalte für Zielgruppe/Voraussetzungen (optional)</label>
                          <select
                            value={importMapping.targetGroup}
                            onChange={(e) => setImportMapping((m) => ({ ...m, targetGroup: Number(e.target.value) }))}
                          >
                            <option value={-1}>— keine —</option>
                            {importHeaders.map((h, i) => (
                              <option key={i} value={i}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="hint">
                        Förderart (Bildungsgutschein/Aufstiegs-BAföG/…), Abschlussart, DQR-Niveau, Prüfungsgebühr und
                        USt.-Hinweis lassen sich aktuell nur im manuellen Formular („✎ Bearbeiten" nach dem Import)
                        pflegen — dafür zu unterschiedlich, um sie zuverlässig aus einer einzelnen freien CSV-Spalte
                        zu lesen.
                      </div>
                      {importSkillDetectError && <div className="hint warn">{importSkillDetectError}</div>}
                      {importMapping.courseName === -1 || importMapping.durationWeeks === -1 ? (
                        <div className="hint warn">⚠ Bitte mindestens Kursname und Dauer zuordnen, um die Vorschau zu sehen.</div>
                      ) : (
                        (() => {
                          const preview = buildImportPreview();
                          const validRows = preview.filter((r) => r.valid);
                          const updateCount = validRows.filter((r) => r.willUpdate).length;
                          return (
                            <>
                              <div className="hint">
                                {validRows.length} von {preview.length} Zeilen gültig
                                {updateCount > 0 &&
                                  ` · ${updateCount} davon aktualisieren einen bereits vorhandenen Kurs (gleiche Kurs-ID)`}
                                {validRows.length < preview.length &&
                                  ` · ${preview.length - validRows.length} übersprungen (Grund siehe Vorschau)`}
                              </div>
                              <div className="import-preview-table-wrap">
                                <table className="import-preview-table">
                                  <thead>
                                    <tr>
                                      <th>Kurs-ID</th>
                                      <th>Kursname</th>
                                      <th>Anbieter</th>
                                      <th>Dauer (Wochen)</th>
                                      {importMapping.priceEur >= 0 && <th>Preis</th>}
                                      {importMapping.teachingUnits >= 0 && <th>UE</th>}
                                      <th>Status</th>
                                      {importMapping.description >= 0 && <th>Skills (automatisch)</th>}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {preview.slice(0, 12).map((r) => (
                                      <tr key={r.index} className={r.valid ? "" : "row-invalid"}>
                                        <td>{r.courseId || "—"}</td>
                                        <td>{r.courseName || "—"}</td>
                                        <td>{r.provider || "—"}</td>
                                        <td>{r.durationWeeks ?? "—"}</td>
                                        {importMapping.priceEur >= 0 && (
                                          <td>{r.priceEur != null ? `${r.priceEur.toFixed(2)} €` : "—"}</td>
                                        )}
                                        {importMapping.teachingUnits >= 0 && <td>{r.teachingUnits ?? "—"}</td>}
                                        <td>{r.valid ? (r.willUpdate ? "Aktualisierung" : "Neu") : `⚠ ${r.reason}`}</td>
                                        {importMapping.description >= 0 && (
                                          <td>{(importApprovedSkillUris[r.index] ?? []).length || "—"}</td>
                                        )}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {preview.length > 12 && (
                                <div className="hint">… und {preview.length - 12} weitere Zeile{preview.length - 12 === 1 ? "" : "n"} (werden mit importiert, hier nur nicht angezeigt).</div>
                              )}
                              {Object.keys(importSkillSuggestions).length > 0 && (
                                <div className="skill-suggest-box" data-tour="kurse-skill-suggest">
                                  <div className="hint">
                                    🔍 Automatisch erkannte Skills — bitte prüfen, falsche Vorschläge mit „×" entfernen
                                  </div>
                                  {preview
                                    .filter((r) => (importSkillSuggestions[r.index] ?? []).length > 0)
                                    .slice(0, 12)
                                    .map((r) => (
                                      <div className="import-skill-row" key={r.index}>
                                        <strong>{r.courseName || r.courseId}</strong>
                                        <div className="course-skill-chip-row">
                                          {(importSkillSuggestions[r.index] ?? []).map((m) => {
                                            const approved = (importApprovedSkillUris[r.index] ?? []).includes(m.esco_uri);
                                            const level = importSkillLevels[r.index]?.[m.esco_uri];
                                            return (
                                              <span
                                                className={approved ? "course-skill-chip" : "skill-suggest-chip dismissed"}
                                                key={m.esco_uri}
                                              >
                                                {m.preferred_label}
                                                {approved && level && (
                                                  <span className="skill-level-badges">
                                                    {EXPERIENCE_LEVEL_ORDER.map((lvl) => (
                                                      <button
                                                        key={lvl}
                                                        type="button"
                                                        className={`skill-level-badge ${level === lvl ? "active" : ""}`}
                                                        onClick={() => setImportSkillLevel(r.index, m.esco_uri, lvl)}
                                                        title={EXPERIENCE_LEVEL_LABELS[lvl]}
                                                      >
                                                        {EXPERIENCE_LEVEL_SHORT_LABELS[lvl]}
                                                      </button>
                                                    ))}
                                                  </span>
                                                )}
                                                <button
                                                  type="button"
                                                  className={approved ? "chip-remove" : "chip-add"}
                                                  onClick={() => toggleImportApprovedSkillUri(r.index, m.esco_uri)}
                                                  aria-label={approved ? "Skill entfernen" : "Skill wieder übernehmen"}
                                                  title={approved ? "Entfernen" : "Wieder übernehmen"}
                                                >
                                                  {approved ? "×" : "✓"}
                                                </button>
                                              </span>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ))}
                                </div>
                              )}
                              <div className="course-form-actions">
                                <button
                                  className="btn-primary"
                                  onClick={handleRunImport}
                                  disabled={importBusy || validRows.length === 0}
                                >
                                  {importBusy
                                    ? `Importiere… (${importProgress.done}/${importProgress.total})`
                                    : `${validRows.length} Kurs${validRows.length === 1 ? "" : "e"} importieren →`}
                                </button>
                                <button type="button" className="btn-ghost" onClick={resetImport} disabled={importBusy}>
                                  Zurücksetzen
                                </button>
                              </div>
                            </>
                          );
                        })()
                      )}
                      {importSummary && (
                        <div className={`form-status ${importSummary.failed === 0 ? "ok" : "err"}`} aria-live="polite">
                          ✓ {importSummary.ok} Kurs{importSummary.ok === 1 ? "" : "e"} importiert
                          {importSummary.failed > 0 && `, ${importSummary.failed} fehlgeschlagen`}
                          {importSummary.errors.length > 0 && (
                            <ul className="import-summary-errors">
                              {importSummary.errors.slice(0, 5).map((e, i) => (
                                <li key={i}>{e}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </details>
              <details className="app-card collapsible-card" data-tour="kurse-url-import">
                <summary>
                  <span>🔗 Kurse per URL importieren</span>
                  <span className="collapsible-hint">
                    Domain durchsuchen oder einzelne Kurs-Seite einfügen — eine KI liest Preis, Förderung &amp;
                    Co. heraus, du prüfst vor dem Speichern
                  </span>
                </summary>
                <div className="app-card-body">
                  <div className="hint">
                    Ergänzt Formular und CSV-Import um einen dritten Weg: entweder deine Domain eingeben (wir
                    suchen automatisch in eurer sitemap.xml nach Kurs-Seiten) oder direkt eine einzelne
                    Kurs-Seiten-URL einfügen. Für jede ausgewählte Seite wird ein Entwurf ins Formular oben
                    übernommen — <strong>nichts wird automatisch gespeichert</strong>, du prüfst und ergänzt jeden
                    Kurs, bevor du auf „Kurs speichern" klickst. Felder mit einem wörtlichen Beleg auf der Seite
                    sind mit „✓ von Seite" markiert, alle anderen wie eine leere Eingabe zu behandeln.
                  </div>

                  {urlImportResumeAvailable && (
                    <div className="hint warn url-import-resume-banner">
                      <div>
                        Du hattest einen Import mit {urlImportResumeAvailable.remainingUrls.length} von{" "}
                        {urlImportResumeAvailable.total} Kurs{urlImportResumeAvailable.total === 1 ? "" : "en"} noch
                        offen — später fortsetzen?
                      </div>
                      <div className="url-import-resume-actions">
                        <button type="button" className="btn-primary" onClick={handleResumeUrlImportQueue}>
                          Fortsetzen
                        </button>
                        <button type="button" className="btn-ghost" onClick={discardUrlImportResume}>
                          Verwerfen
                        </button>
                      </div>
                    </div>
                  )}

                  {!urlImportCurrentUrl && urlImportQueueTotal === 0 && (
                    <>
                      <div className="row2">
                        <div className="lf-field" style={{ flex: "1 1 260px" }}>
                          <label>Domain des Bildungsträgers</label>
                          <input
                            placeholder="www.dein-bildungstraeger.de"
                            value={urlImportDomain}
                            onChange={(e) => setUrlImportDomain(e.target.value)}
                            disabled={urlImportDiscoverBusy}
                          />
                        </div>
                        <div className="lf-field" style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
                          <button
                            type="button"
                            className={`btn-ai ${urlImportDiscoverBusy ? "busy" : ""}`}
                            onClick={handleDiscoverCourseUrls}
                            disabled={urlImportDiscoverBusy || !urlImportDomain.trim()}
                          >
                            <span className="btn-ai-icon">🔎</span>
                            {urlImportDiscoverBusy ? "Suche…" : "Kurs-Seiten finden"}
                          </button>
                        </div>
                      </div>
                      {urlImportDiscoverError && <div className="hint warn">{urlImportDiscoverError}</div>}

                      {urlImportCandidates.length > 0 && (
                        <div className="url-import-candidates">
                          <div className="hint">
                            {urlImportCandidates.length} Kurs-typische URL{urlImportCandidates.length === 1 ? "" : "s"}{" "}
                            gefunden (aus {urlImportSitemapUrl}){urlImportTruncated ? " — evtl. nicht alle, Sitemap war größer" : ""}.{" "}
                            {urlImportSelected.size} ausgewählt.
                          </div>
                          <div className="url-import-select-actions">
                            <button
                              type="button"
                              className="btn-ghost btn-small"
                              onClick={() => setUrlImportSelected(new Set(urlImportCandidates))}
                              disabled={urlImportSelected.size === urlImportCandidates.length}
                            >
                              Alle auswählen ({urlImportCandidates.length})
                            </button>
                            <button
                              type="button"
                              className="btn-ghost btn-small"
                              onClick={() => setUrlImportSelected(new Set())}
                              disabled={urlImportSelected.size === 0}
                            >
                              Alle abwählen
                            </button>
                          </div>
                          <ul className="url-import-candidate-list">
                            {urlImportCandidates.map((url) => (
                              <li key={url}>
                                <label className="lf-checkbox-field">
                                  <input
                                    type="checkbox"
                                    checked={urlImportSelected.has(url)}
                                    onChange={() => toggleUrlImportCandidate(url)}
                                  />
                                  <span className="url-import-candidate-url">{url}</span>
                                </label>
                              </li>
                            ))}
                          </ul>
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => startUrlImportQueue(Array.from(urlImportSelected))}
                            disabled={urlImportSelected.size === 0}
                          >
                            {urlImportSelected.size === 0
                              ? "Ausgewählte importieren"
                              : `${urlImportSelected.size} ausgewählte${urlImportSelected.size === 1 ? "n" : ""} Kurs${urlImportSelected.size === 1 ? "" : "e"} importieren →`}
                          </button>
                        </div>
                      )}

                      <div className="hint" style={{ marginTop: 14 }}>
                        Oder direkt eine einzelne Kurs-Seiten-URL einfügen:
                      </div>
                      <div className="row2">
                        <div className="lf-field" style={{ flex: "1 1 260px" }}>
                          <label>Kurs-Seiten-URL</label>
                          <input
                            placeholder="https://www.dein-bildungstraeger.de/kurs/beispiel-kurs/"
                            value={urlImportSingleUrl}
                            onChange={(e) => setUrlImportSingleUrl(e.target.value)}
                          />
                        </div>
                        <div className="lf-field" style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
                          <button
                            type="button"
                            className="btn-ai"
                            onClick={handleImportSingleUrl}
                            disabled={!urlImportSingleUrl.trim()}
                          >
                            <span className="btn-ai-icon">✨</span>
                            Diese Seite importieren
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {(urlImportCurrentUrl || urlImportQueueTotal > 0) && (
                    <div className="url-import-queue-status">
                      {urlImportQueueTotal > 1 && (
                        <div className="hint">
                          Kurs {urlImportQueueDone + 1} von {urlImportQueueTotal}
                        </div>
                      )}
                      {urlImportExtractBusy && urlImportCurrentUrl ? (
                        // Waehrend der eigentlichen KI-Extraktion: ausfuehrliche
                        // Ladeanzeige statt des kompakten Schritt-Trackers (siehe
                        // UrlImportAnalysisLoader oben) — danach (fertig/Fehler)
                        // uebernimmt wieder der kompakte Tracker unten, der dann
                        // zusaetzlich die (erst jetzt startende) Skill-/
                        // Zielrollen-Erkennung zeigt.
                        <UrlImportAnalysisLoader
                          url={urlImportCurrentUrl}
                          courseIndex={urlImportQueueDone}
                          courseTotal={urlImportQueueTotal}
                        />
                      ) : (
                        <div className="url-import-progress">
                          <UrlImportProgressStep
                            status={urlImportExtractError ? "error" : urlImportCurrentUrl ? "done" : "pending"}
                            label={<>Seite lesen &amp; Kursdaten extrahieren (KI) — {urlImportCurrentUrl}</>}
                          />
                          {!urlImportExtractError && urlImportCurrentUrl && (
                            <>
                              <UrlImportProgressStep
                                status={
                                  manualSkillDetectBusy
                                    ? "active"
                                    : manualSuggestedSkills.length > 0 || manualSkillDetectError
                                    ? "done"
                                    : "pending"
                                }
                                label={
                                  <>
                                    Skills automatisch erkennen
                                    {manualSuggestedSkills.length > 0 &&
                                      ` — ${manualSuggestedSkills.length} Vorschlag${manualSuggestedSkills.length === 1 ? "" : "e"} unten im Formular`}
                                  </>
                                }
                              />
                              {roles.length > 0 && (
                                <UrlImportProgressStep
                                  status={targetRoleSuggestBusy ? "active" : targetRoleSuggestAttempted ? "done" : "pending"}
                                  label={
                                    <>
                                      Passende Zielrolle ermitteln
                                      {targetRoleSuggestAttempted && targetRoleSuggestions.length > 0 &&
                                        ` — z.B. „${targetRoleSuggestions[0].role.role_name}"`}
                                      {targetRoleSuggestAttempted && targetRoleSuggestions.length === 0 && " — keine eindeutige gefunden"}
                                    </>
                                  }
                                />
                              )}
                            </>
                          )}
                        </div>
                      )}
                      {!urlImportExtractBusy && urlImportCurrentUrl && !urlImportExtractError && (
                        <div className="hint">
                          Entwurf von <strong>{urlImportCurrentUrl}</strong> oben ins Formular übernommen — bitte
                          prüfen, ergänzen und „Kurs speichern" klicken.
                        </div>
                      )}
                      {urlImportExtractError && <div className="hint warn">{urlImportExtractError}</div>}
                      <div className="import-file-row">
                        {urlImportQueue.length > 0 && (
                          <button type="button" className="btn-ghost" onClick={advanceUrlImportQueue} disabled={urlImportExtractBusy}>
                            Weiter zum nächsten Kurs ({urlImportQueue.length} verbleiben)
                          </button>
                        )}
                        <button type="button" className="btn-ghost" onClick={endUrlImportQueue} disabled={urlImportExtractBusy}>
                          {urlImportQueue.length > 0 ? "Import beenden" : "Fertig"}
                        </button>
                      </div>
                      {urlImportQueue.length > 0 && (
                        <div className="hint">
                          „Import beenden" verwirft die verbleibenden {urlImportQueue.length} Kurse. Einfach die
                          Seite verlassen und später zurückkommen geht auch — der Rest bleibt dann erhalten.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </details>
              <div className="app-card" data-tour="kurse-catalog">
                <div className="app-card-header">
                  <div>
                    <h2>Dein Kurskatalog</h2>
                    <div className="sub">
                      {displayedCourses.length ? `${displayedCourses.length} Kurs${displayedCourses.length === 1 ? "" : "e"}` : "Noch keine Kurse"} ·{" "}
                      {displayedCourses.filter((c) => c.is_featured).length} als „Top" markiert
                    </div>
                  </div>
                </div>
                <div className="app-card-body">
                  {displayedCourses.length === 0 ? (
                    <div className="empty-state">
                      <span className="icon" aria-hidden="true">▤</span>
                      {notConnectedYet
                        ? "Noch keine Daten — links auf „Verbinden & laden“ klicken."
                        : "Noch keine Kurse — oben „+ Neuen Kurs hinzufügen“ nutzen."}
                    </div>
                  ) : (
                    <div className="course-manage-grid">
                      {displayedCourses.map((c) => (
                        <div
                          className={`course-manage-card ${c.is_featured ? "featured" : ""}`}
                          key={c.course_id}
                          role="button"
                          tabIndex={0}
                          style={{ cursor: "pointer" }}
                          onClick={() => { if (!tourDemoMode) trackCourseClick(c.course_name); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              if (!tourDemoMode) trackCourseClick(c.course_name);
                            }
                          }}
                          aria-label={`Kurs ansehen: ${c.course_name}`}
                        >
                          <CourseBadgeRow course={c} />
                          <div className="course-manage-top">
                            <div>
                              <div className="course-manage-name">{c.course_name}</div>
                              <div className="course-manage-meta">
                                {c.provider} · {c.duration_weeks} Wochen
                              </div>
                              {/* Bereich (15.09., Pflichtfeld) direkt im Listing sichtbar — u.a.
                                 damit Altkurse ohne Bereich auf einen Blick als nachpflegebedürftig
                                 erkennbar sind (tauchen sonst in der Journey nirgends auf). */}
                              <div className="course-manage-meta">
                                {(() => {
                                  // Mehrfachauswahl zuerst (15.09.), Einzelfeld nur als Fallback
                                  // für ältere Datensätze ohne bereich_labels.
                                  const labels = c.bereich_labels?.length
                                    ? c.bereich_labels
                                    : c.bereich_label
                                    ? [c.bereich_label]
                                    : c.bereich_key
                                    ? [c.bereich_key]
                                    : [];
                                  return labels.length ? (
                                    labels.join(" · ")
                                  ) : (
                                    <span className="hint warn">⚠ Kein Bereich zugeordnet — in Journey unsichtbar</span>
                                  );
                                })()}
                              </div>
                              {/* Version 25: macht die neuen Pflichtfelder auch im Kurskatalog-
                                 Listing sichtbar, nicht nur im Bearbeiten-Formular — sonst lässt
                                 sich nicht auf einen Blick prüfen, ob ein Kurs fürs Präferenz-
                                 Matching korrekt eingestellt ist. */}
                              <div className="course-manage-meta">
                                {COURSE_LOCATION_LABELS[c.location_mode ?? "remote"]}
                                {" · "}
                                {COURSE_EMPLOYMENT_LABELS[c.employment_mode ?? "beides"]}
                              </div>
                              {/* Version 32, 14.09.: macht Preis/UE/Förderung ebenfalls im Listing
                                 sichtbar, aus demselben Grund wie location_mode/employment_mode
                                 oben — sonst laesst sich nicht auf einen Blick pruefen, ob ein Kurs
                                 vollstaendig gepflegt ist. */}
                              {(c.price_eur != null || c.teaching_units != null || (c.funding_types && c.funding_types.length > 0)) && (
                                <div className="course-manage-meta">
                                  {c.price_eur != null && (
                                    <>
                                      {c.price_eur.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €
                                      {c.price_vat_exempt ? " (USt.-befreit)" : ""}
                                    </>
                                  )}
                                  {c.price_eur != null && c.teaching_units != null && " · "}
                                  {c.teaching_units != null && `${c.teaching_units} UE`}
                                  {(c.price_eur != null || c.teaching_units != null) && c.funding_types && c.funding_types.length > 0 && " · "}
                                  {c.funding_types && c.funding_types.length > 0 && (
                                    <span className="course-funding-badge">
                                      🎓 {c.funding_types.length === 1 ? "Gefördert" : `Gefördert (${c.funding_types.length})`}
                                    </span>
                                  )}
                                </div>
                              )}
                              {/* Kritischer Fix, siehe kritische-prozess-analyse.md Finding 1:
                                 macht sichtbar, welche VOR dem Fix angelegten Kurse noch keine
                                 Skill-Zuordnung haben und deshalb nie personalisiert empfohlen
                                 werden koennen — statt dass das still im Hintergrund passiert. */}
                              {c.covered_skill_uris.length === 0 ? (
                                <div className="course-skill-warning">⚠ Keine Skills zugeordnet — wird nie empfohlen</div>
                              ) : (
                                <div className="course-skill-count">
                                  🔗 {c.covered_skill_uris.length} Skill{c.covered_skill_uris.length === 1 ? "" : "s"} zugeordnet
                                </div>
                              )}
                              {/* Zielrollen sichtbar machen, sobald mehr als eine zugeordnet ist —
                                 siehe target_role_ids in orbit.ts. Fällt auf target_role_name
                                 zurück, falls ein älteres Backend nur das Einzelfeld liefert. */}
                              {(c.target_role_names?.length || c.target_role_name) && (
                                <div className="course-role-count">
                                  🎯 {(c.target_role_names?.length ? c.target_role_names : [c.target_role_name]).join(" · ")}
                                </div>
                              )}
                            </div>
                            {c.is_featured && <span className="popular-course-badge">★ Top</span>}
                          </div>
                          <button
                            type="button"
                            className="course-edit-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!tourDemoMode) startEditCourse(c);
                            }}
                          >
                            ✎ Bearbeiten
                          </button>
                          <button
                            className={`featured-toggle ${c.is_featured ? "on" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!tourDemoMode) void handleToggleFeatured(c);
                            }}
                            disabled={tourDemoMode || featuredBusyId === c.course_id}
                          >
                            {featuredBusyId === c.course_id ? "…" : c.is_featured ? "★ Als Top entfernen" : "☆ Als Top markieren"}
                          </button>
                          {/* Banner-Quick-Picker — genauso präsent/direkt anklickbar wie der
                             Top-Toggle oben, statt in "✎ Bearbeiten" versteckt. onClick auf dem
                             Wrapper stoppt die Bubble zur Kachel (die sonst trackCourseClick
                             auslöst) für alle Klicks/Eingaben darin. */}
                          <div className="banner-quickpick" onClick={(e) => e.stopPropagation()}>
                            <div className="banner-quickpick-label">Banner</div>
                            <div className="banner-quickpick-presets">
                              {BANNER_PRESETS.map((preset) => (
                                <button
                                  key={preset}
                                  type="button"
                                  className={`banner-preset-btn ${c.custom_banner === preset ? "on" : ""}`}
                                  disabled={tourDemoMode || bannerBusyId === c.course_id}
                                  onClick={() =>
                                    void handleUpdateBanner(c, { custom_banner: c.custom_banner === preset ? null : preset })
                                  }
                                >
                                  {preset}
                                </button>
                              ))}
                              {c.custom_banner && !BANNER_PRESETS.includes(c.custom_banner) && (
                                <button
                                  type="button"
                                  className="banner-preset-btn on"
                                  disabled={tourDemoMode || bannerBusyId === c.course_id}
                                  onClick={() => void handleUpdateBanner(c, { custom_banner: null })}
                                >
                                  {c.custom_banner}
                                </button>
                              )}
                            </div>
                            <div className="banner-quickpick-row">
                              <label className="banner-quickpick-field">
                                <span>Start</span>
                                <input
                                  type="date"
                                  defaultValue={c.starts_at ? c.starts_at.slice(0, 10) : ""}
                                  disabled={tourDemoMode || bannerBusyId === c.course_id}
                                  onBlur={(e) => {
                                    const val = e.target.value || null;
                                    if (val !== (c.starts_at ? c.starts_at.slice(0, 10) : null)) {
                                      void handleUpdateBanner(c, { starts_at: val });
                                    }
                                  }}
                                />
                              </label>
                              <label className="banner-quickpick-field">
                                <span>Plätze</span>
                                <input
                                  type="number"
                                  min="0"
                                  placeholder="—"
                                  defaultValue={c.seats_remaining ?? ""}
                                  disabled={tourDemoMode || bannerBusyId === c.course_id}
                                  onBlur={(e) => {
                                    const raw = e.target.value.trim();
                                    const val = raw === "" ? null : Math.max(0, Math.round(Number(raw)));
                                    if (val !== (c.seats_remaining ?? null)) {
                                      void handleUpdateBanner(c, { seats_remaining: val });
                                    }
                                  }}
                                />
                              </label>
                            </div>
                            {bannerBusyId === c.course_id && <div className="banner-quickpick-saving">Speichert…</div>}
                            {bannerError && bannerError.id === c.course_id && (
                              <div className="banner-quickpick-error">{bannerError.msg}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {tab === "reports" && (
            <div role="tabpanel" aria-label="Reports">
              <div className="page-head">
                <div>
                  <div className="eyebrow">DYD ORBIT · FÜR BILDUNGSTRÄGER &amp; AKADEMIEN</div>
                  <h1 className="display">Reports</h1>
                  <div className="sub">Dashboard-Kennzahlen aus deinen echten Leads</div>
                </div>
                <div className="head-actions">
                  <div className={`live-pill ${live ? "" : "offline"}`}>
                    <span>●</span> {live ? "live" : "offline"}
                  </div>
                  {refreshIcon()}
                </div>
              </div>
              <div className="tile-row" data-tour="tile-row-reports">
                <div className="tile" style={{ animationDelay: ".02s" }}>
                  <div className="tile-top">
                    <div className="tile-label">Neue Leads</div>
                    <div className="tile-icon-chip mint">◎</div>
                  </div>
                  <div className="tile-value display">{report || tourDemoMode ? <AnimatedNumber value={displayedLeadCount} /> : "—"}</div>
                </div>
                <div className="tile" style={{ animationDelay: ".08s" }}>
                  <div className="tile-top">
                    <div className="tile-label">Ø Match-Score</div>
                    <div className="tile-icon-chip blue">◈</div>
                  </div>
                  <div className="tile-value display">
                    {report || tourDemoMode ? <AnimatedNumber value={displayedAverageMatch} suffix="%" decimal /> : "—"}
                  </div>
                </div>
                <div className="tile" style={{ animationDelay: ".14s" }}>
                  <div className="tile-top">
                    <div className="tile-label">Qualifizierte Leads</div>
                    <div className="tile-icon-chip violet">✓</div>
                  </div>
                  <div className="tile-value display">{report || tourDemoMode ? <AnimatedNumber value={displayedQualified} /> : "—"}</div>
                </div>
                <div className="tile" style={{ animationDelay: ".20s" }}>
                  <div className="tile-top">
                    <div className="tile-label">Conversion</div>
                    <div className="tile-icon-chip amber">→</div>
                  </div>
                  <div className="tile-value display">
                    {report || tourDemoMode ? <AnimatedNumber value={displayedConversion} suffix="%" decimal /> : "—"}
                  </div>
                </div>
              </div>
              <div className="app-card" data-tour="report-skill-gaps">
                <div className="app-card-header">
                  <div>
                    <h2>Größte Skill-Gaps</h2>
                    <div className="sub">
                      Skills, die Nutzern in Tests am häufigsten fehlen (inkl. Abbrecher) — zeigt zugleich, welche Skills
                      am meisten nachgefragt sind: je häufiger ein Skill fehlt, desto mehr Bedarf besteht dafür.
                    </div>
                  </div>
                </div>
                <div className="app-card-body">
                  {displayedSkillGaps.length === 0 ? (
                    <div className="empty-state">
                      <span className="icon" aria-hidden="true">◪</span>
                      {notConnectedYet ? "Noch keine Daten — auf „Verbinden & laden“ klicken." : "Noch keine Skill-Gaps erfasst."}
                    </div>
                  ) : (
                    displayedSkillGaps.map((g, i) => (
                      <div className="course-bar-row" key={g.skill_name}>
                        <div className="course-rank">{i + 1}</div>
                        <div className="course-bar-label">{g.skill_name}</div>
                        <div className="course-bar-track">
                          <div className="course-bar-fill gap" style={{ width: `${g.percentage}%` }} />
                        </div>
                        <div className="course-bar-count wide">{g.percentage}%</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="app-card" data-tour="report-top-courses">
                <div className="app-card-header">
                  <div>
                    <h2>Top-Kurse</h2>
                    <div className="sub">Nach Empfehlungshäufigkeit über alle Leads</div>
                  </div>
                </div>
                <div className="app-card-body">
                  {displayedTopCourses.length === 0 ? (
                    <div className="empty-state">
                      <span className="icon" aria-hidden="true">▤</span>
                      {notConnectedYet ? "Noch keine Daten — auf „Verbinden & laden“ klicken." : "Noch keine Kursempfehlungen erfasst."}
                    </div>
                  ) : (
                    displayedTopCourses.map((c, i) => (
                      <div className="course-bar-row" key={c.course_id}>
                        <div className="course-rank">{i + 1}</div>
                        <div className="course-bar-label">{c.course_name}</div>
                        <div className="course-bar-track">
                          <div
                            className="course-bar-fill"
                            style={{ width: `${maxCourseLeads ? ((c.lead_count / maxCourseLeads) * 100).toFixed(0) : 0}%` }}
                          />
                        </div>
                        <div className="course-bar-count">{c.lead_count}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="app-card">
                <div className="app-card-header">
                  <div>
                    <h2>Meistgeklickte Kurse (diese Sitzung)</h2>
                    <div className="sub">Kurse, die in diesem Browser-Fenster in Leads oder im Kurskatalog angeklickt wurden</div>
                  </div>
                </div>
                <div className="app-card-body">
                  {clickEntries.length === 0 ? (
                    <div className="empty-state">
                      <span className="icon" aria-hidden="true">◈</span>
                      Noch keine Klicks in dieser Sitzung — klicke auf eine Kurskarte in „Leads" oder „Kurse".
                    </div>
                  ) : (
                    clickEntries.map(([name, count], i) => (
                      <div className="course-bar-row" key={name}>
                        <div className="course-rank">{i + 1}</div>
                        <div className="course-bar-label">{name}</div>
                        <div className="course-bar-track">
                          <div
                            className="course-bar-fill"
                            style={{ width: `${maxClicks ? ((count / maxClicks) * 100).toFixed(0) : 0}%` }}
                          />
                        </div>
                        <div className="course-bar-count">{count}</div>
                      </div>
                    ))
                  )}
                  <div className="info-note">
                    Nur lokal für diese Sitzung erfasst (verschwindet beim Neuladen der Seite), nicht tenant-übergreifend
                    ausgewertet. Für eine dauerhafte, geräteübergreifende Klick-Analyse braucht es ein Klick-Event im
                    Backend, analog zum bestehenden Test-Tracking (<code>orbit_tests</code>) — siehe Analyse-Notiz im
                    Projekt.
                  </div>
                </div>
              </div>
              <div className="info-note">
                CPA / Akquisekosten stehen hier bewusst nicht — dafür braucht es echte Marketing-Kostendaten (z.B. aus einem
                Ad-Konto), die die API selbst nicht kennt. „Conversion" bezeichnet hier den Anteil der Leads, die nach dem
                empfohlenen Kurs den Qualifizierungs-Schwellenwert erreichen würden.
              </div>
            </div>
          )}
          <footer className="dashboard-footer">
            DYD – Decide Your Dream · ORBIT Lead Intelligence · zeigt ausschließlich Daten deiner eigenen API
          </footer>
        </div>
      </main>
      {/* ---------- Lead-Detailansicht (Version 23) ----------
         Klick auf einen Lead-Namen in der Liste öffnet dieses Overlay mit
         ALLEN Infos zu einem Lead plus den drei neuen Aktionen: Bearbeiter
         zuweisen, Beratungsgespräch manuell anlegen (auch ohne eigene
         Anfrage der Person) und Kurse aus dem eigenen Katalog manuell
         verlinken. Als IIFE statt eigener Komponente, damit alle Handler/
         States der Seite (courses, leads, handleToggleBooked, ...) einfach
         per Closure verfügbar sind, statt sie alle als Props durchzureichen. */}
      {selectedLeadId &&
        (() => {
          const l = leads.find((x) => x.lead_id === selectedLeadId);
          if (!l) return null;
          const linkedIds = l.linked_course_ids ?? [];
          const linkedCourses = courses.filter((c) => linkedIds.includes(c.course_id));
          const filteredCourses = courses.filter((c) => {
            const q = courseLinkQuery.trim().toLowerCase();
            if (!q) return true;
            if (linkedIds.includes(c.course_id)) return true;
            return c.course_name.toLowerCase().includes(q) || c.provider.toLowerCase().includes(q);
          });
          const assignedSuggestions = Array.from(
            new Set(leads.map((x) => x.assigned_to).filter((v): v is string => Boolean(v && v.trim())))
          );
          return (
            <div className="lead-modal-overlay" onClick={() => setSelectedLeadId(null)}>
              <div
                className="lead-modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={`Details zu ${l.lead_name || l.lead_id}`}
              >
                <button className="lead-modal-close" onClick={() => setSelectedLeadId(null)} aria-label="Schließen">
                  ×
                </button>
                <div className="lead-modal-header">
                  <div className="avatar avatar-lg">{initials(l.lead_name || l.lead_id)}</div>
                  <div className="lead-modal-header-info">
                    <div className="lead-modal-name">{l.lead_name || l.lead_id}</div>
                    <div className="lead-role">
                      → {l.target_role_name}
                      {l.contact_email ? ` · ${l.contact_email}` : ""}
                      {l.contact_phone ? ` · ${l.contact_phone}` : ""}
                    </div>
                  </div>
                  <div className={`match-badge ${l.qualified ? "qualified" : "pending"}`}>
                    <span className="bdot" />
                    {l.qualified ? "Qualifiziert" : "Noch nicht qualifiziert"}
                  </div>
                </div>

                {(formatLeadDate(l.created_at) ||
                  (l.desired_start && DESIRED_START_LABELS[l.desired_start]) ||
                  (l.employment_type && EMPLOYMENT_TYPE_LABELS[l.employment_type]) ||
                  (l.work_location && WORK_LOCATION_LABELS[l.work_location]) ||
                  (l.funding_preference && FUNDING_PREFERENCE_LABELS[l.funding_preference])) && (
                  <div className="lead-meta-row">
                    {formatLeadDate(l.created_at) && (
                      <span className="lead-meta-item" title="Eingegangen am">
                        📅 {formatLeadDate(l.created_at)}
                      </span>
                    )}
                    {l.desired_start && DESIRED_START_LABELS[l.desired_start] && (
                      <span className="lead-meta-item" title="Gewünschter Startzeitpunkt">
                        🚀 {DESIRED_START_LABELS[l.desired_start]}
                      </span>
                    )}
                    {l.employment_type && EMPLOYMENT_TYPE_LABELS[l.employment_type] && (
                      <span className="lead-meta-item" title="Beschäftigungsart">
                        💼 {EMPLOYMENT_TYPE_LABELS[l.employment_type]}
                      </span>
                    )}
                    {l.work_location && WORK_LOCATION_LABELS[l.work_location] && (
                      <span className="lead-meta-item" title="Gewünschter Arbeitsort">
                        📍 {WORK_LOCATION_LABELS[l.work_location]}
                      </span>
                    )}
                    {l.funding_preference && FUNDING_PREFERENCE_LABELS[l.funding_preference] && (
                      <span className="lead-meta-item" title="Förderungs-Präferenz">
                        🎓 {FUNDING_PREFERENCE_LABELS[l.funding_preference]}
                      </span>
                    )}
                  </div>
                )}

                <div className="match-bar-block">
                  <div className="match-bar-labels">
                    <span>
                      Aktueller Match: <b>{l.current_match_percentage}%</b>
                    </span>
                    <span>
                      Projiziert nach Kurs: <b>{l.projected_match_percentage}%</b>
                    </span>
                  </div>
                  <div className="match-bar-track">
                    <div className="match-bar-projected" style={{ width: `${l.projected_match_percentage}%` }} />
                    <div className="match-bar-current" style={{ width: `${l.current_match_percentage}%` }} />
                  </div>
                </div>

                {(l.matched_skills.length > 0 || l.gap_skills.length > 0) && (
                  <div className="skill-block">
                    <div className="chip-row">
                      {l.matched_skills.map((s) => (
                        <span className="chip" key={s}>
                          {s}
                        </span>
                      ))}
                      {l.gap_skills.map((s) => (
                        <span className="chip gap" key={s}>
                          Gap: {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {l.recommended_course && (
                  <div
                    className="course-row"
                    role="button"
                    tabIndex={0}
                    style={{ cursor: "pointer" }}
                    onClick={() => trackCourseClick(l.recommended_course?.course_name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        trackCourseClick(l.recommended_course?.course_name);
                      }
                    }}
                    aria-label={`Kursempfehlung ansehen: ${l.recommended_course.course_name}`}
                  >
                    <div className="course-row-left">
                      <div className="course-icon">📘</div>
                      <div>
                        <div className="course-name">{l.recommended_course.course_name}</div>
                        <div className="course-sub">automatisch empfohlen · {l.recommended_course.provider}</div>
                      </div>
                    </div>
                    <div className="course-score">{l.recommended_course.covers_gap_percentage}%</div>
                  </div>
                )}

                <div className="lead-modal-section">
                  <div className="lead-modal-section-title">Bearbeiter</div>
                  <input
                    className="assign-input"
                    type="text"
                    list="assigned-to-suggestions"
                    placeholder="Name/Kürzel eintragen, z.B. M. Schmidt"
                    defaultValue={l.assigned_to ?? ""}
                    disabled={tourDemoMode || assignBusyId === l.lead_id}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (!tourDemoMode && v !== (l.assigned_to ?? "")) void handleSetAssignedTo(l, v || null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                  <datalist id="assigned-to-suggestions">
                    {assignedSuggestions.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>

                <div className="lead-modal-section">
                  <div className="lead-modal-section-title">Beratungsgespräch</div>
                  {!l.consultation_requested ? (
                    <button
                      type="button"
                      className="btn-secondary-small"
                      disabled={tourDemoMode || enableConsultationBusyId === l.lead_id}
                      onClick={() => {
                        if (!tourDemoMode) void handleEnableConsultation(l);
                      }}
                    >
                      {enableConsultationBusyId === l.lead_id ? "…" : "🗣️ Beratungsgespräch anlegen"}
                    </button>
                  ) : (
                    <div className={`consultation-field ${l.consultation_completed ? "done" : ""}`}>
                      <div className="consultation-field-stages">
                        <div className="consultation-field-stage">
                          <label className="consultation-field-toggle">
                            <input
                              type="checkbox"
                              checked={Boolean(l.consultation_scheduled_for)}
                              disabled={tourDemoMode || consultationScheduleBusyId === l.lead_id}
                              onChange={(e) => {
                                if (tourDemoMode) return;
                                void handleSetConsultationScheduled(l, e.target.checked ? todayIso() : null);
                              }}
                            />
                            {consultationScheduleBusyId === l.lead_id ? "…" : "Vereinbart"}
                          </label>
                          {l.consultation_scheduled_for && (
                            <input
                              type="date"
                              className="consultation-date-input"
                              value={l.consultation_scheduled_for}
                              disabled={tourDemoMode || consultationScheduleBusyId === l.lead_id}
                              onChange={(e) => {
                                if (!tourDemoMode && e.target.value) void handleSetConsultationScheduled(l, e.target.value);
                              }}
                            />
                          )}
                        </div>
                        <div className="consultation-field-stage">
                          <label className="consultation-field-toggle">
                            <input
                              type="checkbox"
                              checked={Boolean(l.consultation_completed)}
                              disabled={tourDemoMode || consultationBusyId === l.lead_id}
                              onChange={() => {
                                if (!tourDemoMode) void handleToggleConsultationCompleted(l);
                              }}
                            />
                            {consultationBusyId === l.lead_id ? "…" : "Durchgeführt"}
                          </label>
                          {l.consultation_completed && formatLeadDate(l.consultation_completed_at) && (
                            <span className="consultation-field-sub">am {formatLeadDate(l.consultation_completed_at)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="lead-modal-section">
                  <div className="lead-modal-section-title">Kurse manuell verlinken</div>
                  {linkedCourses.length > 0 && (
                    <div className="linked-course-chips">
                      {linkedCourses.map((c) => (
                        <span className="linked-course-chip" key={c.course_id}>
                          {c.course_name}
                          <button
                            type="button"
                            onClick={() => {
                              if (!tourDemoMode) void handleToggleLinkedCourse(l, c.course_id);
                            }}
                            disabled={tourDemoMode || linkedCoursesBusyId === l.lead_id}
                            aria-label={`${c.course_name} entfernen`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {courses.length === 0 ? (
                    <div className="hint">Noch keine Kurse im Katalog.</div>
                  ) : (
                    <>
                      {courses.length > 6 && (
                        <input
                          className="role-filter-input"
                          type="text"
                          placeholder="Kurs suchen…"
                          value={courseLinkQuery}
                          onChange={(e) => setCourseLinkQuery(e.target.value)}
                        />
                      )}
                      <div className="skill-picker-list">
                        {filteredCourses.map((c) => {
                          const checked = linkedIds.includes(c.course_id);
                          return (
                            <label key={c.course_id} className={`skill-picker-item ${checked ? "checked" : ""}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={tourDemoMode || linkedCoursesBusyId === l.lead_id}
                                onChange={() => {
                                  if (!tourDemoMode) void handleToggleLinkedCourse(l, c.course_id);
                                }}
                              />
                              {c.course_name}
                              <span className="hint" style={{ marginLeft: 4 }}>
                                · {c.provider}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

                <button
                  className={`booked-toggle wide ${l.booked ? "booked" : ""}`}
                  onClick={() => {
                    if (!tourDemoMode) void handleToggleBooked(l);
                  }}
                  disabled={tourDemoMode || bookingBusyId === l.lead_id}
                  title="Manuell markieren, sobald die Buchung im eigenen System des Bildungsträgers erfolgt ist"
                >
                  {bookingBusyId === l.lead_id ? "…" : l.booked ? "✓ Gebucht" : "Als gebucht markieren"}
                </button>

                {/* DSGVO-Bereich (Version 28): zeigt den tatsächlich
                    gespeicherten Einwilligungs-Nachweis (Art. 7 Abs. 1 DSGVO)
                    an und bietet das Recht auf Löschung (Art. 17 DSGVO) —
                    beide Felder/Endpunkte fehlen in der Antwort, solange das
                    Backend consent_given_at bzw. den DELETE-Endpunkt noch
                    nicht kennt (additiv wie alle anderen neuen Felder in
                    diesem Projekt). */}
                <div className="lead-modal-section">
                  <div className="lead-modal-section-title">Datenschutz</div>
                  <div className="hint" style={{ marginBottom: "8px" }}>
                    {l.consent_given_at
                      ? `✓ Einwilligung zur Speicherung erteilt am ${formatLeadDate(l.consent_given_at) ?? l.consent_given_at}${
                          l.consent_text_version ? ` (Textversion „${l.consent_text_version}“)` : ""
                        }.`
                      : "Kein Einwilligungs-Zeitstempel hinterlegt — entweder ein älterer Lead (vor Version 28) oder das Backend kennt consent_given_at noch nicht."}
                    {l.cv_processing_consent_at && (
                      <>
                        {" "}
                        Zusätzlich der KI-Analyse zugestimmt am{" "}
                        {formatLeadDate(l.cv_processing_consent_at) ?? l.cv_processing_consent_at}.
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    className="danger-link-btn"
                    onClick={() => void handleDeleteLead(l)}
                    disabled={deleteBusyId === l.lead_id}
                    title="Löscht diesen Lead unwiderruflich (Recht auf Löschung, Art. 17 DSGVO)"
                  >
                    {deleteBusyId === l.lead_id ? "Wird gelöscht…" : "🗑️ Lead endgültig löschen"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}