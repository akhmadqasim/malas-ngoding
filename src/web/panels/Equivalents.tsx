import { fmtCompact, fmtNumber } from "../../shared/format.ts";
import type { Equivalent } from "../../shared/types.ts";
import { AnimatedNumber } from "../components/AnimatedNumber.tsx";

/**
 * An equivalent in plain numbers: words from 100 ribu up ("2,3 juta"), whole numbers from 10, one
 * decimal below that ("4,5" flights), so a small building never shows "0".
 */
export function fmtEquivalent(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, n) : 0;
  if (v >= 100_000) return fmtCompact(v);
  if (v >= 9.95) return fmtNumber(v);
  return fmtNumber(v, 1);
}

/** Reading order: the most familiar picture first. */
const ORDER: readonly Equivalent["key"][] = ["pohon", "mobil_km", "motor_km", "charge_hp", "penerbangan"];
const rank = (key: Equivalent["key"]) => {
  const i = ORDER.indexOf(key);
  return i < 0 ? ORDER.length : i;
};

interface Props {
  items: readonly Equivalent[];
}

/**
 * What a yearly amount of CO2 compares to, in things people know (car km, trees, phone charges,
 * flights): a list of rows, the number first, then what it counts. The labels come from the seed data.
 */
export function Equivalents({ items }: Props) {
  if (items.length === 0) return <p className="equivalents__none">Belum ada data pembanding.</p>;
  return (
    <ul className="equivalents">
      {[...items].sort((a, b) => rank(a.key) - rank(b.key)).map((e) => (
        <li key={e.key} className="equivalents__row">
          <AnimatedNumber value={e.value} format={fmtEquivalent} className="equivalents__value" />
          <span className="equivalents__label">{e.label}</span>
        </li>
      ))}
    </ul>
  );
}
