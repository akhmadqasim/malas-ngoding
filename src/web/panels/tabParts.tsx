import { Button } from "@heroui/react";
import { type KeyboardEvent, type ReactNode, type RefObject, useLayoutEffect, useState } from "react";
import { chem } from "../components/Chem.tsx";

/*
 * Small pieces the building panel tabs share (Surya, Cuaca; usable by Energi and Emisi too): a fact row,
 * the failure line with "Coba lagi", the width of a chart box, and the chart cursor.
 */

/** One label and value of a tab, the same build as the region facts. */
export function TabFact({ label, unit, children }: { label: string; unit: ReactNode; children: ReactNode }) {
  return (
    <div className="sw-fact">
      <dt className="sw-fact__label">{chem(label)}</dt>
      <dd className="sw-fact__value">
        <span className="sw-fact__number">{children}</span>
        <span className="sw-fact__unit">{typeof unit === "string" ? chem(unit) : unit}</span>
      </dd>
    </div>
  );
}

/** What failed, in one sentence, and the way to try again (00-direction section 8). */
export function TabFailure({ message, what, onRetry }: { message: string; what: string; onRetry: () => void }) {
  return (
    <div className="sw-tab__failure" role="alert">
      <p className="sw-tab__failure-text">
        {what} belum bisa dimuat. {message}
      </p>
      <Button variant="outline" size="sm" onPress={onRetry}>
        Coba lagi
      </Button>
    </div>
  );
}

/** The width of an element, kept up to date (charts draw at real pixels, not a scaled viewBox). */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * The point a chart reads out: under the pointer, or moved with the arrow keys (Home and End jump to the
 * ends). Only keyboard moves are announced (`keyboard`), so a screen reader does not chatter on mouse moves.
 */
export function useChartCursor(count: number, { wrap = false } = {}) {
  const [active, setActive] = useState<number | null>(null);
  const [keyboard, setKeyboard] = useState<number | null>(null);
  const move = (next: number) => {
    setActive(next);
    setKeyboard(next);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (count === 0) return;
    const last = count - 1;
    let next: number | null = null;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const step = e.key === "ArrowRight" ? 1 : -1;
      if (active === null) next = step > 0 ? 0 : last;
      else next = wrap ? (active + step + count) % count : Math.min(last, Math.max(0, active + step));
    }
    if (next === null) return;
    e.preventDefault();
    move(next);
  };
  return {
    active,
    keyboard,
    /** From a pointer move: the index under it, or null off the plot. Never announced. */
    point: (i: number | null) => {
      setActive(i);
      setKeyboard(null);
    },
    onKeyDown,
    clear: () => {
      setActive(null);
      setKeyboard(null);
    },
  };
}
