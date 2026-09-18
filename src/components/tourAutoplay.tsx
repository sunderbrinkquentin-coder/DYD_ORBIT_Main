import { useEffect, useRef, useState } from "react";

/**
 * Auto-Advance + simulierte Live-Hinweise für DashboardTour/JourneyTour
 * (NEU, 18.09. — "ich will, dass das ganze automatisch läuft" / "kleine
 * Frequenzen wie einzelne ... UseCases im Dashboard oder der Journey
 * passieren"). Quentins Anwendungsfall: eine Bildschirmaufzeichnung der
 * Tour für Bildungsträger-Präsentationen, ohne dabei selbst durch die
 * Schritte klicken zu müssen.
 *
 * Bewusst als eigene, kleine Datei ausgelagert statt in beiden Touren
 * dupliziert — kein externes Paket, gleiches Prinzip wie schon
 * courseBadges.tsx (geteilte Anzeige-Bausteine zwischen Dashboard- und
 * Journey-Seite).
 */

/**
 * Grobe Lesezeit aus der Beschreibungslänge (statt einer festen Sekundenzahl
 * pro Schritt): ein kurzer Schritt wie "Zielrolle wählen" braucht weniger
 * Zeit als "Skill-Gap-Ergebnis" mit deutlich mehr Text. ~15 Zeichen/Sek. (also
 * etwas langsamer als reines Lesetempo, da bei einer Aufzeichnung auch Zeit
 * bleiben soll, das gerade hervorgehobene Element im Hintergrund anzusehen),
 * auf 5–14 Sekunden pro Schritt begrenzt, damit weder ein sehr kurzer noch
 * ein sehr langer Schritt die Aufnahme aus dem Takt bringt.
 */
export function readingDurationMs(text: string): number {
  const raw = (text.length / 15) * 1000;
  return Math.min(14000, Math.max(5000, raw));
}

/**
 * Läuft, solange `active` true ist: startet bei jedem `resetKey`-Wechsel
 * (z.B. der aktuelle Schritt-Index) einen neuen Timer über `durationMs` und
 * ruft danach `onAdvance()` auf. Der zurückgegebene Fortschritt (0..1) treibt
 * eine kleine Fortschrittsleiste im Tour-UI — rein kosmetisch, zeigt bei der
 * Aufzeichnung nur, dass die Tour läuft und nicht hängt.
 */
export function useTourAutoplay(active: boolean, resetKey: string | number, durationMs: number, onAdvance: () => void): number {
  const [progress, setProgress] = useState(0);
  const onAdvanceRef = useRef(onAdvance);
  onAdvanceRef.current = onAdvance;

  useEffect(() => {
    if (!active) {
      setProgress(0);
      return;
    }
    const start = Date.now();
    setProgress(0);
    const tick = window.setInterval(() => {
      setProgress(Math.min(1, (Date.now() - start) / durationMs));
    }, 100);
    const advanceTimeout = window.setTimeout(() => {
      onAdvanceRef.current();
    }, durationMs);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(advanceTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, resetKey, durationMs]);

  return progress;
}

/**
 * Kleiner Umschalt-Button "▶ Automatisch abspielen" / "⏸ Pause" fürs
 * Tour-Kopfzeile — identisch in DashboardTour/JourneyTour verwendet.
 */
export function TourAutoplayToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`tour-autoplay-toggle ${active ? "active" : ""}`}
      onClick={onToggle}
      title={active ? "Automatische Wiedergabe anhalten" : "Automatisch abspielen (für Bildschirmaufzeichnungen)"}
    >
      {active ? "⏸ Pause" : "▶ Automatisch abspielen"}
    </button>
  );
}

/** Kleine Fortschrittsleiste für den Countdown bis zum nächsten Auto-Advance. */
export function TourAutoplayBar({ active, progress }: { active: boolean; progress: number }) {
  if (!active) return null;
  return (
    <div className="tour-autoplay-bar" aria-hidden="true">
      <div className="tour-autoplay-bar-fill" style={{ width: `${Math.min(100, progress * 100)}%` }} />
    </div>
  );
}

/**
 * Rein optischer "Live-Hinweis" (Toast), der während des Autoplays kurz
 * einblendet und nach ein paar Sekunden wieder verschwindet — simuliert
 * Aktivität für die Aufnahme ("Automatische Skillvorschläge und kleine
 * ... UseCases"), erzeugt aber NICHTS Echtes: kein Lead, kein Kurs, keine
 * API-Anfrage. `toastKey` (z.B. der Schritt-Index) sorgt dafür, dass beim
 * erneuten Erreichen desselben Schritt-Texts der Hinweis erneut aufblendet.
 */
export function TourDemoToast({ text, toastKey }: { text: string | null | undefined; toastKey: string | number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!text) {
      setVisible(false);
      return;
    }
    // Kurze Verzögerung, damit der Hinweis nicht exakt gleichzeitig mit dem
    // Spotlight-Sprung erscheint, sondern kurz danach "hereinflattert".
    const showDelay = window.setTimeout(() => setVisible(true), 500);
    const hideDelay = window.setTimeout(() => setVisible(false), 4700);
    return () => {
      window.clearTimeout(showDelay);
      window.clearTimeout(hideDelay);
    };
  }, [text, toastKey]);

  if (!text) return null;
  return (
    <div className={`tour-demo-toast ${visible ? "visible" : ""}`} role="status" aria-live="polite">
      {text}
    </div>
  );
}