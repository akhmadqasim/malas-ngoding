import { motion } from "motion/react";
import { fmtKg, fmtNumber } from "../../shared/format.ts";
import type { FuelType } from "../../shared/types.ts";
import { chem } from "../components/Chem.tsx";
import { FUEL_LABELS, FUELS } from "../map/fuels.ts";
import { DURATION, EASE_OUT } from "../motion.ts";

/** Electricity by fuel: kWh (or any amount in proportion, such as grid shares), and the CO2 when known. */
export interface FuelAmount {
  fuel: FuelType;
  kwh: number;
  co2Kg?: number;
}

export interface FuelShare extends FuelAmount {
  /** Part of the total, 0..1. */
  share: number;
}

/** The fuels with a share, largest first (legend order on ties), and each one's part of the whole. */
export function fuelShares(bySource: readonly FuelAmount[]): FuelShare[] {
  const valid = bySource.filter((s) => Number.isFinite(s.kwh) && s.kwh > 0);
  const total = valid.reduce((sum, s) => sum + s.kwh, 0);
  if (total <= 0) return [];
  return valid
    .map((s) => ({ ...s, share: s.kwh / total }))
    .sort((a, b) => b.share - a.share || FUELS.indexOf(a.fuel) - FUELS.indexOf(b.fuel));
}

/** A share as a whole percent; a share too small to show as 1% says so ("<1%") instead of "0%". */
export function fmtShare(share: number): string {
  const pct = share * 100;
  if (pct > 0 && pct < 0.5) return "<1%";
  return `${fmtNumber(pct)}%`;
}

interface Props {
  bySource: readonly FuelAmount[];
  /** Name of the bar for screen readers, e.g. "Asal listrik gedung ini". */
  label?: string;
}

/**
 * The grid mix behind some electricity: one horizontal bar in the fuel colours, then the fuels listed
 * with their share (and the CO2 they cause, when given). Grid power is pooled, so this is the mix of the
 * grid, not one plant.
 */
export function GridMixBar({ bySource, label = "Asal listrik menurut bahan bakar" }: Props) {
  const shares = fuelShares(bySource);
  if (shares.length === 0) return <p className="mix__none">Belum ada data campuran listrik.</p>;
  const withCo2 = shares.some((s) => s.co2Kg !== undefined);
  return (
    <div className="mix">
      <div className="mix__track" role="img" aria-label={`${label}: ${shares.map((s) => `${FUEL_LABELS[s.fuel]} ${fmtShare(s.share)}`).join(", ")}`}>
        {/* The whole bar grows once from the left, like the region list bars. */}
        <motion.div
          className="mix__bar"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: DURATION.bar, ease: EASE_OUT }}
        >
          {shares.map((s) => (
            <span key={s.fuel} className="mix__part" data-fuel={s.fuel} style={{ flexGrow: s.share }} />
          ))}
        </motion.div>
      </div>
      <ul className="mix__list" data-co2={withCo2 || undefined}>
        {shares.map((s) => (
          <li key={s.fuel} className="mix__row">
            <span className="fuel-dot" data-fuel={s.fuel} aria-hidden />
            <span className="mix__fuel">{FUEL_LABELS[s.fuel]}</span>
            <span className="mix__share num">{fmtShare(s.share)}</span>
            {withCo2 && <span className="mix__co2 num">{s.co2Kg === undefined ? "" : chem(`${fmtKg(s.co2Kg)} CO2`)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
