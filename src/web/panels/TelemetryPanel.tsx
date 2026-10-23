import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { WeatherIcon } from "../components/WeatherIcon.tsx";
import { energyImpact, telemetryCsv } from "../../shared/energyImpact.ts";
import { AnimatedNumber } from "../components/AnimatedNumber.tsx";
import { Marker } from "mapbox-gl";
import { Button } from "@heroui/react";
import { House, Sun, Zap, ArrowRight, ArrowLeft } from "../icons.ts";
import { sensorFrame, type DeviceModel, type WeatherCase } from "../../shared/telemetry.ts";
import { witaMs, type ForecastHour } from "../../shared/pvForecast.ts";
import { fmtNumber } from "../../shared/format.ts";
import type { BuildingTabProps } from "./buildingTabs.ts";
import { api } from "../api.ts";
import { useAppStore } from "../store.ts";
import { useSensorClock, useTelemetrySettings } from "../telemetry.ts";
import { EnergyLab } from "./EnergyLab.tsx";
import { Character } from "../components/Character.tsx";
import { peopleFocus, showPeople } from "../map/peopleLayer.ts";
import { buildingViewPadding } from "../map/buildings.ts";

const clock = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Makassar" });
const co2Number = (value: number) => fmtNumber(value, 3);
export const WEATHER_CASES: { key: WeatherCase; label: string }[] = [{ key: "auto", label: "Cuaca lokasi" }, { key: "clear", label: "Uji cerah" }, { key: "cloudy", label: "Uji berawan" }, { key: "rain", label: "Uji hujan" }, { key: "heavy-rain", label: "Uji hujan lebat" }, { key: "night", label: "Uji malam" }];

export function BuildingTelemetry({ building, at }: BuildingTabProps) {
  const home = useAppStore(s => s.home);
  const homes = useAppStore(s => s.pemdaHomes);
  const saved = home && (home.featureId === building.featureId || Math.hypot(home.lng - at[0], home.lat - at[1]) < 0.00015) ? home : null;
  const registered = homes?.features.find(f => Math.hypot(f.geometry.coordinates[0] - at[0], f.geometry.coordinates[1] - at[1]) < 0.00015)?.properties;
  const installed = saved?.installedPv ?? registered?.installed ?? false;
  return <TelemetryPanel id={saved?.featureId ?? building.featureId} at={at} kwhYear={saved?.kwhYear ?? building.kwhYear}
    roofHeight={saved?.heightM ?? building.floors * 3.2} installed={installed} capacity={saved?.installedKwp ?? registered?.installedKwp ?? 0} />;
}

