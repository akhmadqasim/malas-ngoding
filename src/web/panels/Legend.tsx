import type { Map as MapboxMap } from "mapbox-gl";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtCompact } from "../../shared/format.ts";
import type { RegionSummary } from "../../shared/types.ts";
import type { PlantCollection } from "../api.ts";
import { chem } from "../components/Chem.tsx";
import { Estimate } from "../components/Estimate.tsx";
import { type LightMode, RAIN_MIN_ZOOM } from "../map/effects.ts";
import { FUEL_LABELS, fuelsPresent } from "../map/fuels.ts";
import { intensities } from "../map/regionsLayer.ts";
import { METRIC_TEXT } from "../metrics.ts";
import { DURATION, SPRING } from "../motion.ts";
import { type Metric, useAppStore } from "../store.ts";

const METRICS: { key: Metric; label: string }[] = [
  { key: "co2", label: "Emisi CO2" },
  { key: "kwh", label: "Listrik" },
];

/** The presenter's light switch. Otomatis follows the time of day in WITA. */
const LIGHTS: { key: LightMode; label: string; title?: string }[] = [
  { key: "auto", label: "Otomatis", title: "Mengikuti jam di Kalimantan Timur (WITA)" },
  { key: "day", label: "Siang" },
  { key: "night", label: "Malam" },
];

/** The map's zoom, updated when a zoom gesture or camera move ends. */
function useMapZoom(map: MapboxMap | null): number {
  const [zoom, setZoom] = useState(() => map?.getZoom() ?? 0);
  useEffect(() => {
    if (!map) return;
    const update = () => setZoom(map.getZoom());
    update();
    map.on("zoomend", update);
    return () => {
      map.off("zoomend", update);
    };
  }, [map]);
  return zoom;
}

/** Bottom legend strip: what the columns mean (with the meter), the metric switch and the layers. */
export function Legend({ plants, regions }: { plants: PlantCollection; regions: RegionSummary[] }) {
  const metric = useAppStore((s) => s.metric);
  const setMetric = useAppStore((s) => s.setMetric);
  const layers = useAppStore((s) => s.layers);
  const setLayer = useAppStore((s) => s.setLayer);
  const rain = useAppStore((s) => s.rain);
  const setRain = useAppStore((s) => s.setRain);
  const lightMode = useAppStore((s) => s.lightMode);
  const setLightMode = useAppStore((s) => s.setLightMode);
  const map = useAppStore((s) => s.map);
  const zoom = useMapZoom(map);
  const fuels = useMemo(() => fuelsPresent(plants), [plants]);
  const rainHint = rain === "on" && zoom < RAIN_MIN_ZOOM;

  return (
    <section className="legend" aria-label="Legenda dan lapisan peta">
      <div className="legend__metric">
        <span className="legend__label" id="legend-metric">
          Tinggi kolom
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby="legend-metric">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={metric === m.key}
              className="segmented__option"
              onClick={() => setMetric(m.key)}
            >
              {metric === m.key && <motion.span layoutId="metric-indicator" className="segmented__indicator" transition={SPRING.control} />}
              <span className="segmented__label">{chem(m.label)}</span>
            </button>
          ))}
        </div>
      </div>

      <Meter metric={metric} regions={regions} />

      <div className="legend__layers" role="group" aria-label="Lapisan peta">
        <div className="layer">
          <Toggle label="Wilayah" on={layers.regions} onChange={(v) => setLayer("regions", v)} />
        </div>
        <div className="layer">
          <Toggle label="Pembangkit" on={layers.plants} onChange={(v) => setLayer("plants", v)} />
          <ul className="fuel-key" aria-label="Jenis pembangkit">
            {fuels.map((f) => (
              <li key={f}>
                <span className="fuel-dot" data-fuel={f} aria-hidden />
                {FUEL_LABELS[f]}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* The scene's atmosphere: light and rain. */}
      <div className="legend__scene" role="group" aria-label="Suasana peta">
        <span className="legend__label" id="legend-light">
          Cahaya
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby="legend-light">
          {LIGHTS.map((l) => (
            <button
              key={l.key}
              type="button"
              role="radio"
              aria-checked={lightMode === l.key}
              className="segmented__option"
              title={l.title}
              onClick={() => setLightMode(l.key)}
            >
              {lightMode === l.key && <motion.span layoutId="light-indicator" className="segmented__indicator" transition={SPRING.control} />}
              <span className="segmented__label">{l.label}</span>
            </button>
          ))}
        </div>
        <div className="legend__rain">
          <Toggle label="Hujan" on={rain === "on"} onChange={(v) => setRain(v ? "on" : "auto")} />
          <AnimatePresence initial={false}>
            {rainHint && (
              <motion.p
                key="rain-hint"
                className="layer__hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: DURATION.panel } }}
                exit={{ opacity: 0, transition: { duration: DURATION.exit } }}
              >
                Terlihat saat peta diperbesar sampai tingkat gedung.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

/**
 * The legend scale as a meter: ramp, tick values and unit. Pointing at a region (map or list) swings
 * the needle to its value; a selected region keeps the needle when nothing is pointed at.
 */
function Meter({ metric, regions }: { metric: Metric; regions: RegionSummary[] }) {
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
    <div className="meter">
      <p className="meter__reading">
        {active ? (
          <>
            <span className="meter__name">{active.name}</span> <span className="num">{fmtCompact(m.value(active) * m.scale)}</span>
          </>
        ) : (
          <span className="meter__hint">Arahkan ke wilayah</span>
        )}
      </p>
      <div className="meter__scale">
        <div className="meter__ramp" />
        <motion.div
          className="meter__needle"
          initial={false}
          animate={{ left: `${position.current * 100}%`, opacity: active ? 1 : 0 }}
          transition={{ left: SPRING.needle, opacity: { duration: DURATION.exit } }}
          aria-hidden
        />
      </div>
      {/* The scale is a square root (like the column heights), so the middle tick is a quarter of the top. */}
      <div className="meter__ticks num" aria-hidden>
        <span className="meter__tick meter__tick--start">0</span>
        <span className="meter__tick meter__tick--mid">{fmtCompact((max / 4) * m.scale)}</span>
        <span className="meter__tick meter__tick--end">{fmtCompact(max * m.scale)}</span>
      </div>
      <p className="meter__unit">
        {chem(m.unit)}, <Estimate />
      </p>
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="toggle" onClick={() => onChange(!on)}>
      <span className="toggle__track" aria-hidden>
        <motion.span className="toggle__thumb" initial={false} animate={{ x: on ? 12 : 0 }} transition={SPRING.control} />
      </span>
      <span className="toggle__label">{label}</span>
    </button>
  );
}
