import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Gefuehrter Rundgang durch die Endnutzer-Journey — fuer Demos/Praesentationen
 * gedacht (z.B. vor Bildungstraeger-Kunden), nicht fuer echte Endnutzer:
 * wird deshalb in JourneyPage.tsx genauso wie das Einstellungs-Zahnrad nur
 * gezeigt, wenn `showConnectionPanel` an ist (Dev-/Demo-Modus).
 *
 * Bewusst nach demselben Muster wie DashboardTour.tsx gebaut (siehe
 * Kommentar dort): ein "Spotlight"-Overlay hebt jeweils einen echten
 * DOM-Bereich hervor (per data-tour="..."-Attribut markiert), daneben
 * erscheint eine Karte mit kurzer Erklaerung. Wechselt bei Bedarf selbst
 * den Journey-Schritt ueber onNavigate.
 *
 * Unterschied zu DashboardTour: die Journey ist ein linearer Assistent statt
 * frei waehlbarer Tabs, und zwei Schritte (Skill-Gap, Kursempfehlung) zeigen
 * echte, zuvor berechnete Ergebnisse. Fehlen sie noch, holt runDemoAnalysis
 * (siehe JourneyPage.tsx) sie beim Start automatisch nach - keine erfundenen
 * Beispieldaten, sondern ein echter, live berechneter Abgleich (passend zum
 * Projekt-Prinzip "keine erfundenen Zahlen/Fakten", siehe Kommentar bei
 * skillImportance in JourneyPage.tsx).
 *
 * Die Erklaer-Karte "dockt" bewusst IMMER an derselben festen Stelle
 * (unten mittig, siehe .tour-card-dock) statt neben dem jeweils
 * hervorgehobenen Element zu schweben: bei einem hohen Ziel (z.B. der
 * Zielrollen-Liste mit vielen Karten) konnte die alte, dynamische
 * Positionierung die Karte samt "Weiter"-Button ausserhalb des sichtbaren
 * Bereichs platzieren - bei einer `position: fixed`-Karte hilft dagegen
 * KEIN Scrollen (fixed-Elemente bewegen sich nicht mit), sie war schlicht
 * nicht erreichbar. Die feste Docking-Position macht "Weiter"/"Zurück"
 * unabhaengig von der Groesse des jeweiligen Schritts immer erreichbar.
 * Das Spotlight (Hervorhebung des Elements selbst) bleibt davon unberuehrt.
 */

export type JourneyStepKey =
  | "ziel"
  | "praeferenzen"
  | "bereich"
  | "zielrolle"
  | "skills"
  | "gap"
  | "kurs"
  | "lead";

interface RawStep {
  /** Journey-Schritt, zu dem vor diesem Tour-Schritt navigiert wird - oder
   *  null fuer einen zentrierten Schritt ohne Navigation (Intro/Abschluss). */
  key: JourneyStepKey | null;
  /** Nur relevant, wenn key gesetzt ist: dieser Tour-Schritt wird
   *  uebersprungen, wenn der Schluessel nicht in availableKeys vorkommt
   *  (z.B. "bereich" im "kennt Zielrolle bereits"-Pfad) oder eine der
   *  optionalen requires-Bedingungen nicht erfuellt ist. */
  requires?: "gapResult" | "courseResult";
  selector: string | null;
  title: string;
  description: string;
}

