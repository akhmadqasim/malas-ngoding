import { Button, Card } from "@heroui/react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { type Ref, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fmtCompact } from "../shared/format.ts";
import type { RegionSummary } from "../shared/types.ts";
import { api, type PlantCollection, type RegionCollection } from "./api.ts";
import { ChatPanel } from "./chat/ChatPanel.tsx";
import { chem } from "./components/Chem.tsx";
import { Estimate } from "./components/Estimate.tsx";
import { Intro } from "./components/Intro.tsx";
import { Landing } from "./components/Landing.tsx";
import { PlaceHint } from "./components/PlaceHint.tsx";
import { goToPlace } from "./map/goToPlace.ts";
import { AccountDialog } from "./panels/AccountDialog.tsx";
import { useSession } from "./panels/AccountControl.tsx";
import { skipIntro } from "./map/camera.ts";
import { presetTone } from "./map/effects.ts";
import { MapView } from "./map/MapView.tsx";
import { METRIC_TEXT } from "./metrics.ts";
import { DURATION, EASE_OUT } from "./motion.ts";
import { BuildingPanel } from "./panels/BuildingPanel.tsx";
import { Dock } from "./panels/Dock.tsx";
import { MapTools } from "./panels/MapTools.tsx";
import { RegionPanel } from "./panels/RegionPanel.tsx";
import { House as HouseLoading } from "./icons.ts";
import { CitizenWorkspace } from "./panels/CitizenWorkspace.tsx";
import { DashboardShell } from "./panels/DashboardShell.tsx";
import { StoryBar } from "./panels/StoryBar.tsx";
import { type Metric, useAppStore } from "./store.ts";

interface AppData {
  token: string;
  regions: RegionCollection;
  plants: PlantCollection;
}

type Phase = "loading" | "flying" | "done";

/** Gap between the pointer and the tooltip, in px. */
const TOOLTIP_OFFSET = 16;

