import { fmtNumber } from "../../shared/format.ts";
import { AnimatedNumber } from "../components/AnimatedNumber.tsx";
import { Estimate } from "../components/Estimate.tsx";
import { BUILDING_TYPE_LABELS, type BuildingTabProps } from "./buildingTabs.ts";

const whole = (n: number) => fmtNumber(n);

/** "m2" in the estimate's assumption texts, set as m². */
const squareMetres = (text: string) => text.replace(/\bm2\b/g, "m²");

/** The Energi tab: how much electricity, from what floor area, and the assumptions behind it. */
export function EnergyTab({ building }: BuildingTabProps) {
  const footprint = building.floors > 0 ? building.floorAreaM2 / building.floors : building.floorAreaM2;
  const intensity = building.floorAreaM2 > 0 ? building.kwhYear / building.floorAreaM2 : 0;
  const type = BUILDING_TYPE_LABELS[building.type].toLowerCase();
  return (
    <div className="tab-body">
      <dl className="rows">
        <div className="row">
          <dt className="row__label">Per bulan</dt>
          <dd className="row__value">
            <AnimatedNumber value={building.kwhMonth} format={whole} /> kWh, <Estimate />
          </dd>
        </div>
        <div className="row">
          <dt className="row__label">Intensitas listrik</dt>
          <dd className="row__value">
            <span className="num">{fmtNumber(intensity)}</span> kWh/m² per tahun
            <span className="row__note">angka umum untuk {type}</span>
          </dd>
        </div>
      </dl>
      <dl className="rows">
        <div className="row">
          <dt className="row__label">Luas lantai</dt>
          <dd className="row__value">
            <AnimatedNumber value={building.floorAreaM2} format={whole} /> m²
            <span className="row__note num">
              {fmtNumber(footprint)} m² × {building.floors} lantai
            </span>
          </dd>
        </div>
        <div className="row">
          <dt className="row__label">Wilayah</dt>
          <dd className="row__value">{building.region ? building.region.name : "Di luar Kalimantan Timur"}</dd>
        </div>
      </dl>

      <h3 className="group-label tab-body__title">Asumsi</h3>
      <ul className="assumptions">
        <li>Listrik setahun = luas lantai × intensitas listrik jenis gedung.</li>
        {building.assumptions.map((a) => (
          <li key={a}>{squareMetres(a)}</li>
        ))}
      </ul>
      <p className="tab-body__source">
        Intensitas per jenis gedung: survei Kementerian ESDM 2021 (kantor, rumah sakit, hotel, mal) dan perkiraan untuk jenis lain.
      </p>
    </div>
  );
}
