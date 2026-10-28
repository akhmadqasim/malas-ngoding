import { BookOpen, ChartColumn, ChevronLeft, Clock, House, MapPin, Sun } from "../icons.ts";
import { Button, I18nProvider, Label, Skeleton, Slider } from "@heroui/react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { fmtCompact, fmtNumber } from "../../shared/format.ts";
import { rooftopScenario, SCENARIO_MAX_SHARE, type ScenarioBasis, scenarioScale } from "../../shared/scenario.ts";
import type { RegionSummary } from "../../shared/types.ts";
import { api } from "../api.ts";
import { AnimatedNumber } from "../components/AnimatedNumber.tsx";
import { chem } from "../components/Chem.tsx";
import { Estimate } from "../components/Estimate.tsx";
import { DURATION, EASE_IN, EASE_OUT } from "../motion.ts";
import { useAppStore } from "../store.ts";

// Module-level formatters keep AnimatedNumber from restarting its count on every render.
const compact = (n: number) => fmtCompact(n);
const whole = (n: number) => fmtNumber(n);
const pct1 = (n: number) => `${fmtNumber(n, 1)}%`;
/** Rupiah in trillions or billions, the sizes a province budget is read in. */
const rupiah = (n: number) =>
  n <= 0 ? "Rp 0" : n >= 1e12 ? `Rp ${fmtNumber(n / 1e12, 1)} triliun` : `Rp ${fmtNumber(n / 1e9, 1)} miliar`;

const slide = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0, transition: { duration: DURATION.panel, ease: EASE_OUT } },
  exit: { opacity: 0, x: 16, transition: { duration: DURATION.exit, ease: EASE_IN } },
};

type Mode = "twin" | "scenario" | "potential";

const MODES: { key: Mode; label: string; Icon: typeof Clock }[] = [
  { key: "twin", label: "Digital twin", Icon: Clock },
  { key: "scenario", label: "Skenario PLTS atap", Icon: Sun },
  { key: "potential", label: "Potensi EBT", Icon: MapPin },
];

/**
 * The menu of the province views that open in the left sheet: the digital twin's day (TwinView), the rooftop
 * solar scenario (ScenarioView) and the renewable potential map (PotentialView). Top right and always in view
 * while that side is free (no building panel, chat closed): the open view is marked, another one switches
 * to it, and the open one again closes it.
 */