const RAW_STEPS: RawStep[] = [
  {
    key: null,
    selector: null,
    title: "Rundgang durch die Journey",
    description:
      "Ein kurzer, gefuehrter Durchlauf durch den Weiterbildungs-Finder aus Sicht des Endnutzers — gut geeignet, um das Widget in einer Demo zu erklaeren. Mit „Beenden“ jederzeit aussteigen.",
  },
  {
    key: "ziel",
    selector: '[data-tour="tour-stepper"]',
    title: "Fortschrittsanzeige",
    description:
      "Zeigt dem Nutzer jederzeit, wo er in der Journey steht und wie viele Schritte noch kommen — hier startet die eigentliche Befragung.",
  },
  {
    key: "ziel",
    selector: '[data-tour="tour-panel"]',
    title: "Motivations-Frage",
    description:
      "Bevor es technisch wird, fragen wir nach dem persoenlichen „Warum“. Rein qualifizierend — beeinflusst spaeter Formulierungen, nicht das Matching selbst.",
  },
  {
    key: "praeferenzen",
    selector: '[data-tour="tour-panel"]',
    title: "Rahmenbedingungen",
    description:
      "Beschäftigungsart, gewünschter Arbeitsort (Remote/Vor Ort), grober Startzeitpunkt und ob eine Förderung (z.B. Bildungsgutschein) wichtig ist — vier kurze, jederzeit mit „Egal“ überspringbare Fragen. Beeinflusst NIE, ob ein Kurs überhaupt vorgeschlagen wird, nur die Reihenfolge unter fachlich gleichwertigen Treffern (siehe „Passende Weiterbildung“ weiter unten) — und wird dem Bildungsträger direkt an jedem Lead im Dashboard angezeigt.",
  },
  {
    key: "bereich",
    selector: '[data-tour="tour-panel"]',
    title: "Passende Rolle vorschlagen (optionaler Pfad)",
    description:
      "Wer die eigene Zielrolle noch nicht kennt, klickt hier einfach an, was er/sie schon kann oder gerne macht — kein Text nötig. Daraus errechnen wir echte, prozentuale Rollen-Vorschläge statt nur eine Branche raten zu lassen. Eine konkrete Rolle muss dabei nicht aktiv angeklickt werden: ein einfaches „Weiter“ wählt automatisch die am besten passende. Die angeklickten Skills sind im Fragebogen-Schritt danach schon vorausgewählt.",
  },
  {
    key: "zielrolle",
    selector: '[data-tour="tour-panel"]',
    title: "Zielrolle waehlen",
    description:
      "Freitextsuche plus Karten-Auswahl. Diese Rolle ist ab hier der Bezugspunkt fuer den kompletten restlichen Abgleich.",
  },
  {
    key: "skills",
    selector: '[data-tour="tour-panel"]',
    title: "Lebenslauf oder Fragebogen",
    description:
      "Zwei Wege zum selben Ergebnis: Lebenslauf hochladen (inkl. OCR-Fallback fuer eingescannte PDFs) oder die Kern-Skills der Zielrolle per Checkbox angeben. Die DSGVO-Einwilligung ist beim Upload Pflicht.",
  },
  {
    key: "gap",
    requires: "gapResult",
    selector: '[data-tour="tour-panel"]',
    title: "Skill-Gap-Ergebnis",
    description:
      "Match-Prozentsatz sowie bereits vorhandene und noch fehlende Kern-Skills fuer die Zielrolle — jeder Skill mit einer echten Begruendung statt einer abstrakten Prozentzahl: ein woertliches Zitat aus dem Lebenslauf (per Ueberschriften-Erkennung sogar mit Abschnitt wie „Berufserfahrung“ oder „Ausbildung“), oder sobald verfuegbar die Einschaetzung der KI-Tiefenanalyse. Zusaetzlich waehlbar: das eigene Erfahrungslevel je Skill (Grundkenntnisse/Fortgeschritten/Experte, mit KI-Vorschlag vorbelegt) sowie eine manuelle Korrektur („✕ Entfernen“/„+ Als vorhanden markieren“) — geht ein Skill falsch in die eine oder andere Richtung, kann die Person das selbst richtigstellen, das wirkt sich direkt auf Match-Prozent UND die folgende Kursempfehlung aus.",
  },
  {
    key: "kurs",
    requires: "courseResult",
    selector: '[data-tour="tour-panel"]',
    title: "Passende Weiterbildung",
    description:
      "Individuelle Kursempfehlung primaer nach gewichteter Abdeckung der eigenen Skill-Luecke sortiert, die weiter oben genannten Rahmenbedingungen entscheiden nur bei fachlich gleichwertigen Treffern die Reihenfolge — nie die Sichtbarkeit. Jede Karte zeigt zusaetzlich Preis (inkl. USt.-Hinweis/Pruefungsgebuehr), Unterrichtseinheiten, Abschlussart und einen „Foerderfaehig“-Hinweis, falls vom Bildungstraeger gepflegt, sowie individuell begruendet, WARUM genau dieser Kurs passt (konkrete Skill-Namen, keine allgemeine Floskel). Einzelne Kurskacheln koennen ausserdem Banner wie „Startet in Kuerze“ oder „Nur noch wenige Plaetze“ zeigen — direkt vom Bildungstraeger im Dashboard aus echten Werten gesetzt, nie erfunden. Der Nutzer waehlt hier aktiv einen konkreten Kurs, „Match danach“ zeigt ehrlich, wie viel naeher genau dieser eine Kurs an die Zielrolle bringt.",
  },
  {
    key: "lead",
    selector: '[data-tour="tour-panel"]',
    title: "Kontaktaufnahme",
    description:
      "Letzter Schritt: nur noch Name, E-Mail (optional Telefon) und die DSGVO-Einwilligung — der qualifizierte Lead landet direkt im Bildungstraeger-Dashboard, inklusive Zielrolle, Match-Score, gewaehltem Kurs und den weiter oben angegebenen Rahmenbedingungen (Beschaeftigungsart, Arbeitsort, Wunschstart, Foerderung). Zwei klare Wege: direkt buchen oder erst beraten lassen — beides landet als Lead im Dashboard, nur mit unterschiedlichem Status. Die Einwilligung wird mit Zeitpunkt und Text-Version nachweisbar gespeichert, die Person kann ihre Daten jederzeit vom Bildungstraeger loeschen lassen (Recht auf Loeschung, Art. 17 DSGVO).",
  },
  {
    key: null,
    selector: null,
    title: "Das war der Rundgang",
    description:
      "Den Button „🧭 Rundgang starten“ findest du jederzeit wieder — praktisch direkt vor einer Praesentation. Er erscheint nur im Demo-/Entwicklungsmodus, nie fuer echte Endnutzer.",
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 10;
const CARD_WIDTH = 360;

interface JourneyTourProps {
  open: boolean;
  onClose: () => void;
  /** Schluessel des Journey-Schritts, der gerade aktiv ist (oder "intro",
   *  solange die Einstiegsfrage/knowsRole noch nicht beantwortet ist). */
  currentKey: JourneyStepKey | "intro";
  /** Schluessel, die im AKTUELL gueltigen Pfad ueberhaupt vorkommen (5 oder
   *  6 Schritte, je nachdem ob "bereich" dabei ist) - steuert, ob der
   *  "bereich"-Tour-Schritt angezeigt wird. */
  availableKeys: JourneyStepKey[];
  hasGapResult: boolean;
  hasCourseResult: boolean;
  /** Navigiert die Journey selbst zum gewuenschten Schritt (kuemmert sich in
   *  JourneyPage auch darum, aus der Einstiegsfrage herauszukommen, falls
   *  der Rundgang dort gestartet wurde). */
  onNavigate: (key: JourneyStepKey) => void;
  /** Loest bei Bedarf eine echte (nicht erfundene) Beispiel-Analyse aus,
   *  damit "Skill-Gap" und "Kurs" auch ohne vorherigen echten Durchlauf im
   *  Rundgang etwas zeigen - siehe runDemoAnalysis in JourneyPage.tsx. Wird
   *  nur aufgerufen, wenn hasGapResult/hasCourseResult beim Oeffnen noch
   *  false sind; ist schon ein echtes Ergebnis da, passiert nichts. */
  onEnsureDemoResults: () => void;
}

export function JourneyTour({
  open,
  onClose,
  currentKey,
  availableKeys,
  hasGapResult,
  hasCourseResult,
  onNavigate,
  onEnsureDemoResults,
}: JourneyTourProps) {
  const steps = useMemo(
    () =>
      RAW_STEPS.filter((s) => {
        if (s.key === null) return true;
        if (!availableKeys.includes(s.key)) return false;
        if (s.requires === "gapResult" && !hasGapResult) return false;
        if (s.requires === "courseResult" && !hasCourseResult) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availableKeys.join(","), hasGapResult, hasCourseResult],
  );
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const pulsedElRef = useRef<Element | null>(null);
  const demoTriggeredRef = useRef(false);

  const step = steps[Math.min(stepIdx, steps.length - 1)];
  const isLast = stepIdx >= steps.length - 1;
  const isFirst = stepIdx === 0;
  // Solange Skill-Gap- oder Kursergebnis noch fehlen, erst eine echte
  // Beispiel-Analyse anstossen (einmal pro Oeffnen) und in der Zwischenzeit
  // eine kurze Warteflaeche statt des eigentlichen Rundgangs zeigen - sonst
  // wuerden "gap"/"kurs" beim Start einfach lautlos aus der Tour fallen.
  const waitingForDemoResults = open && (!hasGapResult || !hasCourseResult);

  useEffect(() => {
    if (open) setStepIdx(0);
  }, [open]);

  /** Bugfix (14.09., "die Kachel von der Rundtour ist hinter den Infos, die
   *  muss irgendwo am Rand stehen, sodass man beides immer sieht"): die feste
   *  Docking-Position allein loest das Ausserhalb-des-Bildschirms-Problem
   *  (siehe Kopf-Kommentar), aber bei einem inhaltsreichen Schritt wie
   *  "Skill-Gap-Ergebnis" kann die (immer gleich grosse) Karte trotzdem Teile
   *  des ECHTEN, gerade hervorgehobenen Inhalts ueberdecken, wenn dieser
   *  hoeher ist als der Platz unten. Ab einer gewissen Fensterbreite (siehe
   *  Media Query bei .tour-card-dock in journey.css) dockt die Karte deshalb
   *  stattdessen seitlich am rechten Rand — und ".stage" bekommt hier per
   *  Body-Klasse echten zusaetzlichen Platz auf der rechten Seite (kein
   *  Ueberlappen, sondern eine echte Verschiebung des Widgets nach links),
   *  damit "man beides immer sieht" auch bei hohem Inhalt stimmt. Auf
   *  schmalen Bildschirmen (Media Query greift dort nicht) bleibt exakt das
   *  bisherige Verhalten (unten mittig) erhalten. */
  useEffect(() => {
    document.body.classList.toggle("journey-tour-open", open);
    return () => {
      document.body.classList.remove("journey-tour-open");
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      demoTriggeredRef.current = false;
      return;
    }
    if (!demoTriggeredRef.current && (!hasGapResult || !hasCourseResult)) {
      demoTriggeredRef.current = true;
      onEnsureDemoResults();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasGapResult, hasCourseResult]);

  // Journey zum passenden Schritt navigieren, falls der Tour-Schritt einen
  // anderen Schluessel braucht als gerade aktiv ist. Erst NACHDEM die
  // Beispiel-Analyse (falls noetig) fertig ist, sonst wuerde die Tour schon
  // lospatschen, waehrend im Hintergrund noch nachgeladen wird.
  useEffect(() => {
    if (!open || waitingForDemoResults || !step.key) return;
    if (step.key !== currentKey) onNavigate(step.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, waitingForDemoResults, stepIdx, step.key]);

  useEffect(() => {
    if (!open || waitingForDemoResults) return;
    if (step.key && step.key !== currentKey) return; // Navigation oben noch nicht angekommen

    if (pulsedElRef.current) {
      pulsedElRef.current.classList.remove("tour-pulse-target", "tour-highlight-active");
      pulsedElRef.current = null;
    }

    if (!step.selector) {
      setRect(null);
      return;
    }

    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(step.selector as string);
      if (!el) {
        setRect(null);
        return;
      }
      // "nearest" statt "center": bei einem hohen Ziel (z.B. der Zielrollen-
      // Liste mit vielen Karten) hat "center" versucht, dessen MITTE zu
      // zentrieren und dabei die Seite viel zu weit nach unten gescrollt -
      // "nearest" scrollt nur so weit wie noetig, um das Ziel sichtbar zu
      // machen, meist gar nicht, wenn es (teilweise) schon im Blick ist.
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      // Analog zu DashboardTour.tsx (siehe Kommentar dort): "tour-highlight-active"
      // haelt das Element DAUERHAFT ueber dem dunklen Overlay, solange dieser
      // Schritt aktiv ist; "tour-pulse-target" ist nur der kurze Bounce beim
      // Erscheinen und wird nach 550ms wieder entfernt, OHNE die Sichtbarkeit
      // zu beeintraechtigen. Vorher uebernahm "tour-pulse-target" beides, wurde
      // aber nach 550ms entfernt -> das Element fiel danach hinter das Overlay
      // zurueck und wirkte "dunkel", obwohl der Schritt noch lief.
      window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        el.classList.add("tour-highlight-active", "tour-pulse-target");
        pulsedElRef.current = el;
        window.setTimeout(() => el.classList.remove("tour-pulse-target"), 550);
      }, 260);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, waitingForDemoResults, stepIdx, step.key, step.selector, currentKey]);

  useEffect(() => {
    if (!open || !step.selector) return;
    function remeasure() {
      const el = document.querySelector(step.selector as string);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);
    return () => {
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
    };
  }, [open, step.selector]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setStepIdx((i) => Math.min(i + 1, steps.length - 1));
      else if (e.key === "ArrowLeft") setStepIdx((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, steps.length]);

  useEffect(() => {
    if (open) return;
    if (pulsedElRef.current) {
      pulsedElRef.current.classList.remove("tour-pulse-target", "tour-highlight-active");
      pulsedElRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  if (waitingForDemoResults) {
    return (
      <div className="tour-layer" role="dialog" aria-modal="true" aria-label="Gefuehrter Rundgang durch die Journey">
        <div className="tour-scrim" onClick={onClose} />
        <div className="tour-card tour-card-dock tour-card-preparing" style={{ width: CARD_WIDTH }}>
          <div className="tour-card-head">
            <span className="tour-step-count">Rundgang wird vorbereitet</span>
            <button className="tour-close" onClick={onClose} aria-label="Rundgang beenden" title="Beenden (Esc)">
              ×
            </button>
          </div>
          <div className="tour-preparing-spinner" aria-hidden="true" />
          <p className="tour-desc">
            Für „Skill-Gap“ und „Kurs“ lädt der Rundgang gerade ein echtes Beispielergebnis, damit dort auch ohne
            vorherigen eigenen Durchlauf etwas zu sehen ist — dauert nur einen Moment.
          </p>
        </div>
      </div>
    );
  }

  const highlightBox = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  return (
    <div className="tour-layer" role="dialog" aria-modal="true" aria-label="Gefuehrter Rundgang durch die Journey">
      <div className="tour-scrim" onClick={onClose} />
      {highlightBox && (
        <div
          className="tour-spotlight"
          style={{ top: highlightBox.top, left: highlightBox.left, width: highlightBox.width, height: highlightBox.height }}
        />
      )}
      <div className="tour-card tour-card-dock" style={{ width: CARD_WIDTH }}>
        <div className="tour-card-head">
          <span className="tour-step-count">
            {stepIdx + 1} / {steps.length}
          </span>
          <button className="tour-close" onClick={onClose} aria-label="Rundgang beenden" title="Beenden (Esc)">
            ×
          </button>
        </div>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-desc">{step.description}</p>
        <div className="tour-progress">
          {steps.map((_, i) => (
            <span key={i} className={`tour-dot ${i === stepIdx ? "active" : i < stepIdx ? "done" : ""}`} />
          ))}
        </div>
        <div className="tour-actions">
          <button className="tour-btn tour-btn-ghost" onClick={onClose}>
            Beenden
          </button>
          <div className="tour-nav-btns">
            <button
              className="tour-btn tour-btn-secondary"
              onClick={() => setStepIdx((i) => Math.max(i - 1, 0))}
              disabled={isFirst}
            >
              ← Zurück
            </button>
            <button
              className="tour-btn tour-btn-primary"
              onClick={() => (isLast ? onClose() : setStepIdx((i) => Math.min(i + 1, steps.length - 1)))}
            >
              {isLast ? "Fertig ✓" : "Weiter →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}