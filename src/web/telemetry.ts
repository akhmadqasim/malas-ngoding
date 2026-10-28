import { useSyncExternalStore } from "react";
import { create } from "zustand";
import type { WeatherCase } from "../shared/telemetry.ts";

let tick = Math.floor(Date.now() / 2000) * 2000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
function notify() { tick = Math.floor(Date.now() / 2000) * 2000; for (const listener of listeners) listener(); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) { timer = setInterval(() => { if (document.visibilityState === "visible") notify(); }, 2000); document.addEventListener("visibilitychange", notify); notify(); }
  return () => { listeners.delete(listener); if (!listeners.size) { clearInterval(timer); timer = undefined; document.removeEventListener("visibilitychange", notify); } };
}
/** One shared 2-second clock for all visible virtual devices, stopped when no monitor is mounted. */
export const useSensorClock = () => useSyncExternalStore(subscribe, () => tick);
export interface RegionSensorReading { co2KgHour: number; regionRates: Record<string, number>; time: number }
export interface BuildingSensorReading { id: string; co2KgHour: number | null; avoidedKgHour: number | null; time: number; offline: boolean }
export const useTelemetrySettings = create<{ buildingReading: BuildingSensorReading | null; setBuildingReading: (value: BuildingSensorReading | null) => void; regionReading: RegionSensorReading | null; setRegionReading: (value: RegionSensorReading | null) => void; cases: Record<string, WeatherCase>; setCase: (id: string, value: WeatherCase) => void }>(set => ({
  buildingReading: null, setBuildingReading: buildingReading => set({ buildingReading }),
  regionReading: null, setRegionReading: regionReading => set({ regionReading }),
  cases: {}, setCase: (id, value) => set(s => ({ cases: { ...s.cases, [id]: value } })),
}));
