import { useEffect, useRef, useState } from "react";
import { readingDurationMs, TourAutoplayBar, TourAutoplayToggle, TourDemoToast, TourStepDots, useTourAutoplay } from "./tourAutoplay";
import { useTourSpotlight } from "./tourSpotlight";

/**
 * Gefuehrter Rundgang durch das Dashboard, ueber den Button "🎓 Rundgang
 * starten" auslösbar (siehe DashboardPage.tsx). Rein clientseitig, keine
 * Abhaengigkeiten -- ein "Spotlight"-Overlay hebt jeweils einen echten
 * DOM-Bereich hervor (per data-tour="..."-Attribut markiert), daneben
 * erscheint eine Karte mit kurzer Erklaerung. Wechselt bei Bedarf selbst
 * den Tab (z.B. fuer die Kurse/Reports-Schritte).
 *
 * Ueberarbeitung 28.09.2026:
 *  - Lesbarkeit: Das hervorgehobene Element wird nicht mehr abgedunkelt
 *    (gemeinsame Spotlight-Logik in tourSpotlight.ts, siehe Kommentar dort).
 *  - Texte gekuerzt und auf den aktuellen Stand gebracht (Website-Suche,
 *    Kurs per Link, Beratungswunsch, mehrere Kurse je Lead); je Schritt ein
 *    eigener Nutzen-Satz wie in der Journey-Tour.
 *  - Ein Klick auf die abgedunkelte Flaeche beendet die Tour nicht mehr
 *    versehentlich (Beenden ueber ×, "Beenden" oder Esc).
 *
 * WICHTIG: Die Selektoren '[data-tour="kurse-manual-form"]',
 * '[data-tour="kurse-csv-import"]' und '[data-tour="kurse-url-import"]'
 * steuern in DashboardPage.tsx das Einblenden der Beispieldaten
 * (tourStepSelector) — sie muessen als erster Selektor exakt so bleiben.
 */

export type DashboardTab = "leads" | "kurse" | "reports";

interface TourStep {
  tab: DashboardTab;
  /** Ziel-Selektoren in Prioritaet (erster sichtbarer Treffer), oder null
   *  fuer einen zentrierten Schritt ohne Spotlight (Intro/Abschluss). */
  selector: string[] | null;
  title: string;
  description: string;
  /** Nutzen fuer den Bildungstraeger, optisch abgesetzt (.tour-benefit). */
  benefit?: string;
  /** Optionaler, rein simulierter "Live-Hinweis" waehrend der automatischen
   *  Wiedergabe (siehe tourAutoplay.tsx). Erzeugt nichts Echtes. */
  demoEvent?: string;
}

