import { Button, Label, NumberField, Skeleton, Slider } from "@heroui/react";
import { motion } from "motion/react";
import { type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fmtNumber, fmtRupiah } from "../../shared/format.ts";
import { api, type SolarSimulation } from "../api.ts";
import { AnimatedNumber } from "../components/AnimatedNumber.tsx";
import { chem } from "../components/Chem.tsx";
import { Estimate } from "../components/Estimate.tsx";
import { DURATION, EASE_OUT } from "../motion.ts";
import { useAppStore } from "../store.ts";
import type { BuildingTabProps } from "./buildingTabs.ts";
import { BACKUP, defaultSolarRequest, niceScale, ROOF_MAX_M2, ROOF_MIN_M2, tickText } from "./solarWeather.ts";

/** Wait this long after the last input change before asking the server again. */
const INPUT_DEBOUNCE_MS = 150;
const ROOF_STEP_M2 = 5;
/** Panel size the server assumes (shared/solar.ts PANEL_KWP). */
const PANEL_WP = 550;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTH_NAMES = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// Module-level formatters keep AnimatedNumber from restarting its count on every render.
const whole = (n: number) => fmtNumber(n);
const oneDecimal = (n: number) => fmtNumber(n, 1);
const pct = (n: number) => `${fmtNumber(n)}%`;
const rupiah = (n: number) => fmtRupiah(n);

/**
 * The Surya tab: rooftop solar for the selected building. Roof area (prefilled with the footprint) and
 * battery backup hours drive POST /api/solar/simulate; the result shows how much of the building's need
 * the panels cover, what it costs and saves, and the sun over the year at this spot (NASA POWER).
 */
export function SolarTab(props: BuildingTabProps) {
  // A new building starts from its own footprint; type or floor changes keep the roof the user set.
  return <SolarSimulator key={props.building.featureId} {...props} />;
}

function SolarSimulator({ building, at }: BuildingTabProps) {
  const initial = defaultSolarRequest(building, at);
  const [roof, setRoof] = useState(initial.roofAreaM2);
  const [backup, setBackup] = useState<number>(BACKUP.initial);
  const [result, setResult] = useState<SolarSimulation | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const setSolarSizing = useAppStore((s) => s.setSolarSizing);
  const [lng, lat] = at;
  const kwhYear = building.kwhYear;
  const featureId = building.featureId;

  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () => {
        api
          .simulateSolar({ lat, lng, roofAreaM2: roof, kwhYear, backupHours: backup })
          .then((r) => {
            if (!live) return;
            setResult(r);
            setFailure(null);
            setSolarSizing({ featureId, kWp: r.kWp });
          })
          .catch((err: unknown) => {
            if (live) setFailure(err instanceof Error ? err.message : "Simulasi surya gagal.");
          });
      },
      // The first request goes out at once; changes from the inputs wait for the user to settle.
      result ? INPUT_DEBOUNCE_MS : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `result` only picks the delay; a new result must not ask again, so it is not a dependency.
  }, [lat, lng, roof, kwhYear, backup, featureId, attempt, setSolarSizing]);

  return (
    <div className="sw-tab sw-solar">
      <div className="sw-solar__inputs">
        <NumberField
          className="sw-solar__roof"
          variant="secondary"
          value={roof}
          minValue={ROOF_MIN_M2}
          maxValue={ROOF_MAX_M2}
          step={ROOF_STEP_M2}
          formatOptions={{ maximumFractionDigits: 0 }}
          onChange={(v) => {
            if (v !== undefined && Number.isFinite(v)) setRoof(Math.min(ROOF_MAX_M2, Math.max(ROOF_MIN_M2, Math.round(v))));
          }}
        >
          <Label>Luas atap, m²</Label>
          <NumberField.Group>
            <NumberField.DecrementButton aria-label="Kurangi luas atap" />
            <NumberField.Input />
            <NumberField.IncrementButton aria-label="Tambah luas atap" />
          </NumberField.Group>
        </NumberField>
        <Slider
          className="sw-solar__backup"
          value={backup}
          minValue={BACKUP.min}
          maxValue={BACKUP.max}
          step={BACKUP.step}
          onChange={(v) => setBackup(Array.isArray(v) ? (v[0] ?? BACKUP.initial) : v)}
        >
          <Label>Cadangan baterai</Label>
          <Slider.Output>{({ state }) => `${state.values[0]} jam`}</Slider.Output>
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
      </div>

      {failure && !result ? (
        <TabFailure message={failure} what="Simulasi surya" onRetry={() => setAttempt((n) => n + 1)} />
      ) : !result ? (
        <SolarSkeleton />
      ) : (
        <SolarResultView result={result} demandKwh={kwhYear} stale={failure} />
      )}
    </div>
  );
}