export function ModeButtons() {
  const shown = useAppStore((s) => s.buildingStatus === "idle" && !s.chatOpen);
  const storyOpen = useAppStore((s) => s.story !== null);
  const user = useAppStore((s) => s.user);
  const homeOpen = useAppStore((s) => s.homeOpen);
  const pemdaOpen = useAppStore((s) => s.pemdaOpen);
  const active = useAppStore((s): Mode | null => (s.twinOpen ? "twin" : s.scenarioOpen ? "scenario" : s.potentialOpen ? "potential" : null));
  const choose = (mode: Mode) => {
    const s = useAppStore.getState();
    const open = mode !== active;
    // A region in the sheet gives way, so the chosen view shows.
    if (open && s.selectedRegionId !== null) s.selectRegion(null);
    if (mode === "twin") s.setTwinOpen(open);
    else if (mode === "scenario") s.setScenarioOpen(open);
    else s.setPotentialOpen(open);
  };
  return (
    <div className="scenario-slot">
      <AnimatePresence initial={false}>
        {shown && (
          <motion.div key="buttons" className="scenario-slot__buttons" role="toolbar" aria-label="Mode peta" {...slide}>
            {/* The guided story comes first: the way in for someone who has never seen the map. */}
            <Button
              variant="primary"
              size="sm"
              className="scenario-open scenario-open--story"
              data-active={storyOpen || undefined}
              aria-pressed={storyOpen}
              // A signed-in account goes straight to its own track; a guest chooses one.
              onPress={() => useAppStore.getState().setStory(storyOpen ? null : { track: user?.role ?? null, step: 0 })}
            >
              <BookOpen aria-hidden />
              {user ? "Panduan" : "Alur cerita"}
            </Button>
            {user?.role === "warga" && (
              <Button
                variant="outline"
                size="sm"
                className="scenario-open"
                data-active={homeOpen || undefined}
                aria-pressed={homeOpen}
                onPress={() => {
                  const s = useAppStore.getState();
                  if (!homeOpen && s.selectedRegionId !== null) s.selectRegion(null);
                  s.setHomeOpen(!homeOpen);
                }}
              >
                <House aria-hidden />
                Rumah saya
              </Button>
            )}
            {user?.role === "pemda" && (
              <Button
                variant="outline"
                size="sm"
                className="scenario-open"
                data-active={pemdaOpen || undefined}
                aria-pressed={pemdaOpen}
                onPress={() => {
                  const s = useAppStore.getState();
                  if (!pemdaOpen && s.selectedRegionId !== null) s.selectRegion(null);
                  s.setPemdaOpen(!pemdaOpen);
                }}
              >
                <ChartColumn aria-hidden />
                Dasbor pemda
              </Button>
            )}
            {MODES.map(({ key, label, Icon }) => (
              <Button
                key={key}
                variant="outline"
                size="sm"
                className="scenario-open"
                data-active={key === active || undefined}
                aria-pressed={key === active}
                onPress={() => choose(key)}
              >
                <Icon aria-hidden />
                {label}
              </Button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The scenario in the left sheet: a slider sets the share of each region's electricity that comes from
 * panels on its own roofs, the CO2 columns sink by what that avoids, and the sheet counts the CO2, the
 * capacity and the cost. The numbers come from shared/scenario.ts.
 */
export function ScenarioView({ regions }: { regions: RegionSummary[] }) {
  return (
    <I18nProvider locale="id-ID">
      <ScenarioBody regions={regions} />
    </I18nProvider>
  );
}

function ScenarioBody({ regions }: { regions: RegionSummary[] }) {
  const [basis, setBasis] = useState<ScenarioBasis | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const share = useAppStore((s) => s.scenarioShare);
  const setShare = useAppStore((s) => s.setScenarioShare);
  const setScale = useAppStore((s) => s.setScenarioScale);
  const setOpen = useAppStore((s) => s.setScenarioOpen);

  const load = useCallback(() => {
    setFailed(null);
    let live = true;
    api
      .scenario()
      .then((b) => live && setBasis(b))
      .catch((err: unknown) => live && setFailed(err instanceof Error ? err.message : "Data skenario gagal dimuat."));
    return () => {
      live = false;
    };
  }, []);
  useEffect(load, [load]);

  const result = useMemo(() => (basis ? rooftopScenario(regions, basis, share) : null), [basis, regions, share]);
  // The columns follow the slider while the scenario is open; closing it (setScenarioOpen) lets them rise back.
  useEffect(() => {
    if (result) setScale(scenarioScale(result, regions));
  }, [result, regions, setScale]);

  const drop = result && result.co2BeforeKgYear > 0 ? (result.co2AvoidedKgYear / result.co2BeforeKgYear) * 100 : 0;

  return (
    <div className="sheet__body scenario" role="region" aria-label="Skenario PLTS atap">
      <Button variant="ghost" size="sm" className="back" onPress={() => setOpen(false)}>
        <ChevronLeft aria-hidden />
        Semua wilayah
      </Button>
      <h2 className="place">Skenario PLTS atap</h2>
      <p className="place__meta scenario__lede">Bagaimana jika sebagian listrik tiap wilayah dipasok panel surya di atap gedungnya sendiri?</p>

      <Slider
        className="scenario__slider"
        value={Math.round(share * 100)}
        minValue={0}
        maxValue={SCENARIO_MAX_SHARE * 100}
        step={1}
        formatOptions={{ style: "unit", unit: "percent" }}
        onChange={(v) => setShare((Array.isArray(v) ? (v[0] ?? 0) : v) / 100)}
      >
        <Label>Listrik dari PLTS atap</Label>
        <Slider.Output />
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>

      {failed ? (
        <div className="scenario__failure" role="alert">
          <p>{failed}</p>
          <Button size="sm" onPress={load}>
            Coba lagi
          </Button>
        </div>
      ) : !result || !basis ? (
        <div className="scenario__loading" aria-busy>
          <Skeleton className="scenario__skeleton scenario__skeleton--big" />
          <Skeleton className="scenario__skeleton" />
          <Skeleton className="scenario__skeleton" />
        </div>
      ) : (
        <>
          <div className="readout">
            <p className="readout__label">{chem("Emisi CO2 yang dihindari")}</p>
            <p className="readout__figure">
              <AnimatedNumber value={result.co2AvoidedKgYear / 1000} format={compact} />
            </p>
            <p className="readout__unit">
              {chem("ton CO2 per tahun")}, <Estimate />
            </p>
          </div>
          <div className="share">
            <p className="share__text">
              <AnimatedNumber value={drop} format={pct1} className="share__pct" /> {chem("dari emisi listrik Kaltim")},{" "}
              <span className="num">{fmtCompact(result.co2AfterKgYear / 1000)}</span> {chem("ton CO2 tersisa")}
            </p>
            <div className="share__track" aria-hidden>
              <motion.div
                className="share__bar scenario__bar"
                initial={false}
                animate={{ scaleX: drop / 100 }}
                transition={{ duration: DURATION.bar, ease: EASE_OUT }}
              />
            </div>
          </div>
          <dl className="facts">
            <ScenarioFact label="Kapasitas panel" unit="MWp">
              <AnimatedNumber value={result.kWp / 1000} format={whole} />
            </ScenarioFact>
            <ScenarioFact label="Listrik surya" unit="GWh per tahun">
              <AnimatedNumber value={result.solarKwhYear / 1e6} format={whole} />
            </ScenarioFact>
            <ScenarioFact label="Biaya pasang" unit="sekali bayar">
              <AnimatedNumber value={result.costRp} format={rupiah} />
            </ScenarioFact>
            <ScenarioFact label="Porsi surya di Kaltim" unit={`dari ${fmtNumber(basis.gridSolarShare * 100)}% sekarang`}>
              <AnimatedNumber value={result.solarShareAfter * 100} format={pct1} />
            </ScenarioFact>
          </dl>
          <footer className="sheet__foot">
            <p className="sheet__note">Kolom di peta turun sebesar emisi yang dihindari tiap wilayah. Geser untuk membandingkan.</p>
            <p className="sheet__source">
              {chem(
                `Hanya listrik yang dipakai sendiri di gedung. Jam matahari NASA POWER per wilayah, faktor emisi PLTS ${fmtNumber(basis.solarFactorKgPerKwh, 2)} kg CO2 per kWh (Kepmen ESDM 163.K/2021), biaya Rp ${fmtNumber(basis.costRpPerKwp / 1e6)} jt per kWp.`,
              )}
            </p>
          </footer>
        </>
      )}
    </div>
  );
}

function ScenarioFact({ label, unit, children }: { label: string; unit: string; children: ReactNode }) {
  return (
    <div className="fact">
      <dt className="fact__label">{label}</dt>
      <dd className="fact__value">
        <span className="fact__number">{children}</span>
        <span className="fact__unit">
          {unit}, <Estimate />
        </span>
      </dd>
    </div>
  );
}
