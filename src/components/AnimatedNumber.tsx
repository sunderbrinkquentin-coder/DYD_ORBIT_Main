import { useEffect, useRef, useState } from "react";

interface AnimatedNumberProps {
  value: number;
  suffix?: string;
  duration?: number;
  /** Wenn true, wird mit einer Nachkommastelle statt gerundet dargestellt. */
  decimal?: boolean;
}

/**
 * Zählt beim Erscheinen/Ändern von `value` mit einer kurzen Ease-out-Animation
 * hoch, statt den Wert einfach hart zu setzen — dieselbe Optik wie das
 * `animateNumber()` aus der ursprünglichen orbit-dashboard-preview.html.
 */
export function AnimatedNumber({ value, suffix = "", duration = 700, decimal = false }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);
  const frameRef = useRef<number>();

  useEffect(() => {
    const from = 0;
    const start = performance.now();

    function tick(now: number) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = from + (value - from) * eased;
      setDisplay(val);
      if (p < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  const text = decimal ? display.toFixed(1) : Math.round(display).toString();
  return <>{text + suffix}</>;
}
