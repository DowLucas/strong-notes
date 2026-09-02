import { useEffect, useRef, useState } from 'react';

/**
 * Turns a raw "busy" flag into one that's worth showing a user.
 *
 * Background work that usually finishes in a blink (a note re-scan, say)
 * otherwise flashes its indicator on and straight off again — motion the eye
 * catches but can't read, which reads as a glitch rather than as progress. Two
 * guards fix that:
 *
 *  • `delayMs` — stay hidden until the work has run this long. Work that beats
 *    the delay never shows an indicator at all.
 *  • `minVisibleMs` — once shown, stay up this long even if the work finishes
 *    immediately after, so the indicator is always readable.
 *
 * Work restarting during the hold keeps the indicator up rather than blinking
 * it off and on.
 */
export function useDelayedVisibility(
  active: boolean,
  { delayMs, minVisibleMs }: { delayMs: number; minVisibleMs: number },
): boolean {
  const [visible, setVisible] = useState(false);
  // When the indicator appeared, so the hold is measured from first paint
  // rather than from when the work happened to end.
  const shownAt = useRef(0);

  useEffect(() => {
    if (active === visible) return;
    if (active) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, delayMs);
      return () => clearTimeout(timer);
    }
    // Date.now() is not monotonic. A backwards clock correction makes the
    // elapsed time negative, which would otherwise extend the hold by the
    // size of the jump, so cap it at the hold itself.
    const elapsed = Date.now() - shownAt.current;
    const remaining = Math.min(minVisibleMs, Math.max(0, minVisibleMs - elapsed));
    const timer = setTimeout(() => setVisible(false), remaining);
    return () => clearTimeout(timer);
  }, [active, visible, delayMs, minVisibleMs]);

  return visible;
}