export function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [mapReady, setMapReady] = useState(false);
  const citizenFixed = useAppStore(s => s.user?.role === "warga" && s.home !== null);
  const landingOpen = useAppStore((s) => s.landing === "open");
  const session = useSession();
  const user = useAppStore(s => s.user);
  const resume = session.ready && (user !== null || !landingOpen);
  // The region the pointer is over on the map: the one hover that shows a tooltip. It changes on enter and
  // leave only (never per mouse move) and ends with the hover, e.g. when a click selects the region.
  const mapHoverId = useAppStore((s) => (s.hoverOrigin === "map" ? s.hoveredRegionId : null));
  const metric = useAppStore((s) => s.metric);
  const potentialOpen = useAppStore((s) => s.potentialOpen);
  const chatOpen = useAppStore(s => s.chatOpen);
  const storyOpen = useAppStore((s) => s.story !== null);
  const tone = useAppStore((s) => presetTone(s.lightPreset));
  const regionList = useMemo(() => data?.regions.features.map((f) => f.properties) ?? [], [data]);
  const attempt = useRef(0);
  // The chrome follows the ground: paper panels on a light map, ink panels on a dark one (atlas-theme.css).
  // It lives on <html>, where HeroUI computes its derived colours, and so overlays in portals follow too.
  useEffect(() => {
    document.documentElement.dataset.theme = tone === "light" ? "atlas-day" : "atlas-night";
  }, [tone]);

  const load = useCallback(() => {
    const run = ++attempt.current;
    setFailure(null);
    setData(null);
    setPhase("loading");
    useAppStore.getState().setHoveredRegion(null);
    Promise.all([api.config(), api.regions(), api.plants()])
      .then(([config, regions, plants]) => {
        if (!config.mapboxToken) throw new Error("Token Mapbox belum diisi di server (MAPBOX_TOKEN).");
        if (run === attempt.current) setData({ token: config.mapboxToken, regions, plants });
      })
      .catch((err: unknown) => {
        if (run === attempt.current) setFailure(err instanceof Error ? err.message : "Data peta gagal dimuat.");
      });
  }, []);
  useEffect(load, [load]);

  const onMapReady = useCallback(() => setMapReady(true), []);
  // A place picked on the landing page: the flight to Kaltim is cut short and the camera goes on to it.
  const onIntroStart = useCallback(() => {
    setPhase("flying");
    if (useAppStore.getState().pendingPlace) setTimeout(skipIntro, 0);
  }, []);
  const onIntroEnd = useCallback(() => {
    setPhase("done");
    const s = useAppStore.getState();
    if (s.user?.role === "warga" && s.home) { s.setPendingPlace(null); return; }
    const place = s.pendingPlace;
    if (!place) return;
    s.setPendingPlace(null);
    void goToPlace(place);
  }, []);
  const onFailure = useCallback((message: string) => setFailure(message), []);

  // The tooltip follows the pointer through a ref, so moving the mouse never re-renders React.
  const tooltip = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const placeTooltip = useCallback(() => {
    const el = tooltip.current;
    if (!el) return;
    const { x, y } = pointer.current;
    // Flip to the other side of the pointer near the right and bottom edges.
    const left = x + TOOLTIP_OFFSET + el.offsetWidth > window.innerWidth ? x - TOOLTIP_OFFSET - el.offsetWidth : x + TOOLTIP_OFFSET;
    const top = y + TOOLTIP_OFFSET + el.offsetHeight > window.innerHeight ? y - TOOLTIP_OFFSET - el.offsetHeight : y + TOOLTIP_OFFSET;
    el.style.transform = `translate(${left}px, ${top}px)`;
  }, []);
  const onRegionPointer = useCallback(
    (point: { x: number; y: number }) => {
      pointer.current = point;
      placeTooltip();
    },
    [placeTooltip],
  );
  // The map reports null only when the hover it shows has ended (the pointer left that column, or the
  // columns faded out on the way to city zoom), so that hover ends everywhere.
  const onRegionHover = useCallback((id: string | null) => {
    const store = useAppStore.getState();
    if (id) store.setHoveredRegion(id, "map");
    else store.setHoveredRegion(null);
  }, []);

  const showUi = phase === "done" && !failure;
  const buildingOpen = useAppStore(s => s.buildingStatus !== "idle");
  const hovered = mapHoverId ? regionList.find((r) => r.id === mapHoverId) : undefined;
  useLayoutEffect(placeTooltip, [placeTooltip, hovered, metric]);

  return (
    <MotionConfig reducedMotion="user">
      <main className="app" data-citizen={citizenFixed || undefined} data-metric={metric} data-tone={tone} data-failed={failure ? "" : undefined} data-dashboard={showUi ? "" : undefined} data-planning={potentialOpen || undefined} data-building-open={buildingOpen || undefined} data-chat-open={chatOpen || undefined}>
        {data && session.ready && (
          <MapView
            token={data.token}
            regions={data.regions}
            plants={data.plants}
            onMapReady={onMapReady}
            onIntroStart={onIntroStart}
            onIntroEnd={onIntroEnd}
            onRegionHover={onRegionHover}
            onRegionPointer={onRegionPointer}
            onFailure={onFailure}
          />
        )}

        <AnimatePresence>
          {showUi && data && (
            <motion.div
              key="ui"
              className="ui-layer"
              initial="hidden"
              animate="shown"
              variants={{ shown: { transition: { delayChildren: 0.15, staggerChildren: 0.08 } } }}
            >
              {citizenFixed ? <CitizenWorkspace /> : <>
              <motion.div className="sheet-slot" variants={assemble(0, -16)}>
                <RegionPanel regions={regionList} />
              </motion.div>
              <BuildingPanel />
              <DashboardShell regions={regionList} />
              <StoryBar />
              {/* The column legend means nothing while the potential cells replace the columns; the story takes its place. */}
              {!potentialOpen && !storyOpen && (
                <motion.div className="dock-slot" variants={assemble(12, 0)}>
                  <Dock plants={data.plants} regions={regionList} />
                </motion.div>
              )}
              {/* After the dock in the tab order: the tools sit to its right. */}
              <motion.div className="tools-slot" variants={assemble(0, 12)}>
                <MapTools />
              </motion.div>
              </>}
              <ChatPanel />
            </motion.div>
          )}
        </AnimatePresence>

        {hovered && showUi && <RegionTooltip ref={tooltip} region={hovered} metric={metric} />}

        {/* The landing page comes first; the intro title card takes over once the flight starts. */}
        <Intro phase={failure || landingOpen || resume || !session.ready ? "done" : phase} onSkip={skipIntro} />
        {!failure && session.ready && <Landing ready={mapReady} />}
        {!failure && !session.ready && <div className="session-loading" role="status"><HouseLoading /><p>{session.problem ?? "Membuka akun dan rumah tersimpan…"}</p>{session.problem && <Button onPress={session.retry}>Coba lagi</Button>}</div>}
        <AccountDialog />
        {showUi && !citizenFixed && <PlaceHint />}

        {failure && (
          <Card className="failure" role="alert">
            <h2 className="failure__title">Peta belum bisa ditampilkan</h2>
            <p className="failure__text">{failure}</p>
            <Button onPress={load}>Coba lagi</Button>
          </Card>
        )}
      </main>
    </MotionConfig>
  );
}

function RegionTooltip({ ref, region, metric }: { ref: Ref<HTMLDivElement>; region: RegionSummary; metric: Metric }) {
  const m = METRIC_TEXT[metric];
  return (
    <div ref={ref} className="map-tooltip" role="status">
      <div className="map-tooltip__name">{region.name}</div>
      <div className="map-tooltip__value">
        <span className="num">{fmtCompact(m.value(region) * m.scale)}</span> {chem(m.unit)}, <Estimate />
      </div>
    </div>
  );
}

/** The panels arriving as the intro lands: part of the one orchestrated moment. */
function assemble(y: number, x: number) {
  return {
    hidden: { opacity: 0, y, x },
    shown: { opacity: 1, y: 0, x: 0, transition: { duration: DURATION.assemble, ease: EASE_OUT } },
  };
}
