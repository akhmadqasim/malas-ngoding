import { animate, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef } from "react";
import { DURATION, EASE_OUT } from "../motion.ts";

interface Props {
  value: number;
  format: (n: number) => string;
  className?: string;
}

/**
 * Counts from the previous value to the new one (first reveal, or a real data change). Writes straight
 * to the DOM node on each frame, so a counting number never re-renders the React tree. Pass a stable
 * `format` (module level), or every render restarts the count.
 */
export function AnimatedNumber({ value, format, className }: Props) {
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
      duration: DURATION.count,
      ease: EASE_OUT,
      onUpdate: (v) => {
        shown.current = v;
        el.textContent = format(v);
      },
    });
    return () => controls.stop();
  }, [value, format, reduce]);

  return (
    // React never renders text here; the effect owns the node's text so the two cannot fight.
    <span ref={node} className={className ? `num ${className}` : "num"} />
  );
}
