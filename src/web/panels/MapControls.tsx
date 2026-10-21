import { Card } from "@heroui/react";
import type { Map as MapboxMap } from "mapbox-gl";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { LayerSwitch } from "../components/LayerSwitch.tsx";
import { Segmented } from "../components/Segmented.tsx";
import { nextRainMode, rainNote, rainVisible } from "../map/autoRain.ts";
import { LIGHT_NOTE, type LightOption, lightModeFor, lightOption } from "../map/effects.ts";
import { DURATION } from "../motion.ts";
import { linkedLightMode, useAppStore } from "../store.ts";

/**
 * The presenter's light switch. Otomatis is the light the page chooses itself: the time of day in WITA, or
 * the dawn or dusk a `?cahaya=` link asked for (they have no button of their own).
 */
const LIGHTS: { key: LightOption; label: string }[] = [
  { key: "auto", label: "Otomatis" },
  { key: "day", label: "Siang" },
  { key: "night", label: "Malam" },
];
const linkedNote = linkedLightMode === "auto" ? undefined : LIGHT_NOTE[linkedLightMode];
/** What Otomatis follows, as its tooltip. */
const AUTO_TITLE = linkedNote ? `Cahaya ${linkedNote}, sesuai tautan` : "Mengikuti jam di Kalimantan Timur (WITA)";

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

/** The map controls card: the data layers, then the scene (light and rain). */
export function MapControls() {
  const layers = useAppStore((s) => s.layers);
  const setLayer = useAppStore((s) => s.setLayer);
  const rain = useAppStore((s) => s.rain);
  const liveRain = useAppStore((s) => s.liveRain);
  const setRain = useAppStore((s) => s.setRain);
  const chosenLight = useAppStore((s) => lightOption(s.lightMode));
  // Dawn and dusk show as Otomatis; the label then names the light: "Cahaya fajar", "Cahaya senja".
  const lightNote = useAppStore((s) => LIGHT_NOTE[s.lightPreset]);
  const setLightMode = useAppStore((s) => s.setLightMode);
  const zoom = useMapZoom(useAppStore((s) => s.map));
  const rainHint = rainNote({ rain, liveRain }, zoom);

  return (
    <Card className="controls" role="region" aria-label="Lapisan dan suasana peta">
      <div className="controls__row" role="group" aria-labelledby="controls-layers">
        <span className="group-label" id="controls-layers">
          Lapisan
        </span>
        <div className="controls__items">
          <LayerSwitch label="Wilayah" on={layers.regions} onChange={(v) => setLayer("regions", v)} />
          <LayerSwitch label="Pembangkit" on={layers.plants} onChange={(v) => setLayer("plants", v)} />
        </div>
      </div>
      <div className="controls__row" role="group" aria-label="Suasana peta">
        <span className="group-label" id="controls-light">
          {lightNote ? `Cahaya ${lightNote}` : "Cahaya"}
        </span>
        <div className="controls__items">
          <Segmented
            labelledBy="controls-light"
            options={LIGHTS.map((l) => ({ key: l.key, label: l.label, title: l.key === "auto" ? AUTO_TITLE : undefined }))}
            value={chosenLight}
            onChange={(key) => setLightMode(lightModeFor(key, linkedLightMode))}
            indicatorId="light-indicator"
          />
          <LayerSwitch label="Hujan" on={rainVisible({ rain, liveRain })} onChange={(v) => setRain(nextRainMode(v, liveRain?.raining === true))} />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {rainHint && (
          <motion.p
            key={rainHint}
            className="layer__hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: DURATION.panel } }}
            exit={{ opacity: 0, transition: { duration: DURATION.exit } }}
          >
            {rainHint}
          </motion.p>
        )}
      </AnimatePresence>
    </Card>
  );
}
