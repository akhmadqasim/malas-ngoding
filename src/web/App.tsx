import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtCompact } from "../shared/format.ts";
import { api, type PlantCollection, type RegionCollection } from "./api.ts";
import { Intro } from "./components/Intro.tsx";
import { skipIntro } from "./map/camera.ts";
import { MapView } from "./map/MapView.tsx";
import type { RegionHover } from "./map/regionsLayer.ts";
import { Legend } from "./panels/Legend.tsx";
import { RegionPanel } from "./panels/RegionPanel.tsx";
import { useAppStore } from "./store.ts";

interface AppData {
  token: string;
  regions: RegionCollection;
  plants: PlantCollection;
}

type Phase = "loading" | "flying" | "done";

const ease = [0.16, 1, 0.3, 1] as const;

export function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [hover, setHover] = useState<RegionHover | null>(null);
  const metric = useAppStore((s) => s.metric);
  const regionList = useMemo(() => data?.regions.features.map((f) => f.properties) ?? [], [data]);

  const load = useCallback(() => {
    setFailure(null);
    Promise.all([api.config(), api.regions(), api.plants()])
      .then(([config, regions, plants]) => {
        if (!config.mapboxToken) throw new Error("Token Mapbox belum diisi di server (MAPBOX_TOKEN).");
        setData({ token: config.mapboxToken, regions, plants });
      })
      .catch((err: unknown) => setFailure(err instanceof Error ? err.message : "Data peta gagal dimuat."));
  }, []);
  useEffect(load, [load]);

  const onIntroStart = useCallback(() => setPhase("flying"), []);
  const onIntroEnd = useCallback(() => setPhase("done"), []);

  const showUi = phase === "done";

  return (
    <MotionConfig reducedMotion="user">
      <main className="app" data-metric={metric}>
        {data && (
          <MapView
            token={data.token}
            regions={data.regions}
            plants={data.plants}
            onIntroStart={onIntroStart}
            onIntroEnd={onIntroEnd}
            onRegionHover={setHover}
          />
        )}
        <div className="map-vignette" aria-hidden />

        <AnimatePresence>
          {showUi && data && (
            <motion.div key="ui" className="ui-layer" initial="hidden" animate="shown" variants={{ shown: { transition: { delayChildren: 0.55, staggerChildren: 0.12 } } }}>
              <motion.header className="brand" variants={reveal(-12, 0)}>
                <span className="brand__mark" aria-hidden />
                <div>
                  <div className="brand__name">Malas Ngoding</div>
                  <div className="brand__tag">Peta energi Kalimantan Timur</div>
                </div>
              </motion.header>
              <motion.div className="left-column" variants={reveal(0, -32)}>
                <RegionPanel regions={regionList} />
              </motion.div>
              <motion.div className="dock-slot" variants={reveal(24, 0)}>
                <Legend plants={data.plants} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {hover && showUi && (
          <div className="map-tooltip" style={{ transform: `translate(${hover.point.x + 16}px, ${hover.point.y + 16}px)` }}>
            <div className="map-tooltip__name">{hover.name}</div>
            <div className="map-tooltip__value">
              {metric === "co2" ? `${fmtCompact(hover.value / 1000)} ton CO2` : `${fmtCompact(hover.value)} kWh`} per tahun
              <span className="map-tooltip__note"> (perkiraan)</span>
            </div>
          </div>
        )}

        <Intro phase={failure ? "done" : phase} onSkip={skipIntro} />

        {failure && (
          <div className="failure glass" role="alert">
            <h2>Peta belum bisa ditampilkan</h2>
            <p>{failure}</p>
            <button type="button" className="button" onClick={load}>
              Coba lagi
            </button>
          </div>
        )}
      </main>
    </MotionConfig>
  );
}

function reveal(y: number, x: number) {
  return {
    hidden: { opacity: 0, y, x },
    shown: { opacity: 1, y: 0, x: 0, transition: { duration: 0.8, ease } },
  };
}
