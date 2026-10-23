import { ChevronLeft } from "../icons.ts";
import { Button, Card, Disclosure } from "@heroui/react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, type RefObject, useEffect, useMemo, useRef } from "react";
import { fmtCompact, fmtNumber } from "../../shared/format.ts";
import type { RegionSummary } from "../../shared/types.ts";
import { AnimatedNumber } from "../components/AnimatedNumber.tsx";
import { chem } from "../components/Chem.tsx";
import { Estimate } from "../components/Estimate.tsx";
import { useSessionFlag } from "../components/useSessionFlag.ts";
import { presetTone } from "../map/effects.ts";
import { intensities } from "../map/regionsLayer.ts";
import { METRIC_TEXT } from "../metrics.ts";
import { DURATION, EASE_IN, EASE_OUT, stagger } from "../motion.ts";
import { type Metric, useAppStore } from "../store.ts";
import { mixRamp, rampTokens } from "../theme.ts";
import { RecommendationPanel } from "./RecommendationPanel.tsx";
import { EmissionContext } from "./EmissionContext.tsx";
import { ScenarioView } from "./ScenarioPanel.tsx";
import { TwinView } from "./TwinPanel.tsx";
import { PotentialView } from "./PotentialPanel.tsx";
import { AccountControl } from "./AccountControl.tsx";
import { HomeView } from "./HomeView.tsx";
import { PemdaView } from "./PemdaView.tsx";

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
  const scenarioOpen = useAppStore((s) => s.scenarioOpen);
  const twinOpen = useAppStore((s) => s.twinOpen);
  const potentialOpen = useAppStore((s) => s.potentialOpen);
  const homeOpen = useAppStore((s) => s.homeOpen);
  const signedIn = useAppStore((s) => s.user !== null);
  const pemdaOpen = useAppStore((s) => s.pemdaOpen);
  const selected = regions.find((r) => r.id === selectedId) ?? null;
  // The list bars grow only the first time the overview appears; coming back should not replay it.
  const overviewShown = useRef(false);
  const growBars = !overviewShown.current;
  if (!selected) overviewShown.current = true;
  // "Semua wilayah" unmounts while it has focus; the list takes focus back on the row just left.
  const returnTo = useRef<string | null>(null);
  const back = () => {
    returnTo.current = selected?.id ?? null;
    selectRegion(null);
  };

  return (
    <Card className="sheet" role="region" aria-label="Data wilayah">
      <header className="sheet__masthead">
        <span className="sheet__brand">Malas Ngoding</span>
        {/* The span of the figures shown: emission factor 2019 data, PLN sales 2024, population projection
            2025, villages without PLN 2026. The detail view names the year of each figure. */}
        {/* Signed in, the account takes the edition's place: the masthead keeps one line. */}
        {!signedIn && <span className="sheet__edition">Data 2019–2026</span>}
        <AccountControl />
      </header>
      <div className="sheet__scroll">
        <AnimatePresence mode="wait" initial={false}>
          {selected ? (
            <motion.div key={selected.id} {...swap}>
              <RegionDetail region={selected} regions={regions} metric={metric} onBack={back} />
            </motion.div>
          ) : homeOpen ? (
            <motion.div key="home" {...swap}>
              <HomeView />
            </motion.div>
          ) : pemdaOpen ? (
            <motion.div key="pemda" {...swap}>
              <PemdaView regions={regions} />
            </motion.div>
          ) : potentialOpen ? (
            <motion.div key="potential" {...swap}>
              <PotentialView />
            </motion.div>
          ) : twinOpen ? (
            <motion.div key="twin" {...swap}>
              <TwinView regions={regions} />
            </motion.div>
          ) : scenarioOpen ? (
            <motion.div key="scenario" {...swap}>
              <ScenarioView regions={regions} />
            </motion.div>
          ) : (
            <motion.div key="overview" {...swap}>
              <Overview regions={regions} metric={metric} onPick={selectRegion} growBars={growBars} returnTo={returnTo} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Card>
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
  returnTo,
}: {
  regions: RegionSummary[];
  metric: Metric;
  onPick: (id: string) => void;
  growBars: boolean;
  /** The region just left with "Semua wilayah": its row takes the focus when the list comes back. */
  returnTo: RefObject<string | null>;
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
  // Focus handed back after "Semua wilayah" is not pointing: that row gets the focus ring but no preview.
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const quietFocus = useRef(false);
  useEffect(() => {
    const id = returnTo.current;
    returnTo.current = null;
    const row = id ? rows.current.get(id) : undefined;
    if (!row) return;
    quietFocus.current = true;
    row.focus();
    quietFocus.current = false;
  }, [returnTo]);

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
                ref={(el) => {
                  if (el) rows.current.set(r.id, el);
                  else rows.current.delete(r.id);
                }}
                type="button"
                className="ranking__row"
                data-active={hoveredId === r.id || undefined}
                onClick={() => onPick(r.id)}
                onPointerEnter={() => setHovered(r.id, "list")}
                // Leaving ends the preview only if no other row or the map took it over meanwhile.
                onPointerLeave={() => endListHover(r.id)}
                onFocus={() => {
                  if (!quietFocus.current) setHovered(r.id, "list");
                }}
                onBlur={() => endListHover(r.id)}
              >
                <span className="ranking__rank num" aria-hidden>
                  {i + 1}
                </span>
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
      <footer className="sheet__foot">
        <p className="sheet__note">Pilih wilayah untuk melihat rinciannya.</p>
        <p className="sheet__source">Sumber: BPS Kalimantan Timur dan Kementerian ESDM.</p>
      </footer>
      <EmissionContext co2KgYear={regions.reduce((sum, r) => sum + r.co2KgYear, 0)} compact />
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
      <Button variant="ghost" size="sm" className="back" onPress={onBack}>
        <ChevronLeft aria-hidden />
        Semua wilayah
      </Button>
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
        <Fact label="Penduduk" unit="jiwa, proyeksi 2025">
          {region.population === null ? null : <AnimatedNumber value={region.population} format={whole} />}
        </Fact>
        <Fact label="Pelanggan PLN" unit="data 2024">
          {region.customers === null ? null : <AnimatedNumber value={region.customers} format={whole} />}
        </Fact>
        <Fact label="Rasio elektrifikasi" unit="data 2024">
          {region.electrificationPct === null ? null : <AnimatedNumber value={region.electrificationPct} format={pct} />}
        </Fact>
        <Fact label="Desa belum dilayani PLN" unit="data 2026">
          {region.villagesNoPln === null ? null : <AnimatedNumber value={region.villagesNoPln} format={whole} />}
        </Fact>
      </dl>
      <MoreContext co2KgYear={region.co2KgYear} />
      <RecommendationPanel regionId={region.id} regionName={region.name} kind={region.kind} />
      <footer className="sheet__foot">
        <p className="sheet__note">
          {chem(
            "Perkiraan dari penjualan PLN 2024 per cabang dan faktor emisi ESDM. Rincian: Tentang peta ini, Cara menghitung dan sumber data.",
          )}
        </p>
      </footer>
    </div>
  );
}

/** The session key of the region sheet's "Asal listrik dan pembanding" disclosure. */
export const CONTEXT_OPEN_KEY = "malas:context-open";

/**
 * The grid mix and the equivalents of a region, folded away by default: the key figures stay above, and
 * the recommendations come into view sooner. The open or closed state holds for the session.
 */
function MoreContext({ co2KgYear }: { co2KgYear: number }) {
  const [open, setOpen] = useSessionFlag(CONTEXT_OPEN_KEY, false);
  return (
    <Disclosure className="more" isExpanded={open} onExpandedChange={setOpen}>
      <Disclosure.Heading className="more__heading">
        <Button slot="trigger" variant="ghost" size="sm" className="more__trigger">
          Asal listrik dan pembanding emisi
          <Disclosure.Indicator className="more__indicator" />
        </Button>
      </Disclosure.Heading>
      <Disclosure.Content className="more__content">
        <EmissionContext co2KgYear={co2KgYear} />
      </Disclosure.Content>
    </Disclosure>
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
