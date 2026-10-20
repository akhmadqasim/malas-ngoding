import { motion } from "motion/react";
import { type CSSProperties, type ReactNode, useMemo } from "react";
import type { PlantCollection } from "../api.ts";
import { FUEL_COLORS, FUEL_LABELS } from "../map/plantsLayer.ts";
import { RAMPS } from "../map/regionsLayer.ts";
import { type Metric, useAppStore } from "../store.ts";
import type { FuelType } from "../../shared/types.ts";
import { Badge } from "../components/Badge.tsx";

const METRICS: { key: Metric; label: string }[] = [
  { key: "co2", label: "Emisi CO2" },
  { key: "kwh", label: "Listrik" },
];

const RAMP_CAPTION: Record<Metric, string> = {
  co2: "Tinggi kolom dan warna: emisi CO2 per tahun",
  kwh: "Tinggi kolom dan warna: listrik terpakai per tahun",
};

/** Bottom dock: what the columns mean, the metric switch, and the layer switches. */
export function Legend({ plants }: { plants: PlantCollection }) {
  const metric = useAppStore((s) => s.metric);
  const setMetric = useAppStore((s) => s.setMetric);
  const layers = useAppStore((s) => s.layers);
  const setLayer = useAppStore((s) => s.setLayer);
  const rain = useAppStore((s) => s.rain);
  const setRain = useAppStore((s) => s.setRain);

  const fuels = useMemo(() => {
    const present = new Set(plants.features.map((f) => f.properties.fuel));
    return (Object.keys(FUEL_COLORS) as FuelType[]).filter((f) => present.has(f));
  }, [plants]);

  return (
    <section className="glass dock" aria-label="Legenda dan tampilan peta">
      <div className="dock__group">
        <div className="segmented" role="radiogroup" aria-label="Ukuran yang ditampilkan">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={metric === m.key}
              className="segmented__option"
              onClick={() => setMetric(m.key)}
            >
              {metric === m.key && (
                <motion.span layoutId="metric-pill" className="segmented__pill" transition={{ type: "spring", bounce: 0.18, duration: 0.5 }} />
              )}
              <span className="segmented__label">{m.label}</span>
            </button>
          ))}
        </div>
        <div className="ramp">
          <div className="ramp__caption">
            {RAMP_CAPTION[metric]} <Badge />
          </div>
          <div className="ramp__bar" style={{ background: `linear-gradient(90deg, ${RAMPS[metric].join(", ")})` }} />
          <div className="ramp__ends">
            <span>Rendah</span>
            <span>Tinggi</span>
          </div>
        </div>
      </div>

      <div className="dock__divider" aria-hidden />

      <div className="dock__group dock__group--layers">
        <LayerSwitch label="Wilayah" on={layers.regions} onChange={(v) => setLayer("regions", v)} />
        <LayerSwitch label="Pembangkit" on={layers.plants} onChange={(v) => setLayer("plants", v)}>
          <span className="fuels">
            {fuels.map((f) => (
              <span key={f} className="fuels__item">
                <span className={`fuels__dot fuels__dot--${f}`} style={{ "--fuel": FUEL_COLORS[f] } as CSSProperties} />
                {FUEL_LABELS[f]}
              </span>
            ))}
          </span>
        </LayerSwitch>
        <LayerSwitch label="Efek hujan" on={rain === "on"} onChange={(v) => setRain(v ? "on" : "auto")} />
      </div>
    </section>
  );
}

function LayerSwitch({
  label,
  on,
  onChange,
  children,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="layer-switch">
      <button type="button" role="switch" aria-checked={on} className="switch" onClick={() => onChange(!on)}>
        <span className="switch__track">
          <motion.span className="switch__thumb" animate={{ x: on ? 14 : 0 }} transition={{ type: "spring", bounce: 0.3, duration: 0.35 }} />
        </span>
        <span className="switch__label">{label}</span>
      </button>
      {children}
    </div>
  );
}

