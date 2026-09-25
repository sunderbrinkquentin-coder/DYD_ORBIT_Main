/**
 * Journey v2 – Beratungs-Bausteine (25.09.2026).
 *
 * Ziel: das Ergebnis soll sich anfuehlen wie die ersten Minuten einer guten
 * Weiterbildungsberatung, ohne den Prozess zu verlaengern. Dieses Modul
 * erzeugt dafuer kurze, konkrete Texte:
 *  - Foerderweg mit naechsten Schritten je Situation (fundingPlan),
 *  - eine Zeile zu dem, was der Person am wichtigsten ist (priorityLine),
 *  - Hinweise zu moeglichen Huerden (hurdleNotes),
 *  - Zulassung/Voraussetzungen (prerequisiteLine),
 *  - eine Notiz fuer die Beraterin beim Bildungstraeger (adviceNoteForLead),
 *  - den persoenlichen Plan nach der Anfrage (personalPlanSteps).
 *
 * Regeln: Jede Aussage ueber einen Kurs stuetzt sich auf ein gepflegtes
 * Kursfeld. Foerder-Texte beschreiben den ueblichen Weg und die
 * zustaendige Stelle, versprechen aber nie eine Bewilligung (die
 * Entscheidung liegt bei Agentur, Jobcenter oder Amt). Keine Betraege,
 * keine Gehaltsangaben.
 *
 * Quellen fuer die Foerderwege (Stand 09/2026):
 *  - Bildungsgutschein: https://www.arbeitsagentur.de/karriere-und-weiterbildung/bildungsgutschein
 *  - Weiterbildung Beschaeftigter (Qualifizierungschancengesetz):
 *    https://www.arbeitsagentur.de/unternehmen/finanziell/foerderung-von-weiterbildung
 *  - Aufstiegs-BAfoeG: https://www.aufstiegs-bafoeg.de
 */

import { checkPrerequisites, QUALIFICATION_LABELS } from "./courseMatcher";
import type { Situation } from "./coursePitch";

/** Was ist der Person am wichtigsten? (Bildschirm 5, ein Tipp, optional) */
export type V2Priority = "abschluss" | "flexibel" | "schnell" | "aufstieg" | "neues";
/** Was koennte schwierig werden? (Bildschirm 5, Mehrfachauswahl, optional) */
export type V2Hurdle = "zeit" | "kosten" | "lernen" | "deutsch";

export const V2_PRIORITY_OPTIONS: { key: V2Priority; label: string }[] = [
  { key: "abschluss", label: "Anerkannter Abschluss" },
  { key: "aufstieg", label: "Beruflich aufsteigen" },
  { key: "flexibel", label: "Flexibel lernen" },
  { key: "schnell", label: "Schnell starten" },
  { key: "neues", label: "Etwas Neues, das mir Spaß macht" },
];

export const V2_HURDLE_OPTIONS: { key: V2Hurdle; label: string }[] = [
  { key: "zeit", label: "Zeit neben Job oder Familie" },
  { key: "kosten", label: "Die Kosten" },
  { key: "lernen", label: "Lange nicht mehr gelernt" },
  { key: "deutsch", label: "Deutsch als Fremdsprache" },
];

export interface AdviceCourse {
  course_name: string;
  provider?: string | null;
  duration_weeks?: number | null;
  starts_at?: string | null;
  employment_mode?: string | null;
  location_mode?: string | null;
  funding_types?: string[] | null;
  funding_measure_number?: string | null;
  qualification_type?: string | null;
  dqr_level?: number | null;
  min_qualification_level?: string | null;
  min_experience_years?: number | null;
  required_language_level?: string | null;
}

export interface FundingPlan {
  title: string;
  steps: string[];
  link: { label: string; url: string } | null;
}

const LINK_BILDUNGSGUTSCHEIN = { label: "Infos der Agentur für Arbeit", url: "https://www.arbeitsagentur.de/karriere-und-weiterbildung/bildungsgutschein" };
const LINK_BESCHAEFTIGTE = { label: "Infos der Agentur für Arbeit", url: "https://www.arbeitsagentur.de/unternehmen/finanziell/foerderung-von-weiterbildung" };
const LINK_AFBG = { label: "aufstiegs-bafoeg.de", url: "https://www.aufstiegs-bafoeg.de" };