function SolarResultView({ result, demandKwh, stale }: { result: SolarSimulation; demandKwh: number; stale: string | null }) {
  const co2Tonnes = result.co2AvoidedKgYear >= 1000;
  return (
    <div className="sw-solar__result" data-stale={stale ? "" : undefined}>
      {stale && <p className="sw-tab__warn">Angka terakhir masih ditampilkan: {stale}</p>}
      {result.kWp === 0 ? (
        <p className="sw-tab__empty">Atap ini terlalu kecil untuk dipasang panel surya. Coba perbesar luas atapnya.</p>
      ) : (
        <>
          <Coverage pctValue={result.coveragePct} />
          <Versus produced={result.kwhYear} needed={demandKwh} />
          <dl className="sw-facts">
            <TabFact label="Kapasitas panel" unit={`${fmtNumber(result.panels)} panel ${PANEL_WP} Wp`}>
              <AnimatedNumber value={result.kWp} format={oneDecimal} /> kWp
            </TabFact>
            <TabFact label="Baterai" unit="kWh, perkiraan">
              <AnimatedNumber value={result.batteryKwh} format={oneDecimal} />
            </TabFact>
            <TabFact label="Biaya pasang" unit="panel dan baterai, perkiraan">
              <AnimatedNumber value={result.costRp} format={rupiah} />
            </TabFact>
            <TabFact label="Hemat listrik" unit="per tahun, perkiraan">
              <AnimatedNumber value={result.savingRpYear} format={rupiah} />
            </TabFact>
            <TabFact label="Balik modal" unit="tahun, perkiraan">
              <AnimatedNumber value={result.paybackYears} format={oneDecimal} />
            </TabFact>
            <TabFact label="CO2 dihindari" unit={`${co2Tonnes ? "ton" : "kg"} CO2 per tahun, perkiraan`}>
              <AnimatedNumber value={co2Tonnes ? result.co2AvoidedKgYear / 1000 : result.co2AvoidedKgYear} format={co2Tonnes ? oneDecimal : whole} />
            </TabFact>
          </dl>
        </>
      )}
      <SunChart pshByMonth={result.pshByMonth} pshYear={result.peakSunHours} />
      <footer className="sw-tab__foot">
        {result.assumptions.map((a) => (
          <p key={a} className="sw-tab__note">
            {a}
          </p>
        ))}
        <p className="sw-tab__source">Sumber: radiasi matahari NASA POWER (rata-rata jangka panjang), tarif dan harga panel 2026.</p>
      </footer>
    </div>
  );
}

/** The share of the building's need the panels cover: a ring and the number beside it. */
function Coverage({ pctValue }: { pctValue: number }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  const share = Math.min(100, Math.max(0, pctValue)) / 100;
  return (
    <div className="sw-cover">
      <svg className="sw-cover__ring" viewBox="0 0 64 64" aria-hidden>
        <circle className="sw-cover__track" cx="32" cy="32" r={R} />
        <motion.circle
          className="sw-cover__arc"
          cx="32"
          cy="32"
          r={R}
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - share) }}
          transition={{ duration: DURATION.bar, ease: EASE_OUT }}
        />
      </svg>
      <div className="sw-cover__text">
        <p className="sw-cover__figure">
          <AnimatedNumber value={pctValue} format={pct} />
        </p>
        <p className="sw-cover__label">
          kebutuhan listrik gedung tertutup panel surya, <Estimate />
        </p>
      </div>
    </div>
  );
}

/** Yearly production against the building's yearly need, on one scale. */
function Versus({ produced, needed }: { produced: number; needed: number }) {
  const top = Math.max(produced, needed, 1);
  const rows = [
    { key: "solar", label: "Produksi panel", value: produced },
    { key: "demand", label: "Kebutuhan gedung", value: needed },
  ] as const;
  return (
    <div className="sw-versus" role="group" aria-label="Produksi panel dibanding kebutuhan gedung per tahun">
      {rows.map((r) => (
        <div key={r.key} className="sw-versus__row">
          <p className="sw-versus__label">
            <span className="sw-versus__key" data-series={r.key} aria-hidden />
            {r.label}
            <span className="sw-versus__value">
              <AnimatedNumber value={r.value} format={whole} /> kWh/tahun
            </span>
          </p>
          <div className="sw-versus__track" aria-hidden>
            <motion.div
              className="sw-versus__bar"
              data-series={r.key}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: r.value / top }}
              transition={{ duration: DURATION.bar, ease: EASE_OUT }}
            />
          </div>
        </div>
      ))}
      <p className="sw-versus__unit">
        kWh per tahun, <Estimate />
      </p>
    </div>
  );
}

