import { useEffect, useRef, useState } from "react";

/**
 * Gefuehrter Rundgang durch das Dashboard, ueber den Button "🎓 Rundgang
 * starten" auslösbar (siehe DashboardPage.tsx). Rein clientseitig, keine
 * Abhaengigkeiten -- ein "Spotlight"-Overlay hebt jeweils einen echten
 * DOM-Bereich hervor (per data-tour="..."-Attribut markiert), daneben
 * erscheint eine Karte mit kurzer Erklaerung. Wechselt bei Bedarf selbst
 * den Tab (z.B. fuer die Kurse/Reports-Schritte).
 *
 * Bewusst ohne externe Tour-Bibliothek (Intro.js o.ae.) gebaut, um keine
 * zusaetzliche Abhaengigkeit ins schlanke Frontend (nur react/react-dom)
 * zu ziehen.
 */

export type DashboardTab = "leads" | "kurse" | "reports";

interface TourStep {
  tab: DashboardTab;
  /** CSS-Selector fuer das hervorzuhebende Element, oder null fuer einen
   *  zentrierten Schritt ohne Spotlight (Intro/Abschluss). */
  selector: string | null;
  title: string;
  description: string;
}

const STEPS: TourStep[] = [
  {
    tab: "leads",
    selector: null,
    title: "Willkommen im DYD ORBIT Dashboard",
    description:
      "Ein ausführlicherer Rundgang durch alle Bereiche des Dashboards — mit den Hintergründen, nicht nur den Klicks. Du kannst jederzeit mit „Beenden“ aussteigen und über den Button oben rechts wieder einsteigen.",
  },
  {
    tab: "leads",
    selector: '[data-tour="tenant-block"]',
    title: "Whitelabel-Branding",
    description:
      "DYD bleibt als Hauptmarke sichtbar, das Logo und der Name des jeweiligen Bildungsträgers erscheinen direkt darunter — „Ingredient Branding“. Hintergrund: jeder Mandant bekommt so ein eigenes, auf ihn zugeschnittenes Dashboard, ohne dass DYD dafür eine eigene Instanz pro Kunde betreiben muss — Mandanten-Trennung läuft komplett über den API-Key.",
  },
  {
    tab: "leads",
    selector: '[data-tour="nav"]',
    title: "Drei Bereiche",
    description:
      "Leads zeigt eingehende Interessenten, Kurse verwaltet den eigenen Kurskatalog (inkl. drei verschiedener Wege, Kurse anzulegen), Reports fasst alle Kennzahlen zusammen. „Matching“ ist bewusst als vierter Tab schon sichtbar, aber noch nicht aktiv — folgt später.",
  },
  {
    tab: "leads",
    selector: '[data-tour="tile-row-leads"]',
    title: "Kennzahlen auf einen Blick",
    description:
      "Anzahl der Tests, identifizierte Skill-Gaps, ausgesprochene Kursempfehlungen und tatsächlich gebuchte Weiterbildungen. Wichtig: „Tests“ zählt JEDEN abgeschlossenen Skill-Check aus der Journey mit, auch wenn die Person danach abspringt und nie ein Kontaktformular abschickt — so siehst du auch die Abbrecher, nicht nur die fertigen Leads.",
  },
  {
    tab: "leads",
    selector: '[data-tour="lead-list"]',
    title: "Qualifizierte Leads",
    description:
      "Jeder Lead zeigt Zielrolle, Match-Status und Kontaktdaten — alle verlinkten Weiterbildungen direkt auf der Kachel, nicht erst nach dem Öffnen. Ein Klick auf die Kachel zeigt weitere Details: Bearbeiter zuweisen, Beratungsgespräch anfragen, Kurse nachträglich ändern, die im Journey-„Präferenzen“-Schritt genannten Rahmenbedingungen (Beschäftigungsart/Arbeitsort/Wunschstart/Förderung) sowie einen eigenen „Datenschutz“-Bereich: dort steht der DSGVO-Einwilligungsnachweis (wann/welcher Text) und ein „Lead endgültig löschen“-Button für das Recht auf Löschung (Art. 17 DSGVO). Sobald die Buchung im eigenen System erfolgt ist, markierst du sie hier manuell — das speist die Kennzahl „Gebuchte Weiterbildungen“.",
  },
  {
    tab: "leads",
    selector: '[data-tour="leads-manual-form"]',
    title: "Lead manuell anlegen",
    description:
      "Für Tests/Demos, ohne die Journey selbst durchzuklicken: Profil-Text und Zielrolle reichen für den Match. Zusätzlich lassen sich hier gleich alle interessanten oder bereits gebuchten Weiterbildungen als Kacheln auswählen (mit Suche ab 6+ Kursen) und der Lead optional direkt als „bereits gebucht“ markieren.",
  },
  {
    tab: "kurse",
    selector: '[data-tour="kurse-manual-form"]',
    title: "Kurse anlegen — drei Wege",
    description:
      "Drei Wege zum selben Ziel, gleich unten im Detail: von Hand eintragen, per CSV-Liste importieren, oder direkt von der eigenen Website importieren. Gemeinsamer Kern aller drei: ohne Skill-Zuordnung erscheint ein Kurs NIE als persönliche Empfehlung in der Journey — das Matching kennt nur Skills, keine Kurstitel. Hier zunächst die manuelle Eingabe: Kurs-ID, Name, Anbieter, Dauer, Zielrolle(n).",
  },
  {
    tab: "kurse",
    selector: '[data-tour="kurse-pricing-fields"]',
    title: "Preis, Förderung & Abschluss",
    description:
      "Orientiert an den echten Datenmodellen deutscher IHK-Bildungszentren (Unterrichtseinheiten à 45 Min. statt Stunden, AZAV-Maßnahmenummer als Förderfähigkeits-Nachweis, die vier üblichen Abschlussarten inkl. DQR-Niveau, mehrere gleichzeitig mögliche Förderkanäle wie Bildungsgutschein oder Aufstiegs-BAföG). Alles optional — aber jedes ausgefüllte Feld erscheint direkt auf der Kurskarte in der Journey und fließt zusätzlich als eigene Präferenz-Dimension ins Matching ein (wer „Förderung wichtig“ angibt, bekommt geförderte Kurse bevorzugt einsortiert).",
  },
  {
    tab: "kurse",
    selector: '[data-tour="kurse-skill-suggest"]',
    title: "Skills automatisch erkennen",
    description:
      "Zwei Erkennungs-Stufen aus derselben Kursbeschreibung: die schnelle, kostenlose Fuzzy-Erkennung läuft automatisch im Hintergrund; „🤖 Skills per KI vertiefen“ liest zusätzlich inhaltlich gegen die Kern-Skills der ausgewählten Zielrolle(n) — findet auch umschriebene Skills, die die schnelle Erkennung verpasst, braucht dafür aber eine gewählte Zielrolle. Beides liefert nur Vorschläge zum Prüfen („Alle übernehmen“ oder einzeln per „✓“/„×“) — nichts wird automatisch als Skill gesetzt.",
  },
  {
    tab: "kurse",
    selector: '[data-tour="kurse-handbook-upload"]',
    title: "Modulhandbuch statt Beschreibung",
    description:
      "Alternative zur kurzen Kursbeschreibung: ein ganzes Modulhandbuch oder Kursplan als PDF/DOCX/TXT hochladen. Auch bei sehr großen Dateien vollständig ausgewertet — die Skill-Erkennung durchsucht das komplette Dokument parallel in Abschnitten statt nur einen gekürzten Ausschnitt zu lesen. Praktisch, wenn ein Kurs bereits eine ausführliche offizielle Beschreibung hat, die nicht nochmal von Hand zusammengefasst werden soll.",
  },
  {
    tab: "kurse",
    selector: '[data-tour="kurse-csv-import"]',
    title: "Kurse per CSV importieren",
    description:
      "Mehrere Kurse auf einmal aus einer Excel-/CSV-Liste anlegen — Spalten werden per Dropdown den eigenen Feldern zugeordnet, es wird also kein festes Format vorausgesetzt. Bringt die Datei eine Beschreibungs-Spalte mit, ermittelt derselbe automatische Abgleich passende Skills je Kurs — als Vorschläge, die du vor dem eigentlichen Import noch prüfst und bei Bedarf per „×“ entfernst. Fehlende Skills lassen sich jederzeit später über „✎ Bearbeiten“ ergänzen.",
  },
  {
    tab: "kurse",
    selector: '[data-tour="kurse-url-import"]',
    title: "Kurse per URL importieren",
    description:
      "Dritter Weg, wenn Kurse schon auf der eigenen Website stehen: entweder die Domain eingeben (durchsucht automatisch die sitemap.xml nach Kurs-Seiten) oder direkt eine einzelne Kurs-URL einfügen. Eine KI liest Preis, Förderung, Dauer, Abschlussart und Co. aus der echten Seite heraus — mit eingebauter Absicherung gegen Halluzination: kritische Felder werden nur übernommen, wenn die KI ein wörtliches Belegzitat von der Seite liefert, sonst bleibt das Feld leer. Nichts wird automatisch gespeichert: jeder gefundene Kurs landet als Entwurf im Formular oben, den du vor „Kurs speichern“ selbst prüfst.",
  },
  {
    tab: "kurse",
    selector: '[data-tour="kurse-catalog"]',
    title: "Kurskatalog pflegen",
    description:
      "Hier siehst du alle angelegten Kurse — egal auf welchem der drei Wege angelegt — inklusive Preis/UE/Förderfähig-Badges, und markierst einzelne als „Top“: die erscheinen dann zusätzlich zur individuellen Empfehlung in der Endnutzer-Journey, unabhängig vom persönlichen Skill-Match. Skills lassen sich hier jederzeit über „✎ Bearbeiten“ nachträglich prüfen oder ergänzen.",
  },
  {
    tab: "kurse",
    selector: ".banner-quickpick",
    title: "Konversions-Banner direkt auf der Kachel",
    description:
      "Ohne den Kurs erst zu bearbeiten: Start-Datum und verbleibende Plätze eintragen oder einen eigenen Text wählen — daraus entstehen automatisch Banner wie „Startet in Kürze“ oder „Nur noch wenige Plätze“, die der Nutzer später in der Journey sieht. Bewusst nur aus echten, hier gepflegten Werten berechnet, nie frei erfunden — ein Kurs ohne Start-Datum zeigt schlicht kein Banner.",
  },
  {
    tab: "reports",
    selector: '[data-tour="tile-row-reports"]',
    title: "Report-Kennzahlen",
    description:
      "Neue Leads, durchschnittlicher Match-Score, qualifizierte Leads und Conversion-Rate im Überblick — dieselben Rohdaten wie im Leads-Tab, hier aber als Trend über die Zeit statt als Einzel-Kacheln.",
  },
  {
    tab: "reports",
    selector: '[data-tour="report-skill-gaps"]',
    title: "Größte Skill-Gaps",
    description:
      "Die Skills, die Nutzern am häufigsten fehlen — zugleich ein Signal, wofür am meisten Nachfrage besteht. Gute Grundlage für neue Kursangebote: fehlt hier ein Skill, für den es im eigenen Katalog noch gar keinen passenden Kurs gibt, ist das ein sehr konkreter Hinweis, was sich lohnen würde.",
  },
  {
    tab: "reports",
    selector: '[data-tour="report-top-courses"]',
    title: "Top-Kurse",
    description:
      "Die am häufigsten empfohlenen Kurse über alle Leads hinweg, nach Empfehlungshäufigkeit sortiert — zeigt, welche Kurse im eigenen Katalog tatsächlich am besten zu den ankommenden Zielrollen/Skill-Lücken passen.",
  },
  {
    tab: "reports",
    selector: null,
    title: "Das war der Rundgang",
    description:
      "Du findest den Button „🎓 Rundgang starten“ jederzeit oben rechts wieder, falls du ihn nochmal brauchst — z.B. direkt vor einer Präsentation.",
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

interface DashboardTourProps {
  open: boolean;
  onClose: () => void;
  activeTab: DashboardTab;
  onChangeTab: (tab: DashboardTab) => void;
  /**
   * Meldet den Selector des gerade aktiven Schritts nach oben (null, wenn die
   * Tour geschlossen ist oder der Schritt keinen Selector hat, z.B. Intro/
   * Abschluss). DashboardPage.tsx nutzt das u.a., um beim Kurse-Schritt
   * Beispieldaten ins Formular bzw. den CSV-Import einzublenden — rein zur
   * Anschauung, es wird dabei nichts an die API geschickt.
   */
  onStepChange?: (selector: string | null) => void;
}

export function DashboardTour({ open, onClose, activeTab, onChangeTab, onStepChange }: DashboardTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const pulsedElRef = useRef<Element | null>(null);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const isFirst = stepIndex === 0;

  // Beim Öffnen immer bei Schritt 1 starten.
  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open]);

  /** Bugfix (14.09., "die Kachel von der Rundtour ist hinter den Infos, die
   *  muss irgendwo am Rand stehen, sodass man beides immer sieht" — siehe
   *  identischer Kommentar in JourneyTour.tsx): ab einer gewissen
   *  Fensterbreite (Media Query bei .tour-card-dock in dashboard.css) dockt
   *  die Karte seitlich am rechten Rand statt unten mittig, UND ".main"
   *  bekommt per Body-Klasse echten zusaetzlichen Platz auf der rechten Seite
   *  (das Dashboard-Inhaltsraster wird dadurch tatsaechlich schmaler/nach
   *  links verschoben, nicht nur ueberlagert) — bei einem inhaltsreichen
   *  Schritt wie dem Kurskatalog verdeckt die Karte dadurch nie mehr Teile
   *  des echten, hervorgehobenen Inhalts. Auf schmalen Bildschirmen bleibt
   *  das bisherige Verhalten (unten mittig, keine Verschiebung) unveraendert. */
  useEffect(() => {
    document.body.classList.toggle("dashboard-tour-open", open);
    return () => {
      document.body.classList.remove("dashboard-tour-open");
    };
  }, [open]);

  useEffect(() => {
    onStepChange?.(open ? step.selector : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stepIndex]);

  // Tab wechseln, falls der aktuelle Schritt einen anderen Tab braucht.
  useEffect(() => {
    if (!open) return;
    if (step.tab !== activeTab) onChangeTab(step.tab);
  }, [open, stepIndex, step.tab, activeTab, onChangeTab]);

  // Zielelement erst messen, sobald der richtige Tab aktiv ist (nach obigem
  // Wechsel rendert die Elternkomponente neu, dieser Effekt läuft dann erneut
  // mit aktualisiertem activeTab).
  useEffect(() => {
    if (!open) return;
    if (step.tab !== activeTab) return;

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
      // Zielt der Schritt auf ein eingeklapptes <details> (z.B. die
      // "Kurs manuell anlegen"-/"CSV importieren"-Karten), klappt die Tour es
      // auf — sonst waere im Spotlight nur die Kopfzeile zu sehen, waehrend
      // die Beschreibung vom Inhalt darunter spricht. Manche <details> in
      // DashboardPage.tsx sind React-kontrolliert (open-Prop + onToggle) --
      // ein "toggle"-Event nach dem Setzen von .open stellt sicher, dass ein
      // per onToggle angebundener React-State (z.B. courseFormOpen) mitzieht
      // und das Element beim naechsten Render nicht wieder zuklappt.
      if (el instanceof HTMLDetailsElement && !el.open) {
        el.open = true;
        el.dispatchEvent(new Event("toggle", { bubbles: false }));
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // kurz warten, bis der Scroll (grob) angekommen ist, dann messen, das
      // Element DAUERHAFT (fuer die gesamte Dauer dieses Schritts) ueber das
      // dunkle Overlay heben ("tour-highlight-active") + kurzen "Bounce"-Puls
      // ausloesen ("tour-pulse-target", wird nach 550ms wieder entfernt -- nur
      // die Animation endet, die Sichtbarkeit bleibt). Vorher wurde hier nur
      // "tour-pulse-target" gesetzt UND nach 550ms wieder entfernt -- das war
      // zugleich die einzige Klasse, die das Element ueber das Overlay hob,
      // wodurch es danach wieder hinter dem Overlay verschwand, obwohl der
      // Schritt noch aktiv war.
      window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        el.classList.add("tour-highlight-active", "tour-pulse-target");
        pulsedElRef.current = el;
        window.setTimeout(() => el.classList.remove("tour-pulse-target"), 550);
      }, 260);
    });
    return () => cancelAnimationFrame(raf);
  }, [open, stepIndex, step.tab, step.selector, activeTab]);

  // Bei Resize/Scroll neu messen, solange ein Ziel hervorgehoben ist.
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

  // Esc schließt den Rundgang; Pfeiltasten blättern.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
      else if (e.key === "ArrowLeft") setStepIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Beim Schließen letzte Hervorhebung + Puls sauber entfernen.
  useEffect(() => {
    if (open) return;
    if (pulsedElRef.current) {
      pulsedElRef.current.classList.remove("tour-pulse-target", "tour-highlight-active");
      pulsedElRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  const highlightBox = rect
    ? {
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  return (
    <div className="tour-layer" role="dialog" aria-modal="true" aria-label="Geführter Rundgang">
      <div className="tour-scrim" onClick={onClose} />
      {highlightBox && (
        <div
          className="tour-spotlight"
          style={{
            top: highlightBox.top,
            left: highlightBox.left,
            width: highlightBox.width,
            height: highlightBox.height,
          }}
        />
      )}
      {/* Bugfix (14.09., "Erklärfeld darf nie im Hintergrund sein und immer
       *  gut sichtbar sein"): statt dynamisch ueber/unter dem jeweiligen
       *  Zielelement zu schweben (konnte bei sehr hohen Zielen wie
       *  kurse-catalog/lead-list ausserhalb des sichtbaren Bereichs landen,
       *  siehe ausfuehrlicher Kommentar in dashboard.css bei .tour-card-dock)
       *  jetzt IMMER an derselben festen Stelle (unten mittig) — identisches,
       *  bereits bewaehrtes Muster wie in JourneyTour.tsx. */}
      <div className="tour-card tour-card-dock" style={{ width: CARD_WIDTH }}>
        <div className="tour-card-head">
          <span className="tour-step-count">
            {stepIndex + 1} / {STEPS.length}
          </span>
          <button className="tour-close" onClick={onClose} aria-label="Rundgang beenden" title="Beenden (Esc)">
            ×
          </button>
        </div>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-desc">{step.description}</p>
        <div className="tour-progress">
          {STEPS.map((_, i) => (
            <span key={i} className={`tour-dot ${i === stepIndex ? "active" : i < stepIndex ? "done" : ""}`} />
          ))}
        </div>
        <div className="tour-actions">
          <button className="tour-btn tour-btn-ghost" onClick={onClose}>
            Beenden
          </button>
          <div className="tour-nav-btns">
            <button
              className="tour-btn tour-btn-secondary"
              onClick={() => setStepIndex((i) => Math.max(i - 1, 0))}
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