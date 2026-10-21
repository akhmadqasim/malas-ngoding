import { Card } from "@heroui/react";
import { motion } from "motion/react";
import { type ReactNode, useMemo, useRef } from "react";
import { fmtCompact } from "../../shared/format.ts";
import type { RegionSummary } from "../../shared/types.ts";
import { chem } from "../components/Chem.tsx";
import { Estimate } from "../components/Estimate.tsx";
import { intensities } from "../map/regionsLayer.ts";
import { METRIC_TEXT } from "../metrics.ts";
import { DURATION, SPRING } from "../motion.ts";
import { Segmented } from "../components/Segmented.tsx";
import { type Metric, useAppStore } from "../store.ts";

const METRICS: { key: Metric; label: string }[] = [
  { key: "co2", label: "Emisi CO2" },
  { key: "kwh", label: "Listrik" },
];

/**
 * The legend card: what the column heights and colours mean (the metric switch and the gauge). `more` is
 * the dock's disclosure trigger, set beside the unit (Dock.tsx); the plant fuel key sits with the layer
 * switches behind it (MapControls).
 */
export function Legend({ regions, more }: { regions: RegionSummary[]; more?: ReactNode }) {
  const metric = useAppStore((s) => s.metric);
  const setMetric = useAppStore((s) => s.setMetric);

  return (
    <Card className="legend" role="region" aria-label="Legenda peta">
      <div className="legend__head">
        <span className="group-label" id="legend-metric">
          Tinggi kolom
        </span>
        <Segmented
          labelledBy="legend-metric"
          options={METRICS.map((m) => ({ key: m.key, label: chem(m.label) }))}
          value={metric}
          onChange={setMetric}
          indicatorId="metric-indicator"
        />
      </div>

      <Meter metric={metric} regions={regions} more={more} />
    </Card>
  );
}

/**
 * The legend scale as a meter: ramp, tick values and unit. Pointing at a region (map or list) swings
 * the needle to its value; a selected region keeps the needle when nothing is pointed at.
 */
function Meter({ metric, regions, more }: { metric: Metric; regions: RegionSummary[]; more?: ReactNode }) {
  const hoveredId = useAppStore((s) => s.hoveredRegionId);
  const selectedId = useAppStore((s) => s.selectedRegionId);
  const m = METRIC_TEXT[metric];
  const t = useMemo(() => intensities(regions, metric), [regions, metric]);
  const max = Math.max(...regions.map(m.value), 1);
  const activeId = hoveredId ?? selectedId;
  const active = activeId ? regions.find((r) => r.id === activeId) : undefined;
  // When the needle fades out it stays where it was, so it never slides back to zero.
  const position = useRef(0);
  if (active) position.current = t.get(active.id) ?? 0;

  return (
    <div className="gauge">
      <p className="gauge__reading">
        {active ? (
          <>
            <span className="gauge__name">{active.name}</span> <span className="num">{fmtCompact(m.value(active) * m.scale)}</span>
          </>
        ) : (
          <span className="gauge__hint">Arahkan ke wilayah</span>
        )}
      </p>
      <div className="gauge__scale">
        <div className="gauge__ramp" />
        <motion.div
          className="gauge__needle"
          initial={false}
          animate={{ left: `${position.current * 100}%`, opacity: active ? 1 : 0 }}
          transition={{ left: SPRING.needle, opacity: { duration: DURATION.exit } }}
          aria-hidden
        />
      </div>
      {/* The scale is a square root (like the column heights), so the middle tick is a quarter of the top. */}
      <div className="gauge__ticks num" aria-hidden>
        <span className="gauge__tick gauge__tick--start">0</span>
        <span className="gauge__tick gauge__tick--mid">{fmtCompact((max / 4) * m.scale)}</span>
        <span className="gauge__tick gauge__tick--end">{fmtCompact(max * m.scale)}</span>
      </div>
      <div className="gauge__foot">
        <p className="gauge__unit">
          {chem(m.unit)}, <Estimate />
        </p>
        {more}
      </div>
    </div>
  );
}
