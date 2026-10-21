import { fmtNumber } from "../../shared/format.ts";
import { AnimatedNumber } from "../components/AnimatedNumber.tsx";
import { chem } from "../components/Chem.tsx";
import { Estimate } from "../components/Estimate.tsx";
import type { BuildingTabProps } from "./buildingTabs.ts";
import { Equivalents } from "./Equivalents.tsx";
import { GridMixBar } from "./GridMixBar.tsx";

const whole = (n: number) => fmtNumber(n);
const tenths = (n: number) => fmtNumber(n, 1);
const factor = (n: number) => fmtNumber(n, 2);

/** CO2 per year as a figure and its unit: kilograms below one tonne, tonnes from there. */
export function co2Figure(kg: number): { value: number; unit: string; format: (n: number) => string } {
  const v = Number.isFinite(kg) ? Math.max(0, kg) : 0;
  if (Math.round(v) < 1000) return { value: v, unit: "kg CO2 per tahun", format: whole };
  const t = v / 1000;
  return { value: t, unit: "ton CO2 per tahun", format: t < 100 ? tenths : whole };
}

/** The Emisi tab: the CO2, the grid mix behind the electricity, and what the CO2 compares to. */
export function EmissionTab({ building }: BuildingTabProps) {
  const co2 = co2Figure(building.co2KgYear);
  const gridFactor = building.kwhYear > 0 ? building.co2KgYear / building.kwhYear : 0;
  return (
    <div className="tab-body">
      <div className="tab-figure">
        <p className="tab-figure__label">{chem("Emisi CO2")}</p>
        <p className="tab-figure__value">
          <AnimatedNumber value={co2.value} format={co2.format} />
        </p>
        <p className="tab-figure__unit">
          {chem(co2.unit)}, <Estimate />
        </p>
      </div>

      <h3 className="group-label tab-body__title">Asal listrik gedung ini</h3>
      <GridMixBar bySource={building.bySource} label="Asal listrik gedung ini" />
      <p className="tab-body__note">
        Listrik PLN di Kaltim datang dari banyak pembangkit yang tersambung ke satu jaringan, jadi gedung ini memakai campurannya, bukan
        listrik dari satu pembangkit.
      </p>

      <h3 className="group-label tab-body__title">
        {chem("Emisi CO2 setahun setara dengan")} (<Estimate />)
      </h3>
      <Equivalents items={building.equivalents} />

      <p className="tab-body__source">
        {chem(
          `Emisi CO2 = kWh × faktor emisi jaringan ${factor(gridFactor)} kg CO2/kWh (Kementerian ESDM, Sistem Mahakam, data 2019). Campuran bahan bakar: perkiraan 2024.`,
        )}
      </p>
    </div>
  );
}
