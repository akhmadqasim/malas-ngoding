import { useEffect, useMemo, useState } from "react";
import { toEquivalents } from "../../shared/equivalents.ts";
import type { EquivalentFactor, FuelType, GridMix } from "../../shared/types.ts";
import { api } from "../api.ts";
import { chem } from "../components/Chem.tsx";
import { Estimate } from "../components/Estimate.tsx";
import { Equivalents } from "./Equivalents.tsx";
import { GridMixBar } from "./GridMixBar.tsx";

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
}

/**
 * Where the electricity of Kalimantan Timur comes from (the grid mix by fuel) and what the CO2 of the
 * place shown compares to. Placed on the region sheet below the figures; the grid mix is the province's
 * for every region, because the grid is shared.
 */
export function EmissionContext({ co2KgYear }: Props) {
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

  if (failed) return <p className="context__none">Asal listrik belum bisa dimuat.</p>;
  if (!ref) return null;
  return (
    <section className="context" aria-label="Asal listrik dan pembanding emisi">
      <h3 className="group-label context__title">Asal listrik Kaltim</h3>
      <GridMixBar bySource={mix} label="Asal listrik Kalimantan Timur" />
      <p className="context__note">
        Perkiraan campuran {ref.grid.year} dari kapasitas pembangkit. Listrik jaringan bercampur, jadi tiap wilayah memakai campuran yang
        sama.
      </p>
      <h3 className="group-label context__title">
        {chem("Emisi CO2 setahun setara dengan")}, <Estimate />
      </h3>
      <Equivalents items={items} />
    </section>
  );
}