const STEPS: TourStep[] = [
  {
    tab: "leads",
    selector: null,
    title: "Willkommen im DYD ORBIT Dashboard",
    description:
      "In gut zwei Minuten durch Leads, Kurse und Reports. Mit „Weiter“ oder den Pfeiltasten blättern, mit „Beenden“ oder Esc jederzeit aussteigen.",
    benefit: "Für eine Bildschirmaufnahme: „▶ Automatisch abspielen“ lässt den Rundgang von selbst laufen.",
  },
  {
    tab: "leads",
    selector: ['[data-tour="tenant-block"]'],
    title: "Deine Marke im Dashboard",
    description:
      "Logo und Name deines Hauses stehen direkt unter DYD ORBIT. Jeder Bildungsträger sieht ausschließlich seine eigenen Daten – getrennt über den eigenen API-Key.",
    benefit: "Whitelabel ohne eigene Instanz: du startest sofort mit deinem Branding.",
  },
  {
    tab: "leads",
    selector: ['[data-tour="nav"]'],
    title: "Leads, Kurse, Reports",
    description:
      "Leads zeigt die Anfragen aus der Journey, Kurse deinen Katalog, Reports die Auswertungen. „Matching“ ist bereits sichtbar und folgt später.",
  },
  {
    tab: "leads",
    selector: ['[data-tour="tile-row-leads"]'],
    title: "Kennzahlen auf einen Blick",
    description:
      "Abgeschlossene Tests, erkannte Skill-Gaps, vorgeschlagene und gebuchte Weiterbildungen. „Tests“ zählt auch Personen, die danach keine Anfrage abgeschickt haben.",
    benefit: "So siehst du nicht nur fertige Leads, sondern auch, wie viele unterwegs abspringen.",
    demoEvent: "🆕 Neuer Lead eingegangen — Zielrolle: Fachkraft für Lagerlogistik",
  },
  {
    tab: "leads",
    selector: ['[data-tour="lead-list"]'],
    title: "Deine Leads",
    description:
      "Jede Kachel zeigt Ziel, Match, Kontakt und alle angefragten Kurse. „Beratungsgespräch angefragt“ erscheint, wenn die Person den Beratungs-Haken gesetzt hat – mit „Vereinbart“ und „Durchgeführt“ zum Abhaken. Filter nach Zeitraum, Kategorie und Bereich stehen oben.",
    benefit: "Die Notiz aus der Journey (Situation, Prioritäten, Hürden) liegt direkt am Lead – dein Rückruf startet nicht bei null.",
    demoEvent: "📞 Beratungsgespräch angefragt",
  },
  {
    tab: "leads",
    selector: ['[data-tour="leads-manual-form"]'],
    title: "Lead manuell anlegen",
    description:
      "Für Anfragen per Telefon oder Messe: Profiltext und Zielrolle reichen für den Match. Interessante oder bereits gebuchte Kurse lassen sich direkt verknüpfen.",
  },
  {
    tab: "kurse",
    selector: [".catalog-hero"],
    title: "Neue Kurse auf Ihrer Website finden",
    description:
      "Einmal die Adresse deiner Kursübersicht hinterlegen, danach reicht ein Klick: ORBIT durchsucht deine Website und zeigt neue Kurse als Vorschläge. Gespeichert wird nichts automatisch – du prüfst jeden Kurs selbst.",
    benefit: "Dein Katalog bleibt aktuell, ohne jeden neuen Kurs von Hand abzutippen.",
    demoEvent: "🔎 2 neue Kurse auf der Website gefunden",
  },
  {
    tab: "kurse",
    selector: ['[data-tour="kurse-manual-form"]'],
    title: "Kurs von Hand anlegen",
    description:
      "Name, Anbieter, Dauer, Beschreibung und Buchungslink. Entscheidend sind die Skills: Ohne Skill-Zuordnung erscheint ein Kurs nie als persönliche Empfehlung.",
  },
  {
    tab: "kurse",
    selector: ['[data-tour="kurse-pricing-fields"]'],
    title: "Preis, Förderung & Abschluss",
    description:
      "Preis, Unterrichtseinheiten, AZAV-Maßnahmenummer, Förderwege (z. B. Bildungsgutschein, Aufstiegs-BAföG) und Abschlussart. Alles optional – jedes Feld erscheint auf der Kurskarte in der Journey.",
    benefit: "Mit gepflegter Förderung zeigt die Journey Interessierten konkret, wie sie an den Bildungsgutschein kommen.",
  },
  {
    tab: "kurse",
    selector: ['[data-tour="kurse-skill-suggest"]'],
    title: "Skills automatisch erkennen",
    description:
      "Aus der Kursbeschreibung schlägt ORBIT passende Skills vor; die KI-Vertiefung findet auch umschriebene Inhalte. du übernimmst jeden Vorschlag selbst mit ✓ oder verwirfst ihn mit ×.",
    demoEvent: "🤖 3 Skills erkannt: Lagerorganisation, SAP, Bestandsmanagement",
  },
  {
    tab: "kurse",
    selector: ['[data-tour="kurse-handbook-upload"]'],
    title: "Modulhandbuch hochladen",
    description:
      "Statt einer Kurzbeschreibung ein ganzes Modulhandbuch als PDF, DOCX oder TXT hochladen. Die Skill-Erkennung liest das komplette Dokument.",
  },
  {
    tab: "kurse",
    selector: ['[data-tour="kurse-bereich-picker"]'],
    title: "Bereich zuordnen",
    description:
      "Pflichtfeld: Der Bereich (z. B. IT & Technik oder Logistik & Verkehr) entscheidet, ob ein Kurs Personen erreicht, die in der Journey nur eine Branche statt eines Berufs wählen. Mehrere Bereiche sind möglich.",
    benefit: "Ohne Bereich bleibt ein Kurs für genau diese Zielgruppe unsichtbar.",
    demoEvent: "🧭 Bereich zugeordnet: Logistik & Verkehr",
  },
  {
    tab: "kurse",
    selector: ['[data-tour="kurse-csv-import"]'],
    title: "Viele Kurse per CSV",
    description:
      "Eine Excel- oder CSV-Liste hochladen und die Spalten per Auswahl zuordnen – kein festes Format nötig. Aus der Beschreibungs-Spalte werden Skills vorgeschlagen, die du vor dem Import prüfst.",
  },
  {
    tab: "kurse",
    selector: ['[data-tour="kurse-url-import"]'],
    title: "Kurs per Link importieren",
    description:
      "Eine einzelne Kursseite einfügen: Eine KI liest Preis, Förderung, Dauer und Abschluss aus. Kritische Angaben werden nur mit wörtlichem Beleg von der Seite übernommen, sonst bleibt das Feld leer.",
    benefit: "Du prüfst den Entwurf im Formular und speicherst erst dann – nichts landet ungeprüft im Katalog.",
  },
  {
    tab: "kurse",
    selector: ['[data-tour="kurse-catalog"]'],
    title: "Dein Kurskatalog",
    description:
      "Alle Kurse mit Bereich, Preis und Förderhinweisen. Hinweise wie „Kein Bereich zugeordnet“ zeigen sofort, wo nachgepflegt werden sollte. „Top“ markiert Kurse, die in der Journey zusätzlich hervorgehoben werden.",
    demoEvent: "⭐ Kurs als Top-Empfehlung markiert",
  },
  {
    tab: "kurse",
    selector: ['[data-tour="kurse-banner-quickpick"]'],
    title: "Banner direkt auf der Kachel",
    description:
      "Start-Datum und freie Plätze eintragen – daraus entstehen Banner wie „Startet in Kürze“ oder „Nur noch wenige Plätze“. Sie beruhen immer auf deinen echten Werten, ohne Start-Datum gibt es kein Banner.",
  },
  {
    tab: "reports",
    selector: ['[data-tour="tile-row-reports"]'],
    title: "Report-Kennzahlen",
    description: "Neue Leads, durchschnittlicher Match, qualifizierte Leads und Conversion – als Entwicklung über die Zeit.",
  },
  {
    tab: "reports",
    selector: ['[data-tour="report-skill-gaps"]'],
    title: "Größte Skill-Gaps",
    description:
      "Die Kompetenzen, die Interessierten am häufigsten fehlen – filterbar nach Zeitraum und Bereich.",
    benefit: "Fehlt für einen häufigen Gap ein Kurs in deinem Katalog, ist das ein konkreter Hinweis für neue Angebote.",
    demoEvent: "📊 Größter Skill-Gap aktualisiert",
  },
  {
    tab: "reports",
    selector: ['[data-tour="report-top-courses"]'],
    title: "Top-Kurse",
    description: "Deine am häufigsten empfohlenen Kurse – je Bereich gefiltert siehst du, welche Branche die meiste Nachfrage bringt.",
  },
  {
    tab: "reports",
    selector: null,
    title: "Das war der Rundgang",
    description:
      "Den Button „🎓 Rundgang starten“ findest du jederzeit oben rechts – praktisch direkt vor einer Präsentation oder Aufnahme.",
  },
];