function measure(course: AdviceCourse): string {
  return course.funding_measure_number?.trim() ? ` (Maßnahme-Nr. ${course.funding_measure_number.trim()})` : "";
}

/**
 * Der passende Foerderweg fuer DIESEN Kurs und DIESE Situation, als
 * konkrete Schritte. null, wenn am Kurs keine Foerderung gepflegt ist oder
 * keine davon zur Situation passt.
 */
export function fundingPlan(course: AdviceCourse, situation: Situation | null): FundingPlan | null {
  const types = new Set(course.funding_types ?? []);
  if (types.size === 0) return null;
  const hasBgs = types.has("bildungsgutschein");

  if (hasBgs && situation === "arbeitsuchend") {
    return {
      title: "So kommst du an deinen Bildungsgutschein",
      steps: [
        "Termin bei deiner Arbeitsvermittlung vereinbaren – bei der Agentur für Arbeit oder beim Jobcenter.",
        `Diesen Kurs ins Gespräch mitnehmen${measure(course)}.`,
        "Erklären, warum dich der Kurs in Arbeit bringt. Die Entscheidung trifft die Agentur bzw. das Jobcenter im Einzelfall.",
        "Den Bildungsgutschein beim Bildungsträger einlösen – er hilft dir dabei.",
      ],
      link: LINK_BILDUNGSGUTSCHEIN,
    };
  }
  if (hasBgs && situation === "transfer") {
    return {
      title: "Förderung über die Transfergesellschaft",
      steps: [
        "Deine Ansprechperson in der Transfergesellschaft auf diesen Kurs ansprechen.",
        `Kursname und Anbieter mitnehmen${measure(course)} – Weiterbildungen können dort über die Agentur für Arbeit gefördert werden.`,
        "Der Bildungsträger stimmt die Details mit dir und der Transfergesellschaft ab.",
      ],
      link: LINK_BILDUNGSGUTSCHEIN,
    };
  }
  if (types.has("aufstiegs_bafoeg") && situation !== "arbeitsuchend") {
    return {
      title: "Förderung mit Aufstiegs-BAföG",
      steps: [
        "Für Aufstiegsfortbildungen gibt es einen Zuschuss zu Lehrgangs- und Prüfungskosten – unabhängig von deinem Einkommen – plus ein günstiges Darlehen.",
        "Den Antrag beim zuständigen Amt deines Bundeslands stellen, am besten vor Kursbeginn.",
        "Der Bildungsträger bestätigt dir die Teilnahme für den Antrag.",
      ],
      link: LINK_AFBG,
    };
  }
  if (hasBgs && situation === "beschaeftigt") {
    return {
      title: "Förderung über deinen Arbeitgeber",
      steps: [
        "Mit deinem Arbeitgeber sprechen: Für Beschäftigte kann die Agentur für Arbeit Weiterbildung gemeinsam mit dem Arbeitgeber fördern.",
        "Der Arbeitgeber-Service der Agentur prüft, ob und wie viel gefördert wird.",
        "Der Bildungsträger unterstützt euch bei den Unterlagen.",
      ],
      link: LINK_BESCHAEFTIGTE,
    };
  }
  if (types.has("bildungsurlaub") && situation === "beschaeftigt") {
    return {
      title: "Bildungsurlaub nutzen",
      steps: [
        "In den meisten Bundesländern hast du Anspruch auf bezahlte Freistellung für anerkannte Weiterbildungen.",
        "Beim Arbeitgeber rechtzeitig beantragen – meist einige Wochen vorher.",
        "Den Bildungsträger nach der Anerkennung in deinem Bundesland fragen.",
      ],
      link: null,
    };
  }
  if (types.has("laenderfoerderung")) {
    return {
      title: "Förderung deines Bundeslands",
      steps: ["Viele Bundesländer fördern Weiterbildung zusätzlich.", "Der Bildungsträger prüft mit dir, welches Programm passt."],
      link: null,
    };
  }
  if (hasBgs && situation === null) {
    return {
      title: "Förderfähig mit Bildungsgutschein",
      steps: [
        "Wenn du Arbeit suchst oder von Arbeitslosigkeit bedroht bist: Termin bei Agentur für Arbeit oder Jobcenter vereinbaren.",
        `Diesen Kurs mitnehmen${measure(course)}.`,
        "Der Bildungsträger hilft dir beim weiteren Ablauf.",
      ],
      link: LINK_BILDUNGSGUTSCHEIN,
    };
  }
  return null;
}

