import { Button, Card, CloseButton, Label, ListBox, NumberField, Select, Skeleton, Tabs } from "@heroui/react";
import { AnimatePresence, motion } from "motion/react";
import { type ComponentType, type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fmtCompact, fmtNumber } from "../../shared/format.ts";
import type { BuildingEstimate, BuildingType } from "../../shared/types.ts";
import { api } from "../api.ts";
import { AnimatedNumber } from "../components/AnimatedNumber.tsx";
import { Estimate } from "../components/Estimate.tsx";
import {
  buildingViewPadding,
  clearBuildingSelection,
  enableBuildingInteraction,
  revealBuilding,
  setBuildingTone,
  setBuildingDesign,
} from "../map/buildings.ts";
import { presetTone } from "../map/effects.ts";
import { DURATION, EASE_IN, EASE_OUT } from "../motion.ts";
import { type BuildingHint, type PanelTab, useAppStore } from "../store.ts";
import { BUILDING_TYPE_LABELS, BUILDING_TYPES, type BuildingTabProps } from "./buildingTabs.ts";
import { EmissionTab } from "./EmissionTab.tsx";
import { EnergyTab } from "./EnergyTab.tsx";
import { SolarTab } from "./SolarTab.tsx";
import { WeatherTab } from "./WeatherTab.tsx";
import { BuildingTelemetry } from "./TelemetryPanel.tsx";

/**
 * The tabs of the panel. A tab whose `Panel` is null is not built yet and shows as disabled; the
 * solar-weather lane registers SolarTab and WeatherTab here.
 */
const TABS: { id: PanelTab; label: string; Panel: ComponentType<BuildingTabProps> | null }[] = [
  { id: "sensor", label: "Sensor IoT", Panel: BuildingTelemetry },
  { id: "energi", label: "Energi", Panel: EnergyTab },
  { id: "emisi", label: "Emisi", Panel: EmissionTab },
  { id: "surya", label: "Surya", Panel: SolarTab },
  { id: "cuaca", label: "Cuaca", Panel: WeatherTab },
];

/** Gap between the panel and the dock under it, in px (the dock's own gap, spacing 3). */
const DOCK_GAP = 12;
/** Floor changes wait this long for the next press before asking for a new estimate, in ms. */
const FLOORS_DEBOUNCE_MS = 300;

const TYPE_SOURCE: Record<BuildingEstimate["typeSource"], string> = {
  poi: "Jenis dari data tempat di peta.",
  footprint: "Jenis ditebak dari luas tapak.",
  user: "Jenis pilihan Anda.",
};

/** The yearly kWh: whole numbers up to a million, then words ("5,2 juta"), so the readout fits the panel. */
const kwhReadout = (n: number) => (Math.abs(n) < 1e6 ? fmtNumber(n) : fmtCompact(n));

type TestWindow = Window & { __malasSelectBuildingAt?: (lngLat: [number, number], hint?: BuildingHint) => Promise<void> };

/** Closes the panel and gives the keyboard focus back to the map, where the building was picked. */
function closeToMap() {
  const { map, closeBuilding } = useAppStore.getState();
  closeBuilding();
  map?.getCanvas().focus({ preventScroll: true });
}

/**
 * Makes the map's buildings clickable while the map is up: a click opens the panel (and brings the
 * building out from under it), the selection colours follow the light, and closing the panel clears the
 * selection on the map.
 */
