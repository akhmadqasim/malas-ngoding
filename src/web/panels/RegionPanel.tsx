import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { fmtCompact, fmtNumber } from "../../shared/format.ts";
import type { RegionSummary } from "../../shared/types.ts";
import { AnimatedNumber } from "../components/AnimatedNumber.tsx";
import { chem } from "../components/Chem.tsx";
import { Estimate } from "../components/Estimate.tsx";
import { presetTone } from "../map/effects.ts";
import { intensities } from "../map/regionsLayer.ts";
import { METRIC_TEXT } from "../metrics.ts";
import { DURATION, EASE_IN, EASE_OUT, stagger } from "../motion.ts";
import { type Metric, useAppStore } from "../store.ts";
import { mixRamp, rampTokens } from "../theme.ts";

interface Props {
  regions: RegionSummary[];
}

// Module-level formatters keep AnimatedNumber from restarting its count on every render.
const compact = (n: number) => fmtCompact(n);
const whole = (n: number) => fmtNumber(n);
const pct = (n: number) => `${fmtNumber(n, 1)}%`;

/** Content swap inside the sheet: enter 240 ms, leave 180 ms, at most 12 px of travel. */
const swap = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0, transition: { duration: DURATION.panel, ease: EASE_OUT } },
  exit: { opacity: 0, x: -8, transition: { duration: DURATION.exit, ease: EASE_IN } },
};

