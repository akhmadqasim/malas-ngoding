import { animate, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef } from "react";

interface Props {
  value: number;
  format: (n: number) => string;
  /** Seconds. */
  duration?: number;
  className?: string;
}

/**
 * Counts from the previous value to the new one. Writes straight to the DOM node on each frame,
 * so a counting number never re-renders the React tree. Pass a stable `format` (module level),
 * or every render restarts the count.
 */
export function AnimatedNumber({ value, format, duration = 1.1, className }: Props) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    const el = node.current;
    if (!el) return;
    el.textContent = format(shown.current);
    const target = Number.isFinite(value) ? value : 0;
    if (reduce) {
      shown.current = target;
      el.textContent = format(target);
      return;
    }
    const controls = animate(shown.current, target, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        shown.current = v;
        el.textContent = format(v);
      },
    });
    return () => controls.stop();
  }, [value, format, duration, reduce]);

  return (
    // React never renders text here; the effect owns the node's text so the two cannot fight.
    <span ref={node} className={`tabular-nums ${className ?? ""}`} />
  );
}