const QUALIFICATION_TYPE_TEXT: Record<string, string> = {
  ihk_pruefung: "einer IHK-Prüfung",
  lehrgangszertifikat: "einem Lehrgangszertifikat",
  seminarzertifikat: "einem Zertifikat",
  sonstiger_abschluss: "einem Abschluss",
};

function daysUntil(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - now.getTime()) / 86_400_000);
}

/**
 * Eine Zeile, die an das anknuepft, was der Person am wichtigsten ist —
 * nur, wenn der Kurs es nachweislich erfuellt. Sonst null (keine Floskel).
 */
export function priorityLine(
  course: AdviceCourse,
  priority: V2Priority | null,
  ctx: { nextRoleName?: string | null; now?: Date } = {},
): string | null {
  if (!priority) return null;
  const now = ctx.now ?? new Date();
  if (priority === "abschluss" && course.qualification_type && QUALIFICATION_TYPE_TEXT[course.qualification_type]) {
    const dqr = course.dqr_level ? ` (DQR-Niveau ${course.dqr_level})` : "";
    return `Dir ist ein anerkannter Abschluss wichtig – dieser Kurs endet mit ${QUALIFICATION_TYPE_TEXT[course.qualification_type]}${dqr}.`;
  }
  if (priority === "flexibel") {
    const parts: string[] = [];
    if (course.location_mode === "remote") parts.push("online");
    else if (course.location_mode === "hybrid") parts.push("online und vor Ort");
    if (course.employment_mode === "teilzeit" || course.employment_mode === "beides") parts.push("in Teilzeit");
    if (parts.length) return `Dir ist Flexibilität wichtig – der Kurs läuft ${parts.join(" und ")}.`;
    return null;
  }
  if (priority === "schnell") {
    const d = daysUntil(course.starts_at, now);
    if (d !== null && d >= 0 && d <= 45) return `Du willst schnell starten – der nächste Termin ist schon in ${d <= 14 ? "gut zwei Wochen" : `etwa ${Math.max(3, Math.round(d / 7))} Wochen`}.`;
    if (course.duration_weeks && course.duration_weeks <= 8) return `Du willst schnell vorankommen – der Kurs dauert nur ${course.duration_weeks} Woche${course.duration_weeks === 1 ? "" : "n"}.`;
    return null;
  }
  if (priority === "aufstieg" && ctx.nextRoleName) {
    return `Dir ist Aufstieg wichtig – danach ist ${ctx.nextRoleName} möglich.`;
  }
  return null;
}

export interface HurdleNote {
  hurdle: V2Hurdle;
  text: string;
}

/** Ehrliche, kurze Antworten auf die angegebenen Huerden — bezogen auf DIESEN Kurs. */
export function hurdleNotes(course: AdviceCourse, hurdles: ReadonlySet<V2Hurdle>, hasFundingPlan: boolean): HurdleNote[] {
  const out: HurdleNote[] = [];
  if (hurdles.has("zeit")) {
    const flex: string[] = [];
    if (course.employment_mode === "teilzeit" || course.employment_mode === "beides") flex.push("in Teilzeit");
    if (course.location_mode === "remote") flex.push("online");
    else if (course.location_mode === "hybrid") flex.push("teilweise online");
    out.push({
      hurdle: "zeit",
      text: flex.length
        ? `Zeit: Der Kurs ist ${flex.join(" und ")} machbar.`
        : course.employment_mode === "vollzeit"
          ? "Zeit: Der Kurs läuft in Vollzeit – frag nach Teilzeit- oder Abendvarianten."
          : "Zeit: Frag im Gespräch nach Zeiten und Teilzeit-Möglichkeiten.",
    });
  }
  if (hurdles.has("kosten")) {
    out.push({
      hurdle: "kosten",
      text: hasFundingPlan
        ? "Kosten: Für diesen Kurs gibt es einen Förderweg (siehe unten) – er kann die Kosten ganz oder teilweise übernehmen."
        : "Kosten: Frag nach Förderung oder Ratenzahlung – der Bildungsträger kennt die Möglichkeiten.",
    });
  }
  if (hurdles.has("lernen")) {
    out.push({ hurdle: "lernen", text: "Lernen: Nach Jahren wieder einsteigen geht vielen so – sprich es im Gespräch an und frag nach Lernunterstützung." });
  }
  if (hurdles.has("deutsch")) {
    out.push({
      hurdle: "deutsch",
      text: course.required_language_level
        ? `Deutsch: Für den Kurs wird Niveau ${course.required_language_level} erwartet – frag nach sprachlicher Unterstützung.`
        : "Deutsch: Frag nach sprachlicher Unterstützung im Kurs.",
    });
  }
  return out;
}

