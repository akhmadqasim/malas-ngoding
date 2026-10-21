/*
 * Motion tokens for Motion (JS). The CSS twins are --ease-* and --duration-* in styles.css.
 * Rules: docs/research/design/00-direction.md section 6.
 */

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN = [0.4, 0, 1, 1] as const;

/** Seconds. */
export const DURATION = {
  /** Panel content entering. */
  panel: 0.24,
  /** Panel content leaving. */
  exit: 0.18,
  /** Count-up of a number on first reveal or a real data change. */
  count: 0.9,
  /** Bars growing to their value. */
  bar: 0.6,
  /** The panels assembling as the intro lands (part of the one orchestrated moment). */
  assemble: 0.5,
  /** The intro title and lede settling in over the globe. */
  introText: 0.7,
} as const;

export const SPRING = {
  /** Switches and the metric option. */
  control: { type: "spring", visualDuration: 0.2, bounce: 0.15 },
  /** Panels never bounce. */
  panel: { type: "spring", visualDuration: 0.25, bounce: 0 },
  /** The legend needle: the one element allowed to overshoot, like a meter needle. */
  needle: { type: "spring", visualDuration: 0.4, bounce: 0.25 },
} as const;

/** Sibling stagger: 30 ms apart, never more than 300 ms in total. */
export const stagger = (index: number) => Math.min(index * 0.03, 0.3);