/** Used for the resident's own home and any selected building. This monitor never writes installation status. */
export function TelemetryPanel({ id, at, kwhYear, installed, capacity, simple = false, roofHeight = 3.2 }: { id: string; at: [number, number]; kwhYear: number; installed: boolean; capacity: number; simple?: boolean; roofHeight?: number }) {
  const now = useSensorClock();
  const scenario = useTelemetrySettings(s => s.cases[id] ?? "auto");
  const setCase = useTelemetrySettings(s => s.setCase);
  const setBuildingReading = useTelemetrySettings(s => s.setBuildingReading);
  const [previewKwp, setPreviewKwp] = useState<number | null>(null);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [hours, setHours] = useState<ForecastHour[]>([]);
  const [factor, setFactor] = useState<number | null>(null);
  const [forecastStale, setForecastStale] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [markerElement, setMarkerElement] = useState<HTMLDivElement | null>(null);
  const map = useAppStore(s => s.map);
  useEffect(() => map ? showPeople(map, at) : undefined, [map, id, at[0], at[1]]);
  useEffect(() => {
    if (scenario === "auto") return;
    const state = useAppStore.getState();
    const previousRain = state.rain, previousLight = state.lightMode;
    const rain = (scenario === "rain" || scenario === "heavy-rain") ? "on" : "off";
    const light = scenario === "night" ? "night" : "day";
    state.setRain(rain); state.setLightMode(light);
    return () => {
      const current = useAppStore.getState();
      if (current.rain === rain) current.setRain(previousRain);
      if (current.lightMode === light) current.setLightMode(previousLight);
    };
  }, [scenario]);
  const kWp = previewKwp ?? (installed ? capacity : 0);
  useEffect(() => {
    let live = true, busy = false;
    void api.grid().then(grid => { if (live) setFactor(grid.factorKgPerKwh); }, () => {});
    const load = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try { const weather = await api.weather(at[1], at[0], 0); if (live) { setHours(weather.hours); setForecastStale(weather.stale); setCheckedAt(Date.now()); } }
      catch { if (live) setForecastStale(true); }
      finally { busy = false; }
    };
    void load(); const timer = setInterval(() => void load(), 60_000);
    const visible = () => { void load(); }; document.addEventListener("visibilitychange", visible);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [at[0], at[1]]);
  const model = useMemo<DeviceModel>(() => ({ id, kwhYear, kWp, gridFactor: factor ?? 0 }), [id, kwhYear, kWp, factor]);
  const readingAt = pausedAt ?? now;
  const forecast = hours.find(h => Math.abs(witaMs(h.time) - readingAt) <= 30 * 60_000);
  const frame = sensorFrame(model, readingAt, scenario, forecast);
  const impact = energyImpact(frame, factor);
  const nextWindow = !forecastStale && kWp > 0 ? hours.filter(h => { const time = witaMs(h.time); return time >= now && time < now + 24 * 3600_000; }).map(h => ({ hour: h, value: sensorFrame(model, witaMs(h.time), "auto", h) })).sort((a, b) => (b.value.solarKw - b.value.loadKw) - (a.value.solarKw - a.value.loadKw))[0] : undefined;
  useEffect(() => {
    setBuildingReading({ id, co2KgHour: factor == null ? null : frame.co2KgHour, avoidedKgHour: factor == null ? null : frame.avoidedKgHour, time: frame.timestamp, offline: pausedAt != null });
  }, [id, factor, frame.sequence, frame.co2KgHour, frame.avoidedKgHour, pausedAt, setBuildingReading]);
  useEffect(() => () => setBuildingReading(null), [setBuildingReading]);
  const history = useMemo(() => Array.from({ length: 31 }, (_, i) => sensorFrame(model, readingAt - (30 - i) * 2000, scenario, forecast)), [model, readingAt, scenario, forecast]);
  // An anchored packet indicator links the active monitor to its building without inventing network cables on the map.
  useEffect(() => {
    if (!map) return;
    const element = document.createElement("div"); element.className = "iot-map-marker iot-map-marker--energy";
    const marker = new Marker({ element, anchor: "bottom", offset: [0, -4], altitude: Math.max(0, roofHeight), occludedOpacity: 0.8 }).setLngLat(at).addTo(map);
    setMarkerElement(element);
    return () => { marker.remove(); };
  }, [map, id, at[0], at[1], roofHeight]);
  useEffect(() => {
    if (!markerElement) return;
    markerElement.dataset.offline = String(pausedAt != null);
  }, [markerElement, frame.solarKw, frame.sequence, pausedAt]);
  const max = Math.max(...history.map(f => Math.max(f.solarKw, f.loadKw)), 0.1);
  const line = (field: "solarKw" | "loadKw") => history.map((f, i) => `${i * 10},${76 - f[field] / max * 64}`).join(" ");
  const sending = frame.exportKw > 0.001;
  return <section className="iot-monitor" aria-label="Sensor simulasi gedung" data-offline={pausedAt != null} data-device={id} data-sequence={frame.sequence} data-solar={frame.solarKw} data-load={frame.loadKw} data-import={frame.importKw} data-export={frame.exportKw}>
    {markerElement && createPortal(<div className={`energy-beacon${simple ? " energy-beacon--home" : ""}`} title="Sensor virtual · efek simbolis, bukan asap gedung" data-offline={pausedAt != null} data-level={impact.gridSharePct > 60 ? "high" : impact.gridSharePct > 0 ? "low" : "clean"}>
      <div className="energy-beacon__halo" aria-hidden><i /><i /><i /><span key={frame.sequence} className="energy-beacon__packet" /></div>
      <div className="energy-beacon__label"><strong>{simple ? "Rumah saya · simulasi" : pausedAt == null ? "Sensor simulasi aktif" : "Paket tertunda"}</strong><span><Sun aria-hidden />{fmtNumber(frame.solarKw, 2)} kW surya</span><span>CO₂ jaringan {factor == null ? "—" : fmtNumber(frame.co2KgHour, 3)} kg/jam</span>{!simple && <small>Efek simbolis · bukan asap gedung</small>}</div>
    </div>, markerElement)}
    <header className="iot-monitor__header"><Character role="teknisi" /><div><span className="iot-heartbeat" /><strong>Sensor simulasi</strong><small>{pausedAt == null ? "Paket setiap 2 detik" : "Perangkat virtual offline"}</small></div>
      <time dateTime={new Date(frame.timestamp).toISOString()}>{clock.format(frame.timestamp)} WITA</time></header>
    <p className="iot-monitor__intro">{installed ? `${fmtNumber(capacity, 2)} kWp dilaporkan terpasang.` : "Belum ada pemasangan tercatat."} Angka di bawah dihasilkan sensor virtual, bukan alat fisik.</p>
    <details className="iot-experiments journey-details" open={!simple}><summary>Uji cuaca dan kapasitas panel</summary>
    <div className="iot-weather-controls" role="group" aria-label="Skenario cuaca sensor">{WEATHER_CASES.map(c => <button key={c.key} type="button" aria-pressed={scenario === c.key} disabled={pausedAt != null} onClick={() => setCase(id, c.key)}><WeatherIcon kind={c.key} />{c.label}</button>)}</div>
    <label className="iot-capacity">Kapasitas uji PLTS (kWp)<input aria-label="Kapasitas uji PLTS" type="number" min="0" max="10000" step="0.5" value={kWp} disabled={pausedAt != null}
      onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value) && value >= 0 && value <= 10000) setPreviewKwp(value); }} /></label>
    {previewKwp != null && previewKwp !== (installed ? capacity : 0) && <p className="iot-monitor__note">Kapasitas uji saja. Data pemasangan tidak berubah. <button type="button" onClick={() => setPreviewKwp(null)}>Kembali ke data tercatat</button></p>}
    </details>
    <div className="iot-weather"><WeatherIcon kind={frame.weather} /><strong>{frame.weather === "malam" ? "Malam" : frame.weather === "hujan" ? "Hujan" : frame.weather === "berawan" ? "Berawan" : "Cerah"}</strong><span>{fmtNumber(frame.irradiance)} W/m²</span><span>{fmtNumber(frame.rainMmHour, 1)} mm/jam</span></div>
    <div className="iot-flow" data-running={pausedAt == null} aria-label="Animasi aliran listrik simulasi">
      <div className="iot-flow__node"><Sun aria-hidden /><span>Panel surya</span><strong>{fmtNumber(frame.solarKw, 2)} kW</strong></div>
      <div className="iot-flow__link" data-active={frame.selfUseKw > 0.001 || sending}><ArrowRight aria-hidden /></div>
      <div className="iot-flow__node"><House aria-hidden /><span>{simple ? "Rumah" : "Gedung"}</span><strong>{fmtNumber(frame.loadKw, 2)} kW</strong></div>
      <div className="iot-flow__link" data-active={sending || frame.importKw > 0.001} data-import={!sending}>{sending ? <ArrowRight aria-hidden /> : <ArrowLeft aria-hidden />}</div>
      <div className="iot-flow__node"><Zap aria-hidden /><span>{simple ? "Listrik PLN" : "Jaringan"}</span><strong>{fmtNumber(sending ? frame.exportKw : frame.importKw, 2)} kW</strong></div>
    </div>
    <p className="iot-monitor__insight">{pausedAt != null ? `Paket terakhir ${Math.max(0, Math.floor((now - frame.timestamp) / 1000))} detik lalu. Nilai ditahan sampai tersambung kembali.` : kWp === 0 ? "PLTS belum dimodelkan. Isi kapasitas uji untuk mencoba pengaruh cuaca." : frame.weather === "malam" ? "Tidak ada radiasi matahari. Beban simulasi dipasok jaringan." : sending ? "Produksi melebihi beban. Selisihnya mengalir ke jaringan pada simulasi ini." : "Panel membantu memasok beban. Kekurangannya dipasok jaringan."}</p>
    <div className="energy-impact" data-status={impact.status} aria-label="Dampak PLTS pada emisi simulasi">
      <div className="energy-impact__heading"><span>Beban dipasok surya</span><strong>{fmtNumber(impact.coveragePct, 1)}%</strong></div>
      <progress max="100" value={impact.coveragePct} aria-label="Persentase beban dipasok surya" />
      <div className="energy-impact__comparison"><div><span>Tanpa PLTS</span><strong>{impact.baselineKgHour == null ? "—" : <AnimatedNumber value={impact.baselineKgHour} format={co2Number} />}</strong></div><ArrowRight aria-hidden /><div><span>Dengan PLTS</span><strong>{impact.remainingKgHour == null ? "—" : <AnimatedNumber value={impact.remainingKgHour} format={co2Number} />}</strong></div></div>
      <p>kg CO₂/jam, beban dan waktu yang sama. {impact.avoidedKgHour == null ? "Menunggu faktor emisi." : `${fmtNumber(impact.avoidedKgHour, 3)} kg CO₂/jam dihindari pada paket ini.`}</p>
    </div>
    <details className="journey-details" open={!simple}><summary>Rincian sensor dan laporan</summary>
    <svg className="iot-chart" viewBox="0 0 300 86" role="img" aria-label="Produksi surya dan beban simulasi satu menit terakhir"><path className="iot-chart__baseline" d="M0 76H300" /><polyline className="iot-chart__solar" points={line("solarKw")} /><polyline className="iot-chart__load" points={line("loadKw")} /></svg>
    <div className="iot-chart__key"><span>Surya</span><span>Beban</span><small>60 detik sintetis · skala 0–{fmtNumber(max, 2)} kW</small></div>
    <dl className="iot-facts"><div><dt>CO₂ dihindari</dt><dd>{factor == null ? "—" : fmtNumber(frame.avoidedKgHour, 3)} <small>kg/jam</small></dd></div><div><dt>Emisi jaringan</dt><dd>{factor == null ? "—" : fmtNumber(frame.co2KgHour, 3)} <small>kg CO₂/jam</small></dd></div><div><dt>Suhu modul</dt><dd>{fmtNumber(frame.temperatureC, 1)} <small>°C</small></dd></div><div><dt>Tegangan jaringan</dt><dd>{fmtNumber(frame.voltageV, 1)} <small>V</small></dd></div></dl>
    <Button variant="ghost" size="sm" onPress={() => setPausedAt(pausedAt == null ? now : null)}>{pausedAt == null ? "Uji koneksi terputus" : "Sambungkan kembali"}</Button>
    <Button variant="ghost" size="sm" onPress={() => {
      const url = URL.createObjectURL(new Blob([telemetryCsv(history, { id, scenario, kWp, gridFactor: factor })], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = `simulasi-iot-${id.replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "gedung"}.csv`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>Unduh laporan simulasi</Button>
    <Button variant="ghost" size="sm" onPress={() => { if (map) map.flyTo({ center: peopleFocus(map) ?? at, zoom: 20, pitch: 62, bearing: -25, padding: buildingViewPadding(), duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200 }); }}>Lihat karakter 3D</Button>
    <p className="iot-monitor__note">Warga, pemda, dan teknisi pada peta adalah karakter ilustratif yang diperbesar, bukan pelacakan orang nyata. Muncul saat diperbesar dekat gedung.</p>
    </details>
    <div className="energy-impact" aria-label="Saran waktu pemakaian"><strong>Rencanakan pemakaian berikutnya</strong><p>{pausedAt != null ? "Perangkat virtual offline. Periksa kembali setelah tersambung." : nextWindow ? `Dari prakiraan 24 jam yang tersedia, ${nextWindow.hour.time.replace("T", " ")} WITA memiliki selisih produksi dan beban terbaik: ${fmtNumber(nextWindow.value.solarKw, 2)} kW surya untuk beban model ${fmtNumber(nextWindow.value.loadKw, 2)} kW. ${nextWindow.value.solarKw > nextWindow.value.loadKw ? "Pertimbangkan perangkat tambahan sesuai surplus yang tersedia." : "Belum ada surplus pada jam terbaik ini; tambahan perangkat masih membutuhkan jaringan."}` : "Belum ada prakiraan segar atau kapasitas panel untuk menyarankan waktu. Coba skenario di lab dahulu."}</p><small>Perkiraan per jam, bukan jaminan cuaca. Memakai kapasitas panel yang sedang diuji; tidak memakai cuaca uji monitor.</small></div>
    <details className="journey-details"><summary>Lab cuaca, baterai, dan saran pemakaian</summary><EnergyLab solarOnly={simple} initialKwp={Math.max(kWp, 1)} initialLoad={Math.max(frame.loadKw, 0.1)} /></details>
    <details className="iot-method"><summary>Sumber dan cara simulasi</summary><p>Perangkat virtual menghasilkan paket setiap 2 detik. Beban berasal dari konsumsi tahunan dan profil jam WITA dengan variasi deterministik per gedung. Produksi = kWp × radiasi/1.000 × 0,78. Surya dipakai di gedung dahulu; surplus diekspor tanpa menghitung imbalan. CO₂ dihindari hanya dari energi surya yang dipakai sendiri. Lingkaran jingga menandai ketergantungan pada jaringan; toska berarti surya memenuhi beban. Efek simbolis ini bukan asap atau konsentrasi CO₂ di udara dan berhenti saat koneksi virtual putus.</p><p>{scenario !== "auto" ? "Cuaca uji cerah/berawan/hujan memakai kondisi siang sintetis, terlepas dari jam sebenarnya; uji malam meniadakan radiasi." : frame.weatherSource === "forecast" ? `Cuaca dasar: prakiraan Open-Meteo ${forecast!.time.replace("T", " ")} WITA${forecastStale ? " (tersimpan)" : ""}; variasi antar-paket tetap sintetis.` : "Prakiraan lokasi belum tersedia. Cuaca sepenuhnya sintetis mengikuti jam WITA."} {checkedAt ? `Cuaca terakhir diperiksa ${clock.format(checkedAt)} WITA.` : ""} Faktor emisi: {factor == null ? "belum tersedia" : `${fmtNumber(factor, 3)} kg/kWh dari data jaringan aplikasi`}. Suhu dan tegangan sepenuhnya sintetis. Grafik dan CSV menampilkan riwayat model, bukan arsip paket sensor. Tidak ada data uji yang disimpan sebagai pengukuran nyata.</p></details>
  </section>;
}
