import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Gemeinsame Spotlight-Logik fuer DashboardTour und JourneyTour (28.09.2026).
 *
 * Warum neu: Beide Touren hatten dieselbe Mess-/Scroll-Logik doppelt, und
 * das hervorgehobene Element war oft abgedunkelt. Ursache: Das dunkle
 * Overlay (.tour-scrim) lag ueber der ganzen Seite, und das Ziel-Element
 * wurde per z-index darueber gehoben. Liegt das Element aber in einem
 * eigenen Stacking-Context (transform, filter, Animationen, overflow ...),
 * wirkt dieser z-index nicht, und das Element blieb unter dem Overlay.
 * Jetzt dunkelt nur noch der Schatten um den Spotlight-Ausschnitt ab
 * (.tour-spotlight, box-shadow), das Overlay selbst ist bei einem Spotlight
 * durchsichtig (.tour-scrim.is-clear). Der Ausschnitt zeigt damit immer die
 * echten Farben, egal wo das Element im DOM steckt.
 *
 * Weitere Punkte:
 *  - Mehrere Selektoren als Fallback (erster sichtbarer Treffer gewinnt).
 *  - Sehr hohe Ziele werden oben angesetzt statt mittig, und der Ausschnitt
 *    wird auf den sichtbaren Bereich begrenzt.
 *  - Auf schmalen Bildschirmen (Karte unten) wird das Ziel bei Bedarf so
 *    gescrollt, dass die Karte es nicht verdeckt.
 *  - Nachmessen bei Scroll, Resize, Groessenaenderung des Ziels und nach dem
 *    seitlichen Platz-Machen fuer die Karte (padding-Transition).
 */

export interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Ab dieser Breite dockt die Tour-Karte rechts (siehe .tour-card-dock im CSS). */
const SIDE_DOCK_MIN_WIDTH = 1100;
const EDGE = 8;
/** Abstand nach oben bei hohen Zielen (Platz fuer fixierte Leisten). */
const TOP_GAP = 72;

function findTarget(selectors: string[]): HTMLElement | null {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLElement)) continue;
    // Eingeklappte <details>-Vorfahren oeffnen, sonst hat das Ziel keine Box.
    let node: HTMLElement | null = el;
    while (node) {
      if (node instanceof HTMLDetailsElement && !node.open) {
        node.open = true;
        node.dispatchEvent(new Event("toggle", { bubbles: false }));
      }
      node = node.parentElement;
    }
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function clampToViewport(r: DOMRect): SpotlightRect {
  const top = Math.max(r.top, EDGE);
  const bottom = Math.min(r.bottom, window.innerHeight - EDGE);
  return { top, left: r.left, width: r.width, height: Math.max(0, bottom - top) };
}

/**
 * @param active   Tour offen und Schritt bereit (z. B. richtiger Tab aktiv).
 * @param selectors Ziel-Selektoren in Prioritaet, oder null (zentrierter Schritt).
 * @param stepKey  Wechselt pro Schritt (loest neues Messen aus).
 * @param cardRef  Die Tour-Karte (fuer den Ueberdeckungs-Check auf schmalen Screens).
 */
export function useTourSpotlight(
  active: boolean,
  selectors: string[] | null,
  stepKey: string | number,
  cardRef: RefObject<HTMLElement | null>,
): SpotlightRect | null {
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const selectorKey = selectors ? selectors.join("|") : "";

  useEffect(() => {
    const prev = elRef.current;
    if (prev) prev.classList.remove("tour-pulse-target", "tour-highlight-active");
    elRef.current = null;
    if (!active || !selectors || selectors.length === 0) {
      setRect(null);
      return;
    }
    let cancelled = false;
    const timers: number[] = [];
    let observer: ResizeObserver | null = null;

    const measure = () => {
      const el = elRef.current;
      if (!el || cancelled) return;
      setRect(clampToViewport(el.getBoundingClientRect()));
    };

    /** Schmale Screens: Karte unten mittig — Ziel notfalls nach oben schieben. */
    const avoidCard = () => {
      const el = elRef.current;
      const card = cardRef.current;
      if (!el || !card || window.innerWidth >= SIDE_DOCK_MIN_WIDTH) return;
      const r = el.getBoundingClientRect();
      const cardTop = card.getBoundingClientRect().top;
      const overlap = r.bottom - (cardTop - 12);
      if (overlap > 0 && r.top > 72) window.scrollBy({ top: Math.min(overlap, r.top - 72), behavior: "smooth" });
    };

    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      const el = findTarget(selectors);
      if (!el) {
        setRect(null);
        return;
      }
      elRef.current = el;
      const box = el.getBoundingClientRect();
      const tall = box.height > window.innerHeight - 160;
      const pageScrolls = (document.scrollingElement?.scrollHeight ?? 0) > window.innerHeight + 10;
      if (tall && pageScrolls) {
        // Hohe Ziele oben ansetzen, mit etwas Luft fuer feste Leisten oben.
        window.scrollTo({ top: Math.max(0, window.scrollY + box.top - TOP_GAP), behavior: "smooth" });
      } else {
        el.scrollIntoView({ behavior: "smooth", block: tall ? "start" : "center" });
      }
      el.classList.add("tour-highlight-active", "tour-pulse-target");
      timers.push(window.setTimeout(() => el.classList.remove("tour-pulse-target"), 550));
      timers.push(window.setTimeout(measure, 280));
      timers.push(
        window.setTimeout(() => {
          avoidCard();
          measure();
        }, 650),
      );
      timers.push(window.setTimeout(measure, 1100));
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(measure);
        observer.observe(el);
      }
    });

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      timers.forEach((t) => window.clearTimeout(t));
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selectorKey, stepKey]);

  // Beim Schliessen die Hervorhebung sauber entfernen.
  useEffect(() => {
    if (active) return;
    const el = elRef.current;
    if (el) el.classList.remove("tour-pulse-target", "tour-highlight-active");
    elRef.current = null;
  }, [active]);

  return rect;
}