/** The left sheet: title block, then Kalimantan Timur or the selected region. */
export function RegionPanel({ regions }: Props) {
  const selectedId = useAppStore((s) => s.selectedRegionId);
  const metric = useAppStore((s) => s.metric);
  const selectRegion = useAppStore((s) => s.selectRegion);
  const selected = regions.find((r) => r.id === selectedId) ?? null;
  // The list bars grow only the first time the overview appears; coming back should not replay it.
  const overviewShown = useRef(false);
  const growBars = !overviewShown.current;
  if (!selected) overviewShown.current = true;

  return (
    <section className="sheet" aria-label="Data wilayah">
      <header className="sheet__masthead">
        <span className="sheet__brand">Malas Ngoding</span>
        <span className="sheet__edition">Data 2024</span>
      </header>
      <div className="sheet__scroll">
        <AnimatePresence mode="wait" initial={false}>
          {selected ? (
            <motion.div key={selected.id} {...swap}>
              <RegionDetail region={selected} regions={regions} metric={metric} onBack={() => selectRegion(null)} />
            </motion.div>
          ) : (
            <motion.div key="overview" {...swap}>
              <Overview regions={regions} metric={metric} onPick={selectRegion} growBars={growBars} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function Readout({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="readout">
      <p className="readout__label">{chem(label)}</p>
      <p className="readout__figure">
        <AnimatedNumber value={value} format={compact} />
      </p>
      <p className="readout__unit">
        {chem(unit)}, <Estimate />
      </p>
    </div>
  );
}

function Overview({
  regions,
  metric,
  onPick,
  growBars,
}: {
  regions: RegionSummary[];
  metric: Metric;
  onPick: (id: string) => void;
  growBars: boolean;
}) {
  const m = METRIC_TEXT[metric];
  const hoveredId = useAppStore((s) => s.hoveredRegionId);
  const setHovered = useAppStore((s) => s.setHoveredRegion);
  const endListHover = useAppStore((s) => s.endListHover);
  const total = regions.reduce((sum, r) => sum + m.value(r), 0);
  const ranked = useMemo(() => [...regions].sort((a, b) => m.value(b) - m.value(a)), [regions, m]);
  const t = useMemo(() => intensities(regions, metric), [regions, metric]);
  const tone = useAppStore((s) => presetTone(s.lightPreset));
  const ramp = useMemo(() => rampTokens(metric, tone), [metric, tone]);
  const max = Math.max(...regions.map(m.value), 1);
  // A row that disappears while pointed at or focused (a pick swaps the list for the detail view) fires
  // no pointerleave or blur, so the list ends its own preview when it goes away.
  useEffect(() => () => useAppStore.getState().endListHover(), []);

  return (
    <div className="sheet__body">
      <h2 className="place">Kalimantan Timur</h2>
      <p className="place__meta">10 kabupaten dan kota</p>
      <Readout label={m.total} value={total * m.scale} unit={m.unit} />

      <div className="ranking">
        <p className="ranking__head">
          <span>Wilayah</span>
          <span>
            {chem(m.unitShort)}, <Estimate />
          </span>
        </p>
        <ol className="ranking__list" aria-label={`Wilayah menurut ${m.label}`}>
          {ranked.map((r, i) => (
            <li key={r.id}>
              <button
                type="button"
                className="ranking__row"
                data-active={hoveredId === r.id || undefined}
                onClick={() => onPick(r.id)}
                onPointerEnter={() => setHovered(r.id, "list")}
                // Leaving ends the preview only if no other row or the map took it over meanwhile.
                onPointerLeave={() => endListHover(r.id)}
                onFocus={() => setHovered(r.id, "list")}
                onBlur={() => endListHover(r.id)}
              >
                <span className="ranking__name">{r.name}</span>
                <span className="ranking__value num">{fmtCompact(m.value(r) * m.scale)}</span>
                <span className="ranking__track" aria-hidden>
                  <motion.span
                    className="ranking__bar"
                    style={{ backgroundColor: mixRamp(ramp, t.get(r.id) ?? 0) }}
                    initial={growBars ? { scaleX: 0 } : false}
                    animate={{ scaleX: m.value(r) / max }}
                    transition={{ duration: DURATION.bar, delay: growBars ? stagger(i) : 0, ease: EASE_OUT }}
                  />
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <p className="sheet__note">Pilih wilayah untuk melihat rinciannya.</p>
      <p className="sheet__source">Sumber: BPS Kalimantan Timur 2024 dan Kementerian ESDM.</p>
    </div>
  );
}

function RegionDetail({
  region,
  regions,
  metric,
  onBack,
}: {
  region: RegionSummary;
  regions: RegionSummary[];
  metric: Metric;
  onBack: () => void;
}) {
  const m = METRIC_TEXT[metric];
  const totalKwh = regions.reduce((sum, r) => sum + r.kwhYear, 0) || 1;
  const share = (region.kwhYear / totalKwh) * 100;
  const perPerson = region.population ? region.kwhYear / region.population : null;
  const other = metric === "co2" ? METRIC_TEXT.kwh : METRIC_TEXT.co2;

  return (
    <div className="sheet__body">
      <button type="button" className="back" onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Semua wilayah
      </button>
      <h2 className="place">{region.name}</h2>
      <p className="place__meta">{region.kind === "kota" ? "Kota" : "Kabupaten"}</p>
      <Readout label={m.label} value={m.value(region) * m.scale} unit={m.unit} />

      <div className="share">
        <p className="share__text">
          <AnimatedNumber value={share} format={pct} className="share__pct" /> dari listrik terpakai di Kaltim, <Estimate />
        </p>
        <div className="share__track" aria-hidden>
          <motion.div
            className="share__bar"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: share / 100 }}
            transition={{ duration: DURATION.bar, ease: EASE_OUT }}
          />
        </div>
      </div>

      <dl className="facts">
        <Fact label={other.label} unit={other.unitShort} estimate>
          <AnimatedNumber value={other.value(region) * other.scale} format={compact} />
        </Fact>
        <Fact label="Listrik per orang" unit="kWh/tahun" estimate>
          {perPerson === null ? null : <AnimatedNumber value={perPerson} format={whole} />}
        </Fact>
        <Fact label="Penduduk" unit="jiwa">
          {region.population === null ? null : <AnimatedNumber value={region.population} format={whole} />}
        </Fact>
        <Fact label="Pelanggan PLN">
          {region.customers === null ? null : <AnimatedNumber value={region.customers} format={whole} />}
        </Fact>
        <Fact label="Rasio elektrifikasi">
          {region.electrificationPct === null ? null : <AnimatedNumber value={region.electrificationPct} format={pct} />}
        </Fact>
        <Fact label="Desa belum dilayani PLN">
          {region.villagesNoPln === null ? null : <AnimatedNumber value={region.villagesNoPln} format={whole} />}
        </Fact>
      </dl>
      <p className="sheet__note">
        {chem(
          "Listrik terpakai diperkirakan dari penjualan PLN 2024 per cabang, dibagi menurut jumlah pelanggan. Emisi CO2 = kWh dikali faktor emisi jaringan Kaltim.",
        )}
      </p>
    </div>
  );
}

/** One label and value. With no value it says "Belum ada data" instead of showing a zero. */
function Fact({ label, unit, estimate, children }: { label: string; unit?: string; estimate?: boolean; children: ReactNode }) {
  return (
    <div className="fact">
      <dt className="fact__label">{chem(label)}</dt>
      <dd className="fact__value">
        {children === null ? (
          <span className="fact__none">Belum ada data</span>
        ) : (
          <>
            <span className="fact__number">{children}</span>
            {(unit || estimate) && (
              <span className="fact__unit">
                {unit && chem(unit)}
                {unit && estimate && ", "}
                {estimate && <Estimate />}
              </span>
            )}
          </>
        )}
      </dd>
    </div>
  );
}
