import { useEffect, useMemo, useState } from "react";
import { ArrowUp, ArrowRotateRight } from "../icons.ts";
import type { RegionSummary } from "../../shared/types.ts";
import type { TwinBasis } from "../../shared/twin.ts";
import { twinTimeline } from "../../shared/twin.ts";
import { witaMs } from "../../shared/pvForecast.ts";
import { compassName, type WindResponse } from "../../shared/wind.ts";
import { fmtNumber } from "../../shared/format.ts";
import { api } from "../api.ts";
import { useAppStore } from "../store.ts";
import { useTelemetrySettings } from "../telemetry.ts";
import { AnimatedNumber } from "../components/AnimatedNumber.tsx";

const time = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Makassar" });
const buildingCo2 = (value: number) => fmtNumber(value, 3);
const regionalCo2 = (value: number) => fmtNumber(value, 1);

/** Current model data has timestamps; CO2 is explicitly a load-profile estimate, never a sensor reading. */
export function LiveOverview({ regions }: { regions: RegionSummary[] }) {
  const map = useAppStore(s => s.map);
  const regionId = useAppStore(s => s.selectedRegionId);
  const site = useAppStore(s => s.buildSite);
  const twinOpen = useAppStore(s => s.twinOpen);
  const regionReading = useTelemetrySettings(s => s.regionReading);
  const buildingReading = useTelemetrySettings(s => s.buildingReading);
  const [at, setAt] = useState<[number, number]>([117.15, -0.5]);
  const [wind, setWind] = useState<WindResponse | null>(null);
  const [basis, setBasis] = useState<TwinBasis | null>(null);
  const [windError, setWindError] = useState(false);
  const [emissionError, setEmissionError] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!map) return;
    const moved = () => { const p = map.getCenter(); setAt([Math.round(p.lng * 20) / 20, Math.round(p.lat * 20) / 20]); };
    moved(); map.on("moveend", moved);
    return () => { map.off("moveend", moved); };
  }, [map]);
  const lng = site?.at[0] ?? at[0], lat = site?.at[1] ?? at[1];
  useEffect(() => {
    let live = true, busy = false;
    setWind(null); setWindError(false);
    const load = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try { const result = await api.wind(lat, lng); if (live) { setWind(result); setWindError(false); } }
      catch { if (live) setWindError(true); }
      finally { busy = false; }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    const visible = () => { void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [lat, lng, refresh]);
  useEffect(() => {
    let live = true, busy = false;
    const load = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try { const result = await api.twin(); if (live) { setBasis(result); setEmissionError(false); } }
      catch { if (live) setEmissionError(true); }
      finally { busy = false; }
    };
    void load();
    const timer = setInterval(() => void load(), 5 * 60_000);
    const visible = () => { void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const timeline = useMemo(() => basis ? twinTimeline(regions, basis) : [], [regions, basis]);
  const hour = timeline.find(h => now >= witaMs(h.time) && now < witaMs(h.time) + 3600_000);
  const row = regionId ? hour?.regions.find(r => r.id === regionId) : hour;
  const simulated = twinOpen && regionReading ? (regionId ? regionReading.regionRates[regionId] : regionReading.co2KgHour) : undefined;
  const emission = simulated ?? row?.co2KgPerHour;
  const buildingScope = !twinOpen && buildingReading != null;
  const emissionValue = buildingScope ? buildingReading.co2KgHour : emission == null ? null : emission / 1000;
  const current = wind?.current.wind;
  const windOld = windError || wind?.stale || (current && now - witaMs(current.time) > 45 * 60_000);
  const area = regionId ? regions.find(r => r.id === regionId)?.name : "Kalimantan Timur";
  return <section className="live-overview" aria-label="Pemantauan energi terkini">
    <div className="live-overview__metric">
      <span className="live-overview__label">Emisi saat ini <small>{buildingScope || simulated != null ? "Sensor simulasi" : "Estimasi model"}</small></span>
      <strong>{emissionValue != null ? <AnimatedNumber className="live-co2-value" value={emissionValue} format={buildingScope ? buildingCo2 : regionalCo2} /> : "—"}<span>{buildingScope ? "kg CO₂/jam" : "ton CO₂/jam"}</span></strong>
      <span className="live-overview__note">{buildingScope ? `Gedung dipantau · ${buildingReading.offline ? "paket tertunda" : "paket virtual 2 detik"}` : simulated != null ? `${area} · paket virtual 2 detik` : row ? `${area}${emissionError || basis?.stale ? " · data tersimpan" : " · profil jam berjalan"}` : emissionError ? "Data emisi belum tersedia" : "Memuat profil emisi…"}</span>
    </div>
    <div className="live-overview__metric live-overview__wind">
      <span className="live-overview__label">Angin lokasi <small>{windOld ? "Tertunda" : "Pembaruan otomatis"}</small></span>
      <strong><ArrowUp className="live-overview__direction" aria-hidden style={{ transform: `rotate(${(current?.fromDeg ?? 0) + 180}deg)` }} />{current ? fmtNumber(current.speedMs, 1) : "—"}<span>m/s</span></strong>
      <span className="live-overview__note">{current ? `Dari ${compassName(current.fromDeg)} · ${time.format(witaMs(current.time))} WITA${windOld ? " · data lama" : ""}` : windError ? "Sumber angin belum tersedia" : "Membaca model cuaca…"}</span>
    </div>
    <div className="live-overview__sync"><span>{time.format(now)} WITA</span><button type="button" onClick={() => setRefresh(v => v + 1)} aria-label="Perbarui data pemantauan"><ArrowRotateRight aria-hidden /></button></div>
    <details className="live-overview__source"><summary>Tentang data</summary><p>CO₂ dihitung dari konsumsi listrik tahunan, profil beban per jam, dan faktor emisi jaringan. Bukan pembacaan sensor fisik. {buildingScope ? "Ringkasan mengikuti paket virtual gedung setiap 2 detik; satuannya kg CO₂/jam. Saat koneksi virtual putus, nilai terakhir ditahan." : simulated != null ? "Ringkasan mengikuti sensor virtual wilayah setiap 2 detik; satuannya ton CO₂/jam." : "Model dasar diperiksa ulang setiap 5 menit."}</p><p>Angin memakai model cuaca Open-Meteo pada ketinggian 10 m di {lat.toFixed(2)}°, {lng.toFixed(2)}°. Diperiksa setiap 60 detik; waktu model dapat tetap sama. {wind ? `Terakhir diperiksa ${time.format(Date.parse(wind.fetchedAt))} WITA.` : ""} <a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">Sumber angin</a></p></details>
  </section>;
}
