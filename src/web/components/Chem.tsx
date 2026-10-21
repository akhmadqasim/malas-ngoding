import { Fragment, type ReactNode } from "react";

/**
 * Sets "CO2" in running text as CO with a subscript 2. The bundled IBM Plex has no U+2082 glyph, so a
 * plain "₂" would fall back to another font; `.sub` uses Plex's own small figures instead.
 * Accessible names stay "CO2" because the subscript is ordinary text.
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
