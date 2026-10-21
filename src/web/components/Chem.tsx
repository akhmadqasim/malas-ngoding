import { Fragment, type ReactNode } from "react";

/**
 * Sets "CO2" in running text as CO with a subscript 2 (`.sub`: a small figure below the baseline that does
 * not stretch the line). Accessible names stay "CO2" because the subscript is ordinary text.
 */
export function chem(text: string): ReactNode {
  const parts = text.split("CO2");
  if (parts.length === 1) return text;
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 && (
        <>
          CO<span className="sub">2</span>
        </>
      )}
      {part}
    </Fragment>
  ));
}
