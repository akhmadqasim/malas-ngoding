import { useEffect, useMemo, useState } from "react";
import { toEquivalents } from "../../shared/equivalents.ts";
import type { EquivalentFactor, FuelType, GridMix } from "../../shared/types.ts";
import { api } from "../api.ts";
import { chem } from "../components/Chem.tsx";
import { Estimate } from "../components/Estimate.tsx";
import { FUEL_LABELS } from "../map/fuels.ts";
import { Equivalents, fmtEquivalent } from "./Equivalents.tsx";
import { fmtShare, fuelShares, GridMixBar } from "./GridMixBar.tsx";

interface Reference {
  grid: GridMix;
  factors: EquivalentFactor[];
}

/** The grid mix and the equivalence factors, fetched once for the whole page; a failure may retry later. */
let reference: Promise<Reference> | null = null;
function loadReference(): Promise<Reference> {
  reference ??= Promise.all([api.grid(), api.equivalents()])
    .then(([grid, factors]) => ({ grid, factors }))
    .catch((err: unknown) => {
      reference = null;
      throw err;
    });
  return reference;
}

/** The equivalents the region sheet shows: the ones a reader pictures at once, at a province's scale. */
const SHEET_EQUIVALENTS = ["pohon", "mobil_km", "penerbangan"] as const;

interface Props {
  /** The CO2 of the place shown (the province or one region), kg per year. */
  co2KgYear: number;
  /**
   * The overview's short form: the bar, one line of the largest fuels and one equivalent, shown only on
   * screens tall enough to hold it (buildings.css), so the ten regions always fit.
   */
  compact?: boolean;
}

/** "Batu bara 66%, gas 25%, diesel 7%, lainnya 2%": the three largest fuels, the rest summed. */
export function mixSummary(shares: { fuel: FuelType; share: number }[]): string {
  const top = shares.slice(0, 3).map((s, i) => `${i === 0 ? FUEL_LABELS[s.fuel] : FUEL_LABELS[s.fuel].toLowerCase()} ${fmtShare(s.share)}`);
  const rest = shares.slice(3).reduce((sum, s) => sum + s.share, 0);
  return [...top, ...(rest > 0 ? [`lainnya ${fmtShare(rest)}`] : [])].join(", ");
}

/**
 * Where the electricity of Kalimantan Timur comes from (the grid mix by fuel) and what the CO2 of the
 * place shown compares to. Placed on the region sheet below the figures; the grid mix is the province's
 * for every region, because the grid is shared.
 */
export function EmissionContext({ co2KgYear, compact = false }: Props) {
  const [ref, setRef] = useState<Reference | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadReference()
      .then((r) => live && setRef(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const mix = useMemo(
    () => (ref ? (Object.entries(ref.grid.shares) as [FuelType, number][]).map(([fuel, share]) => ({ fuel, kwh: share })) : []),
    [ref],
  );
  const items = useMemo(() => {
    if (!ref) return [];
    const all = toEquivalents(co2KgYear, ref.factors);
    return SHEET_EQUIVALENTS.flatMap((key) => all.filter((e) => e.key === key));
  }, [ref, co2KgYear]);

  if (failed) return compact ? null : <p className="context__none">Asal listrik belum bisa dimuat.</p>;
  if (!ref) return null;
  if (compact) {
    const trees = items.find((e) => e.key === "pohon");
    return (
      <section className="context context--compact" aria-label="Asal listrik Kalimantan Timur">
        <h3 className="group-label context__title">Asal listrik Kaltim</h3>
        <GridMixBar bySource={mix} label="Asal listrik Kalimantan Timur" legend={false} />
        <p className="context__legend">{mixSummary(fuelShares(mix))}.</p>
        {trees && (
          <p className="context__equivalent">
            {chem("Emisi CO2 Kaltim setara dengan ")}
            <span className="num">{fmtEquivalent(trees.value)}</span> {trees.label} (<Estimate />).
          </p>
        )}
      </section>
    );
  }
  return (
    <section className="context" aria-label="Asal listrik dan pembanding emisi">
      <h3 className="group-label context__title">Asal listrik Kaltim</h3>
      <GridMixBar bySource={mix} label="Asal listrik Kalimantan Timur" />
      <p className="context__note">
        Perkiraan campuran {ref.grid.year} dari kapasitas pembangkit. Listrik jaringan bercampur, jadi tiap wilayah memakai campuran yang
        sama.
      </p>
      <h3 className="group-label context__title">
        {chem("Emisi CO2 setahun setara dengan")} (<Estimate />)
      </h3>
      <Equivalents items={items} />
    </section>
  );
}