function useBuildingMap() {
  const map = useAppStore((s) => s.map);
  const planning = useAppStore(s => s.potentialOpen);
  useEffect(() => {
    if (!map || planning) return;
    const off = enableBuildingInteraction(
      map,
      (input) => {
        void useAppStore.getState().openBuilding(input);
        // After the panel has its place, so the padding knows where it is.
        requestAnimationFrame(() => revealBuilding(map, [input.lng, input.lat], buildingViewPadding()));
      },
      presetTone(useAppStore.getState().lightPreset),
      // Empty ground at building zoom: close the panel, as a map app does.
      () => {
        if (useAppStore.getState().buildingStatus !== "idle") useAppStore.getState().closeBuilding();
      },
    );
    const unsubscribe = useAppStore.subscribe((s, prev) => {
      if (s.selectedBuilding && (s.selectedBuilding !== prev.selectedBuilding || s.buildingName !== prev.buildingName)) {
        setBuildingDesign(map, s.selectedBuilding.type, s.buildingName);
      }
      // The selected building turns solar yellow while the Surya tab shows its rooftop panels.
      if (s.lightPreset !== prev.lightPreset || s.panelTab !== prev.panelTab) {
        setBuildingTone(map, presetTone(s.lightPreset), s.panelTab === "surya");
      }
      if (s.buildingStatus === "idle" && prev.buildingStatus !== "idle") clearBuildingSelection(map);
    });
    // Test hook for scripts/smoke.ts: the chat's select building action.
    (window as TestWindow).__malasSelectBuildingAt = (lngLat, hint) => useAppStore.getState().selectBuildingAt(lngLat, hint);
    return () => {
      unsubscribe();
      off();
      delete (window as TestWindow).__malasSelectBuildingAt;
    };
  }, [map, planning]);
}

/**
 * How far above the bottom edge the panel must stop to clear the dock (legend and map controls), in px.
 * Measured, because the dock's height changes with the screen and with what the legend shows.
 */