/** Peak sun hours per month at this spot (NASA POWER): the reason output changes over the year. */
function SunChart({ pshByMonth, pshYear }: { pshByMonth: number[]; pshYear: number }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const [active, setActive] = useState<number | null>(null);
  const scale = niceScale(Math.max(...pshByMonth, 0));
  const H = 96;
  const AXIS = 28;
  const BOTTOM = 18;
  const plotW = Math.max(0, width - AXIS);
  const slot = plotW / 12;
  const barW = Math.min(14, slot * 0.6);
  const y = (v: number) => H - BOTTOM - (Math.max(0, v) / scale.max) * (H - BOTTOM - 6);
  const reading =
    active === null
      ? `Rata-rata setahun ${fmtNumber(pshYear, 1)} jam per hari`
      : `${MONTH_NAMES[active]}: ${fmtNumber(pshByMonth[active] ?? 0, 1)} jam per hari`;

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left - AXIS;
    setActive(x < 0 ? null : Math.min(11, Math.max(0, Math.floor(x / slot))));
  };
  const keys = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : -1;
    setActive((i) => (i === null ? (step > 0 ? 0 : 11) : (i + step + 12) % 12));
  };

  return (
    <section className="sw-chart" aria-labelledby="sun-chart-title">
      <h3 className="sw-chart__title" id="sun-chart-title">
        Jam matahari puncak per bulan
      </h3>
      <p className="sw-chart__reading num" aria-live="polite">
        {reading}
      </p>
      <div ref={box} className="sw-chart__box">
        {width > 0 && (
          <svg
            className="sw-chart__svg"
            width={width}
            height={H}
            role="img"
            aria-label={`Jam matahari puncak per bulan, ${pshByMonth.map((v, i) => `${MONTHS[i]} ${fmtNumber(v, 1)}`).join(", ")} jam per hari`}
            tabIndex={0}
            onPointerMove={pick}
            onPointerLeave={() => setActive(null)}
            onKeyDown={keys}
            onBlur={() => setActive(null)}
          >
            {scale.ticks.map((t) => (
              <g key={t}>
                <line className="sw-chart__grid" x1={AXIS} x2={width} y1={y(t)} y2={y(t)} />
                <text className="sw-chart__tick" x={AXIS - 6} y={y(t)} dy="0.32em" textAnchor="end">
                  {tickText(t)}
                </text>
              </g>
            ))}
            {pshByMonth.map((v, i) => {
              const x = AXIS + slot * i + (slot - barW) / 2;
              return (
                <g key={MONTHS[i]}>
                  <motion.rect
                    className="sw-chart__bar"
                    data-active={active === i ? "" : undefined}
                    x={x}
                    width={barW}
                    rx={2}
                    initial={{ y: y(0), height: 0 }}
                    animate={{ y: y(v), height: Math.max(0, y(0) - y(v)) }}
                    transition={{ duration: DURATION.bar, ease: EASE_OUT, delay: Math.min(i * 0.03, 0.3) }}
                  />
                  <text className="sw-chart__tick" data-active={active === i ? "" : undefined} x={x + barW / 2} y={H - 4} textAnchor="middle">
                    {MONTHS[i]}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <p className="sw-chart__unit">jam per hari, rata-rata jangka panjang</p>
    </section>
  );
}

/** One label and value of a tab, the same build as the region facts. */
export function TabFact({ label, unit, children }: { label: string; unit: string; children: ReactNode }) {
  return (
    <div className="sw-fact">
      <dt className="sw-fact__label">{chem(label)}</dt>
      <dd className="sw-fact__value">
        <span className="sw-fact__number">{children}</span>
        <span className="sw-fact__unit">{chem(unit)}</span>
      </dd>
    </div>
  );
}

/** What failed, in one sentence, and the way to try again (00-direction section 8). */
export function TabFailure({ message, what, onRetry }: { message: string; what: string; onRetry: () => void }) {
  return (
    <div className="sw-tab__failure" role="alert">
      <p className="sw-tab__failure-text">
        {what} belum bisa dimuat. {message}
      </p>
      <Button variant="outline" size="sm" onPress={onRetry}>
        Coba lagi
      </Button>
    </div>
  );
}

function SolarSkeleton() {
  return (
    <div className="sw-tab__skeleton" aria-busy="true" aria-label="Memuat simulasi surya">
      <div className="sw-tab__skeleton-row">
        <Skeleton animationType="none" className="sw-skeleton-ring" />
        <div className="sw-tab__skeleton-lines">
          <Skeleton animationType="none" className="sw-skeleton-line sw-skeleton-line--wide" />
          <Skeleton animationType="none" className="sw-skeleton-line" />
        </div>
      </div>
      <Skeleton animationType="none" className="sw-skeleton-line sw-skeleton-line--wide" />
      <Skeleton animationType="none" className="sw-skeleton-line sw-skeleton-line--wide" />
      <Skeleton animationType="none" className="sw-skeleton-block" />
    </div>
  );
}

/** The width of an element, kept up to date (charts draw at real pixels, not a scaled viewBox). */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
