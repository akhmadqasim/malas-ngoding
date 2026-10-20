import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useMemo } from "react";
import { fmtCompact, fmtNumber } from "../../shared/format.ts";
import type { RegionSummary } from "../../shared/types.ts";
import { AnimatedNumber } from "../components/AnimatedNumber.tsx";
import { Badge } from "../components/Badge.tsx";
import { intensities, RAMPS } from "../map/regionsLayer.ts";
import { type Metric, useAppStore } from "../store.ts";

interface Props {
  regions: RegionSummary[];
}

// Module-level formatters keep AnimatedNumber from restarting its count on every render.
const compact = (n: number) => fmtCompact(n);
const whole = (n: number) => fmtNumber(n);
const pct = (n: number) => `${fmtNumber(n, 1)}%`;

const METRIC_TEXT: Record<Metric, { value: (r: RegionSummary) => number; unit: string; scale: number; label: string }> = {
  co2: { value: (r) => r.co2KgYear, unit: "ton CO2 per tahun", scale: 1 / 1000, label: "Emisi CO2" },
  kwh: { value: (r) => r.kwhYear, unit: "kWh per tahun", scale: 1, label: "Listrik terpakai" },
};

const ease = [0.16, 1, 0.3, 1] as const;

/** Colour of a region on the map, so list bars and columns match. */
function rampColor(metric: Metric, t: number): string {
  const ramp = RAMPS[metric];
  return ramp[Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1)))]!;
}

export function RegionPanel({ regions }: Props) {
  const selectedId = useAppStore((s) => s.selectedRegionId);
  const metric = useAppStore((s) => s.metric);
  const selectRegion = useAppStore((s) => s.selectRegion);
  const selected = regions.find((r) => r.id === selectedId) ?? null;

  return (
    <section className="glass region-panel" aria-label="Data wilayah">
      <AnimatePresence mode="wait" initial={false}>
        {selected ? (
          <motion.div
            key={selected.id}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.45, ease }}
          >
            <RegionDetail region={selected} regions={regions} metric={metric} onBack={() => selectRegion(null)} />
          </motion.div>
        ) : (
          <motion.div
            key="overview"
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.45, ease }}
          >
            <Overview regions={regions} metric={metric} onPick={selectRegion} />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function Overview({ regions, metric, onPick }: { regions: RegionSummary[]; metric: Metric; onPick: (id: string) => void }) {
  const m = METRIC_TEXT[metric];
  const total = regions.reduce((sum, r) => sum + m.value(r), 0);
  const ranked = useMemo(() => [...regions].sort((a, b) => m.value(b) - m.value(a)), [regions, m]);
  const t = useMemo(() => intensities(regions, metric), [regions, metric]);
  const max = Math.max(...regions.map(m.value), 1);

  return (
    <div className="region-panel__body">
      <header className="region-panel__head">
        <h2 className="region-panel__title">Kalimantan Timur</h2>
        <p className="region-panel__kind">10 kabupaten dan kota</p>
      </header>

      <div className="hero-figure">
        <div className="hero-figure__label">
          {m.label} se-provinsi <Badge />
        </div>
        <div className="hero-figure__value">
          <AnimatedNumber value={total * m.scale} format={compact} />
        </div>
        <div className="hero-figure__unit">{m.unit}</div>
      </div>

      <ol className="rank" aria-label={`Wilayah menurut ${m.label.toLowerCase()}`}>
        {ranked.map((r, i) => (
          <motion.li
            key={r.id}
            layout
            transition={{ layout: { duration: 0.5, ease } }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.04 * i, duration: 0.4, ease } }}
          >
            <button type="button" className="rank__row" onClick={() => onPick(r.id)}>
              <span className="rank__name">{r.name}</span>
              <span className="rank__value tabular-nums">{fmtCompact(m.value(r) * m.scale)}</span>
              <span className="rank__track" aria-hidden>
                <motion.span
                  className="rank__bar"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: m.value(r) / max, backgroundColor: rampColor(metric, t.get(r.id) ?? 0) }}
                  transition={{ duration: 0.9, delay: 0.05 * i, ease }}
                />
              </span>
            </button>
          </motion.li>
        ))}
      </ol>
      <p className="region-panel__hint">Pilih wilayah di peta atau di daftar untuk melihat rinciannya.</p>
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

  return (
    <div className="region-panel__body">
      <button type="button" className="back-link" onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Semua wilayah
      </button>
      <header className="region-panel__head">
        <h2 className="region-panel__title">{region.name}</h2>
        <p className="region-panel__kind">{region.kind === "kota" ? "Kota" : "Kabupaten"}</p>
      </header>

      <div className="hero-figure">
        <div className="hero-figure__label">
          {m.label} <Badge />
        </div>
        <div className="hero-figure__value">
          <AnimatedNumber value={m.value(region) * m.scale} format={compact} />
        </div>
        <div className="hero-figure__unit">{m.unit}</div>
      </div>

      <div className="share">
        <div className="share__text">
          <AnimatedNumber value={share} format={pct} className="share__pct" /> dari listrik terpakai di Kaltim
        </div>
        <div className="share__track" aria-hidden>
          <motion.div className="share__bar" initial={{ scaleX: 0 }} animate={{ scaleX: share / 100 }} transition={{ duration: 1, ease }} />
        </div>
      </div>

      <dl className="stats">
        <Stat label={metric === "co2" ? "Listrik terpakai" : "Emisi CO2"} estimate>
          {metric === "co2" ? (
            <>
              <AnimatedNumber value={region.kwhYear} format={compact} /> <small>kWh/tahun</small>
            </>
          ) : (
            <>
              <AnimatedNumber value={region.co2KgYear / 1000} format={compact} /> <small>ton/tahun</small>
            </>
          )}
        </Stat>
        <Stat label="Listrik per orang" estimate>
          {perPerson === null ? <NoData /> : (
            <>
              <AnimatedNumber value={perPerson} format={whole} /> <small>kWh/tahun</small>
            </>
          )}
        </Stat>
        <Stat label="Penduduk">
          {region.population === null ? <NoData /> : <AnimatedNumber value={region.population} format={whole} />}
        </Stat>
        <Stat label="Pelanggan PLN">
          {region.customers === null ? <NoData /> : <AnimatedNumber value={region.customers} format={whole} />}
        </Stat>
        <Stat label="Rasio elektrifikasi">
          {region.electrificationPct === null ? <NoData /> : <AnimatedNumber value={region.electrificationPct} format={pct} />}
        </Stat>
        <Stat label="Desa belum dilayani PLN">
          {region.villagesNoPln === null ? <NoData /> : <AnimatedNumber value={region.villagesNoPln} format={whole} />}
        </Stat>
      </dl>
      <p className="region-panel__hint">
        Listrik terpakai diperkirakan dari penjualan PLN 2024 per cabang, dibagi menurut jumlah pelanggan. Emisi CO2 = kWh
        dikali faktor emisi jaringan Kaltim.
      </p>
    </div>
  );
}

function Stat({ label, estimate, children }: { label: string; estimate?: boolean; children: ReactNode }) {
  return (
    <div className="stat">
      <dt>
        {label}
        {estimate && <Badge />}
      </dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

const NoData = () => <span className="stat__none">Belum ada data</span>;
