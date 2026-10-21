/**
 * Dev-only harness page: a stand-in for the building panel (00-direction section 8) that renders the real
 * SolarTab and WeatherTab for a fixture building, by day or by night. Query: ?theme=day|night, ?tab=surya|cuaca.
 */
import { Card } from "@heroui/react";
import { MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { fmtNumber } from "../../src/shared/format.ts";
import type { BuildingEstimate, BuildingInput, BuildingType } from "../../src/shared/types.ts";
import { api } from "../../src/web/api.ts";
import { Estimate } from "../../src/web/components/Estimate.tsx";
import { SolarTab } from "../../src/web/panels/SolarTab.tsx";
import { WeatherTab } from "../../src/web/panels/WeatherTab.tsx";

const q = new URLSearchParams(location.search);
document.documentElement.dataset.theme = q.get("theme") === "day" ? "atlas-day" : "atlas-night";

/** Fixture buildings in central Samarinda, by `?type=` (the estimate comes from the real API). */
const FIXTURES: Partial<Record<BuildingType, { name: string; footprintM2: number; floors: number }>> = {
  rumah: { name: "Rumah", footprintM2: 100, floors: 1 },
  kantor: { name: "Kantor", footprintM2: 600, floors: 4 },
  mal: { name: "Mal", footprintM2: 6000, floors: 3 },
  pemerintahan: { name: "Kantor pemerintahan", footprintM2: 1200, floors: 3 },
  sekolah: { name: "Sekolah", footprintM2: 900, floors: 2 },
};
const TYPE = (q.get("type") ?? "kantor") as BuildingType;
const PICK = FIXTURES[TYPE] ?? FIXTURES.kantor!;
const FIXTURE: BuildingInput = {
  featureId: `harness-samarinda-${TYPE}`,
  lng: 117.1475,
  lat: -0.4955,
  footprintM2: PICK.footprintM2,
  heightM: null,
  typeOverride: FIXTURES[TYPE] ? TYPE : "kantor",
  floorsOverride: PICK.floors,
};

const TABS = [
  { key: "energi", label: "Energi" },
  { key: "emisi", label: "Emisi" },
  { key: "surya", label: "Surya" },
  { key: "cuaca", label: "Cuaca" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function Harness() {
  const [building, setBuilding] = useState<BuildingEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(q.get("tab") === "cuaca" ? "cuaca" : "surya");
  useEffect(() => {
    api.estimateBuilding(FIXTURE).then(setBuilding, (e: unknown) => setError(String(e)));
  }, []);
  const at: [number, number] = [FIXTURE.lng, FIXTURE.lat];
  return (
    <main className="harness">
      <Card className="harness__panel" role="region" aria-label="Data gedung">
        {error && <p>{error}</p>}
        {building && (
          <div className="harness__scroll">
            <h2 className="harness__name">{PICK.name}</h2>
            <p className="harness__meta">{building.region?.name ?? "Di luar Kalimantan Timur"}, {building.floors} lantai</p>
            <p className="harness__readout num">{fmtNumber(building.kwhYear)}</p>
            <p className="harness__meta">
              kWh per tahun, <Estimate />
            </p>
            <div className="harness__tabs" role="tablist" aria-label="Rincian gedung">
              {TABS.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className="harness__tab" onClick={() => setTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div role="tabpanel" className="harness__body">
              {tab === "surya" && <SolarTab building={building} at={at} />}
              {tab === "cuaca" && <WeatherTab building={building} at={at} />}
              {(tab === "energi" || tab === "emisi") && <p className="harness__meta">Tab milik lane buildings.</p>}
            </div>
          </div>
        )}
      </Card>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <MotionConfig reducedMotion="user">
    <Harness />
  </MotionConfig>,
);