const CARD_WIDTH = 380;
const PAD = 10;

interface DashboardTourProps {
  open: boolean;
  onClose: () => void;
  activeTab: DashboardTab;
  onChangeTab: (tab: DashboardTab) => void;
  /**
   * Meldet den (ersten) Selector des gerade aktiven Schritts nach oben (null,
   * wenn die Tour geschlossen ist oder der Schritt keinen Selector hat).
   * DashboardPage.tsx blendet damit u.a. beim Kurse-Schritt Beispieldaten ein
   * — rein zur Anschauung, es wird dabei nichts an die API geschickt.
   */
  onStepChange?: (selector: string | null) => void;
}

export function DashboardTour({ open, onClose, activeTab, onChangeTab, onStepChange }: DashboardTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // Karte einklappen (v. a. auf schmalen Screens), damit das hervorgehobene
  // Element komplett sichtbar ist. Bleibt ueber die Schritte hinweg bestehen.
  const [collapsed, setCollapsed] = useState(false);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const isFirst = stepIndex === 0;

  useEffect(() => {
    if (open) {
      setStepIndex(0);
      setAutoplay(false);
    }
  }, [open]);

  const autoplayProgress = useTourAutoplay(
    autoplay && open && !isLast,
    stepIndex,
    readingDurationMs(step.description + (step.benefit ?? "")),
    () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1)),
  );

  // Seitlicher Platz fuer die Karte (siehe .dashboard-tour-open .main im CSS).
  useEffect(() => {
    document.body.classList.toggle("dashboard-tour-open", open);
    return () => {
      document.body.classList.remove("dashboard-tour-open");
    };
  }, [open]);

  useEffect(() => {
    onStepChange?.(open && step.selector ? step.selector[0] : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stepIndex]);

  // Tab wechseln, falls der aktuelle Schritt einen anderen Tab braucht.
  useEffect(() => {
    if (!open) return;
    if (step.tab !== activeTab) onChangeTab(step.tab);
  }, [open, stepIndex, step.tab, activeTab, onChangeTab]);

  const rect = useTourSpotlight(open && step.tab === activeTab, step.selector, stepIndex, cardRef);

  // Esc schliesst, Pfeiltasten blaettern (Zurueck stoppt die Automatik).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
      else if (e.key === "ArrowLeft") {
        setAutoplay(false);
        setStepIndex((i) => Math.max(i - 1, 0));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const highlightBox = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  return (
    <div className="tour-layer" role="dialog" aria-modal="true" aria-label="Geführter Rundgang">
      {/* Mit Spotlight durchsichtig (der Schatten des Spotlights dunkelt ab),
          ohne Spotlight abgedunkelt. Ein Klick darauf beendet die Tour nicht. */}
      <div className={`tour-scrim ${highlightBox ? "is-clear" : ""}`} />
      {highlightBox && <div className="tour-spotlight" style={highlightBox} />}
      <TourDemoToast text={autoplay ? step.demoEvent : null} toastKey={stepIndex} />
      <div ref={cardRef} className={`tour-card tour-card-dock ${collapsed ? "is-collapsed" : ""}`} style={{ width: CARD_WIDTH }}>
        <div className="tour-card-head">
          <span className="tour-step-count">
            {stepIndex + 1} / {STEPS.length}
          </span>
          <span className="tour-head-btns">
            <button
              type="button"
              className="tour-collapse"
              onClick={() => setCollapsed((c) => !c)}
              aria-expanded={!collapsed}
              title={collapsed ? "Erklärung wieder anzeigen" : "Karte einklappen, um den Bereich ganz zu sehen"}
            >
              {collapsed ? "Text zeigen ▴" : "Einklappen ▾"}
            </button>
            <button className="tour-close" onClick={onClose} aria-label="Rundgang beenden" title="Beenden (Esc)">
              ×
            </button>
          </span>
        </div>
        {/* Einziger Scroll-Bereich der Karte — Kopf und Buttons bleiben immer sichtbar. */}
        <div className="tour-card-body">
          <div className="tour-autoplay-row">
            <TourAutoplayToggle active={autoplay} onToggle={() => setAutoplay((a) => !a)} />
          </div>
          <TourAutoplayBar active={autoplay && !isLast} progress={autoplayProgress} />
          <h3 className="tour-title">{step.title}</h3>
          <p className="tour-desc">{step.description}</p>
          {step.benefit && <p className="tour-benefit">{step.benefit}</p>}
          <TourStepDots
            count={STEPS.length}
            currentIndex={stepIndex}
            onJump={(i) => {
              setAutoplay(false);
              setStepIndex(i);
            }}
          />
        </div>
        <div className="tour-actions">
          <button className="tour-btn tour-btn-ghost" onClick={onClose}>
            Beenden
          </button>
          <div className="tour-nav-btns">
            <button
              className="tour-btn tour-btn-secondary"
              onClick={() => {
                setAutoplay(false);
                setStepIndex((i) => Math.max(i - 1, 0));
              }}
              disabled={isFirst}
            >
              ← Zurück
            </button>
            <button
              className="tour-btn tour-btn-primary"
              onClick={() => (isLast ? onClose() : setStepIndex((i) => Math.min(i + 1, STEPS.length - 1)))}
            >
              {isLast ? "Fertig ✓" : "Weiter →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}