/** Zulassung/Voraussetzungen — nur wenn am Kurs gepflegt. */
export function prerequisiteLine(
  course: AdviceCourse,
  person: { qualificationLevel?: string | null },
): { ok: boolean | null; text: string } | null {
  const lines: { ok: boolean | null; text: string }[] = [];
  if (course.min_qualification_level) {
    const res = checkPrerequisites({ min_qualification_level: course.min_qualification_level }, { qualificationLevel: person.qualificationLevel });
    const need = QUALIFICATION_LABELS[course.min_qualification_level] ?? course.min_qualification_level;
    if (res.status === "erfuellt") lines.push({ ok: true, text: `Zulassung: Du bringst die geforderte ${need} mit.` });
    else if (res.status === "nicht_erfuellt")
      lines.push({ ok: false, text: `Zulassung: Vorausgesetzt wird eine ${need}. Frag nach anderen Zulassungswegen, z. B. über Berufserfahrung.` });
    else lines.push({ ok: null, text: `Voraussetzung: ${need}.` });
  }
  if (course.min_experience_years) {
    lines.push({ ok: null, text: `Voraussetzung: mindestens ${course.min_experience_years} Jahre Berufserfahrung.` });
  }
  if (lines.length === 0) return null;
  const ok = lines.some((l) => l.ok === false) ? false : lines.every((l) => l.ok === true) ? true : null;
  return { ok, text: lines.map((l) => l.text).join(" ") };
}

const PRIORITY_LABEL = new Map(V2_PRIORITY_OPTIONS.map((o) => [o.key, o.label]));
const HURDLE_LABEL = new Map(V2_HURDLE_OPTIONS.map((o) => [o.key, o.label]));
const SITUATION_LABEL: Record<Situation, string> = {
  beschaeftigt: "beschäftigt",
  arbeitsuchend: "arbeitsuchend",
  transfer: "in einer Transfergesellschaft",
  ausbildung: "in Ausbildung/Studium",
};

/** Kurze Notiz fuer die Beraterin beim Bildungstraeger (landet im Lead). */
export function adviceNoteForLead(p: { priority: V2Priority | null; hurdles: ReadonlySet<V2Hurdle>; situation: Situation | null; activityLabels: string[] }): string | null {
  const parts: string[] = [];
  if (p.situation) parts.push(`Situation: ${SITUATION_LABEL[p.situation]}`);
  if (p.priority) parts.push(`Wichtig: ${PRIORITY_LABEL.get(p.priority)}`);
  if (p.hurdles.size) parts.push(`Mögliche Hürden: ${[...p.hurdles].map((h) => HURDLE_LABEL.get(h)).join(", ")}`);
  if (p.activityLabels.length) parts.push(`Erfahrung: ${p.activityLabels.slice(0, 6).join("; ")}`);
  return parts.length ? `[Journey] ${parts.join(" · ")}` : null;
}

/** Die naechsten Schritte fuer den persoenlichen Plan nach der Anfrage. */
export function personalPlanSteps(p: { consultation: boolean; funding: FundingPlan | null; hurdles: ReadonlySet<V2Hurdle> }): string[] {
  const steps = [
    p.consultation
      ? "Der Bildungsträger meldet sich für dein kostenloses Beratungsgespräch – meist innerhalb von 1–2 Werktagen."
      : "Der Bildungsträger meldet sich mit Details, Terminen und Förderung – meist innerhalb von 1–2 Werktagen.",
  ];
  if (p.funding) steps.push(`Förderung klären: die Schritte unter „${p.funding.title}“ der Reihe nach angehen.`);
  steps.push("Unterlagen bereitlegen: Lebenslauf und Zeugnisse (auch Arbeitszeugnisse).");
  if (p.hurdles.size) steps.push("Deine Fragen zu Zeit, Kosten oder Lernen im Gespräch direkt ansprechen – sie sind schon vermerkt.");
  return steps;
}