function useDockClearance(): number | null {
  const [clearance, setClearance] = useState<number | null>(null);
  // While the guided story runs, its card takes the dock's place at the bottom.
  const storyOpen = useAppStore((s) => s.story !== null);
  useLayoutEffect(() => {
    const dock = document.querySelector(storyOpen ? ".story-slot" : ".dock-slot");
    if (!dock) return;
    const update = () => {
      const r = dock.getBoundingClientRect();
      setClearance(r.height > 0 ? Math.round(window.innerHeight - r.top + DOCK_GAP) : null);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(dock);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [storyOpen]);
  return clearance;
}

/**
 * Escape closes the open panel when the keyboard is on the panel or the map (right after a click on a
 * building, focus is on the map). Inside a popover (the type list) or another panel, Escape is theirs.
 */
function useEscapeToClose(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const at = document.activeElement;
      const ours = !at || at === document.body || at.closest(".building-panel, .mapboxgl-canvas-container") !== null;
      if (ours) closeToMap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

/** The building panel on the right: slides in when a building is picked, out when closed. */
export function BuildingPanel() {
  useBuildingMap();
  const status = useAppStore((s) => s.buildingStatus);
  useEscapeToClose(status !== "idle");
  const clearance = useDockClearance();
  const style = clearance === null ? undefined : ({ "--dock-clear": `${clearance}px` } as CSSProperties);

  return (
    <div className="building-slot" style={style}>
      <AnimatePresence>
        {status !== "idle" && (
          <motion.div
            key="building"
            className="building-slot__panel"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0, transition: { duration: DURATION.panel, ease: EASE_OUT } }}
            exit={{ opacity: 0, x: 16, transition: { duration: DURATION.exit, ease: EASE_IN } }}
          >
            <Card className="building-panel" role="region" aria-label="Data gedung">
              <div className="building-panel__scroll">
                {/* First in tab order, top right; it scrolls away with the header, so it never covers a row. */}
                <CloseButton className="building-panel__close" aria-label="Tutup panel gedung" onPress={closeToMap} />
                <PanelBody />
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PanelBody() {
  const status = useAppStore((s) => s.buildingStatus);
  const building = useAppStore((s) => s.selectedBuilding);
  const at = useAppStore((s) => s.selectedBuildingAt);
  const message = useAppStore((s) => s.buildingError);
  const retry = useAppStore((s) => s.retryBuilding);
  const name = useAppStore((s) => s.buildingName);

  if (status === "error") {
    return (
      <div className="building-panel__state" role="alert">
        <p className="building-panel__state-title">Perkiraan gedung gagal dimuat</p>
        <p className="building-panel__state-text">{message ?? "Coba lagi sebentar lagi."}</p>
        <Button variant="primary" onPress={() => void retry()}>
          Coba lagi
        </Button>
      </div>
    );
  }
  if (status === "empty") {
    return (
      <div className="building-panel__state" role="status">
        {name && <h2 className="building-panel__name">{name}</h2>}
        <p className="building-panel__state-title">Gedung tidak ditemukan</p>
        <p className="building-panel__state-text">{message}</p>
      </div>
    );
  }
  if (status === "loading" || !building || !at) return <PanelSkeleton />;
  return <BuildingView building={building} at={at} />;
}

/**
 * For a signed-in resident: marks the open building as their home, with the type and floors the panel shows
 * now. A home already marked keeps its bill and choices; a new one starts private (not shared with pemda).
 */
function MyHomeButton({ building }: { building: BuildingEstimate }) {
  const user = useAppStore((s) => s.user);
  const home = useAppStore((s) => s.home);
  const input = useAppStore((s) => s.buildingInput);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (user?.role !== "warga" || !input) return null;
  const isHome = home?.featureId === building.featureId;
  const same = isHome && home.buildingType === building.type && home.floors === building.floors;

  const mark = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const keep = isHome ? home : null;
      const answer = await api.saveHome({
        featureId: building.featureId,
        lng: input.lng,
        lat: input.lat,
        footprintM2: input.footprintM2,
        heightM: input.heightM,
        buildingType: building.type,
        floors: building.floors,
        kwhMonth: keep?.kwhMonth ?? null,
        billRpMonth: keep?.billRpMonth ?? null,
        interestedPv: keep?.interestedPv ?? false,
        installedPv: keep?.installedPv ?? false,
        installedKwp: keep?.installedKwp ?? null,
        consentMap: keep?.consentMap ?? false,
      });
      useAppStore.getState().setHome(answer.home);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Gagal menyimpan rumah.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="my-home">
      {same ? (
        <>
          <span className="my-home__done">Ini rumah saya</span>
          <Button variant="ghost" size="sm" onPress={() => useAppStore.getState().setHomeOpen(true)}>
            Buka Rumah saya
          </Button>
        </>
      ) : (
        <Button variant="primary" size="sm" isPending={busy} onPress={mark}>
          {isHome ? "Simpan jenis dan lantai baru" : home ? "Pindahkan rumah saya ke sini" : "Ini rumah saya"}
        </Button>
      )}
      {problem && (
        <p className="account__problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

function BuildingView({ building, at }: BuildingTabProps) {
  const updating = useAppStore((s) => s.buildingUpdating);
  const name = useAppStore((s) => s.buildingName);
  const panelTab = useAppStore((s) => s.panelTab);
  const setPanelTab = useAppStore((s) => s.setPanelTab);
  const override = useAppStore((s) => s.overrideBuilding);
  const tab = TABS.find((t) => t.id === panelTab && t.Panel) ?? TABS[0]!;
  const Panel = tab.Panel!;

  return (
    <div className="building-view" aria-busy={updating || undefined}>
      <header className="building-panel__head">
        {name ? (
          <h2 className="building-panel__name">{name}</h2>
        ) : (
          <h2 className="sr-only">Gedung terpilih: {BUILDING_TYPE_LABELS[building.type]}</h2>
        )}
        <Select
          className="building-type"
          aria-label="Jenis gedung"
          value={building.type}
          onChange={(key) => {
            if (typeof key === "string" && key !== building.type) void override({ typeOverride: key as BuildingType });
          }}
        >
          <Select.Trigger className="building-type__trigger">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="building-type__popover" placement="bottom start">
            <ListBox>
              {BUILDING_TYPES.map((t) => (
                <ListBox.Item key={t} id={t} textValue={BUILDING_TYPE_LABELS[t]}>
                  {BUILDING_TYPE_LABELS[t]}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <p className="building-panel__meta">
          {building.region ? building.region.name : "Di luar Kalimantan Timur"}. {TYPE_SOURCE[building.typeSource]}
          {" "}Bentuk atap dan fasad pada peta bersifat ilustratif.
        </p>
        {building.type === "ibadah" && <WorshipDesign key={building.featureId} building={building} name={name} />}
        <FloorsField floors={building.floors} onCommit={(floors) => void override({ floorsOverride: floors })} />
        <MyHomeButton building={building} />
      </header>

      <div className="readout building-panel__readout" data-updating={updating || undefined}>
        <p className="readout__label">Listrik terpakai</p>
        <p className="readout__figure">
          <AnimatedNumber value={building.kwhYear} format={kwhReadout} />
        </p>
        <p className="readout__unit">
          kWh per tahun, <Estimate />
        </p>
      </div>

      <Tabs
        variant="secondary"
        className="building-tabs"
        selectedKey={tab.id}
        onSelectionChange={(key) => setPanelTab(String(key) as PanelTab)}
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="Rincian gedung">
            {TABS.map((t) => (
              <Tabs.Tab key={t.id} id={t.id} isDisabled={!t.Panel}>
                {t.label}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id={tab.id} className="building-tabs__panel">
          <Panel building={building} at={at} />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

function WorshipDesign({ building, name }: { building: BuildingEstimate; name: string | null }) {
  const map = useAppStore(s => s.map);
  const [design, setDesign] = useState("auto");
  useEffect(() => {
    if (map) setBuildingDesign(map, "ibadah", design === "mosque" ? "Masjid (pilihan model pengguna)" : name);
  }, [map, building, name, design]);
  return <label className="building-panel__meta">Model tempat ibadah (ilustrasi)
    <select className="pemda__filter" aria-label="Model tempat ibadah" value={design} onChange={e => setDesign(e.target.value)}>
      <option value="auto">Sesuai nama tempat / umum</option>
      <option value="mosque">Masjid — kubah dan menara</option>
    </select>
  </label>;
}

/** The floors stepper: shows the estimate's floors, and asks for a new estimate once the presses stop. */
function FloorsField({ floors, onCommit }: { floors: number; onCommit: (floors: number) => void }) {
  const [value, setValue] = useState(floors);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setValue(floors), [floors]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <NumberField
      className="floors"
      value={value}
      minValue={1}
      maxValue={40}
      step={1}
      onChange={(v) => {
        if (v === undefined || !Number.isFinite(v)) return;
        setValue(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          if (v !== floors) onCommit(v);
        }, FLOORS_DEBOUNCE_MS);
      }}
    >
      <Label className="floors__label">Jumlah lantai</Label>
      <NumberField.Group className="floors__group">
        <NumberField.DecrementButton aria-label="Kurangi lantai" />
        <NumberField.Input className="floors__input" />
        <NumberField.IncrementButton aria-label="Tambah lantai" />
      </NumberField.Group>
    </NumberField>
  );
}

/** Loading: flat blocks in the shape of the panel (no shimmer), so nothing jumps when the numbers come. */
function PanelSkeleton() {
  // A place the chat named is known before its numbers are: show the name while they load.
  const name = useAppStore((s) => s.buildingName);
  return (
    <div className="building-skeleton" aria-busy="true" aria-label="Memuat perkiraan gedung">
      {name && <h2 className="building-panel__name">{name}</h2>}
      <Skeleton animationType="none" className="building-skeleton__title" />
      <Skeleton animationType="none" className="building-skeleton__line" />
      <Skeleton animationType="none" className="building-skeleton__field" />
      <Skeleton animationType="none" className="building-skeleton__label" />
      <Skeleton animationType="none" className="building-skeleton__figure" />
      <Skeleton animationType="none" className="building-skeleton__line" />
      <Skeleton animationType="none" className="building-skeleton__tabs" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} animationType="none" className="building-skeleton__row" />
      ))}
    </div>
  );
}
