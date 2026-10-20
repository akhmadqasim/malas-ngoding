import type { ReactNode } from "react";

interface Props {
  children?: ReactNode;
  tone?: "estimate" | "warning" | "neutral";
  title?: string;
}

/** Small inline label. The default marks a number as an estimate ("perkiraan"), as the spec requires. */
export function Badge({ children = "perkiraan", tone = "estimate", title }: Props) {
  return (
    <span className={`badge badge--${tone}`} title={title ?? (tone === "estimate" ? "Angka ini hasil perkiraan, bukan data meteran" : undefined)}>
      {children}
    </span>
  );
}
