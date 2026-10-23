import { useEffect, useState, type CSSProperties } from "react";
import { labRun, type LabWeather } from "../../shared/energyLab.ts";
import { fmtNumber } from "../../shared/format.ts";
import { useSensorClock } from "../telemetry.ts";
import { WeatherIcon } from "../components/WeatherIcon.tsx";
import { VisualGuide } from "../components/VisualGuide.tsx";
import { api } from "../api.ts";
import { House, Sun, Clouds, ArrowRight } from "../icons.ts";
const options: [LabWeather, string][] = [["clear", "Cerah"], ["cloudy", "Mendung"], ["rain", "Hujan ringan"], ["heavy-rain", "Hujan lebat"], ["night", "Malam"]];
export function EnergyLab({ initialKwp = 2, initialLoad = 0.6, solarOnly = false }: { initialKwp?: number; initialLoad?: number; solarOnly?: boolean }) {
  const now = useSensorClock();
  const [factor, setFactor] = useState<number | null>(null);
  useEffect(() => { let live = true; void api.grid().then(g => { if (live) setFactor(g.factorKgPerKwh); }, () => {}); return () => { live = false; }; }, []);
  const [wind, setWind] = useState(4);
  const [windDirection, setWindDirection] = useState(1);
  const [weather, setWeather] = useState<LabWeather>("clear");
  const [kwp, setKwp] = useState(initialKwp), [load, setLoad] = useState(initialLoad), [battery, setBattery] = useState(0);
  const [start, setStart] = useState(now), [paused, setPaused] = useState<number | null>(null);
  const elapsed = Math.max(2, Math.min(3600, ((paused ?? now) - start) / 1000));
  const r = labRun(kwp, load, battery, weather, elapsed);
  const reset = () => { setStart(now); setPaused(null); };
  return <section className="energy-lab" aria-label="Lab energi publik"><h3>Coba cuaca dan baterai</h3>
    <VisualGuide role="teknisi" title="Kalau hujan, panelnya bagaimana?">Tekan gambar cuaca. Bandingkan listrik panel, baterai, dan jaringan.</VisualGuide>
    <div className="iot-weather-controls">{options.map(([key, label]) => <button type="button" key={key} aria-pressed={weather === key} onClick={() => { setWeather(key); reset(); }}><WeatherIcon kind={key} />{label}</button>)}</div>
    <div className="lab-scene" style={{ "--lab-drift": wind * windDirection } as CSSProperties} data-weather={weather} data-paused={paused != null} aria-label={`Ilustrasi ${options.find(o => o[0] === weather)?.[1]}`}><Sun className="lab-sun" /><Clouds className="lab-cloud" /><House className="lab-house" /><div className="lab-rain" aria-hidden>{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ left: `${i * 6}%`, animationDelay: `${-i * 0.17}s` }} />)}</div><span>Ilustrasi cuaca uji · transisi energi 8 detik</span></div>
    {!solarOnly && <label className="journey-sort">Angin uji (m/s)<input aria-label="Angin uji (m/s)" type="range" min="0" max="20" value={wind} onChange={e => setWind(Number(e.target.value))} /><span>{wind} m/s · ilustrasi, bukan angin lokasi</span><select aria-label="Arah angin uji" value={windDirection} onChange={e => setWindDirection(Number(e.target.value))}><option value="1">Dari kiri ke kanan</option><option value="-1">Dari kanan ke kiri</option></select></label>}
    <div className="lab-inputs">{([["Panel (kWp)", kwp, setKwp], ["Beban rumah (kW)", load, setLoad], ["Baterai (kWh)", battery, setBattery]] as const).map(([label, value, setter]) => <label key={label}>{label}<input aria-label={label} type="number" min="0" max="100" step="0.1" value={value} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0 && n <= 100) { setter(n); reset(); } }} /></label>)}</div>
    <table className="lab-comparison"><caption>Beban sama · pembanding cerah tanpa baterai</caption><thead><tr><th>Pasokan</th><th>Sebelum</th><th>Skenario ini</th></tr></thead><tbody><tr><th>Panel surya</th><td>{fmtNumber(r.clearSolar, 2)} kW</td><td>{fmtNumber(r.solar, 2)} kW</td></tr><tr><th>Jaringan</th><td>{fmtNumber(r.clearGrid, 2)} kW</td><td>{fmtNumber(r.grid, 2)} kW</td></tr><tr><th>CO₂ jaringan</th><td>{factor == null ? "—" : fmtNumber(r.clearGrid * factor, 3)} kg/jam</td><td>{factor == null ? "—" : fmtNumber(r.grid * factor, 3)} kg/jam</td></tr></tbody></table>
    <div className="lab-flow" data-running={paused == null} aria-label="Aliran energi eksperimen"><span>Surya {fmtNumber(r.direct, 2)} kW</span><ArrowRight /><span>Rumah</span><span>Jaringan {fmtNumber(r.grid, 2)} kW</span><ArrowRight /><span>Rumah</span><span>Baterai {fmtNumber(r.discharge, 2)} kW</span><ArrowRight /><span>Rumah</span></div>
    <p className="iot-monitor__insight">{weather === "night" ? "Malam: panel berhenti menghasilkan listrik." : weather.includes("rain") ? "Hujan: radiasi berkurang sehingga produksi panel turun." : weather === "cloudy" ? "Mendung: panel tetap menghasilkan listrik dengan produksi lebih rendah." : "Cerah: prioritaskan pemakaian saat produksi panel mencukupi."} {r.grid > 0.01 ? "Jaringan membantu memenuhi kebutuhan rumah." : "Kebutuhan rumah tercukupi dari surya dan baterai pada skenario ini."}</p>
    <div className="energy-impact"><strong>Baterai {fmtNumber(r.stored, 3)} / {fmtNumber(battery, 1)} kWh</strong><progress max={battery || 1} value={r.stored} aria-label="Isi baterai simulasi" /><p>Mengisi {fmtNumber(r.charge, 2)} kW · memasok {fmtNumber(r.discharge, 2)} kW. Tanpa baterai, kebutuhan jaringan saat ini {fmtNumber(r.withoutBattery, 2)} kW.</p></div>
    <p><strong>Saran untuk rumahmu:</strong> {r.solar - load >= 0.3 ? "Ada surplus setidaknya 300 W. Coba jadwalkan satu perangkat yang dayanya sesuai surplus, sambil memeriksa kebutuhan perangkat lain." : "Tunda perangkat tambahan berdaya besar bila ingin mengurangi pemakaian jaringan. Utamakan kebutuhan penting."} Ini saran kondisi uji, bukan jadwal prakiraan.</p>
    <div className="journey-actions"><button type="button" onClick={() => { if (paused == null) setPaused(now); else { setStart(start + now - paused); setPaused(null); } }}>{paused == null ? "Jeda eksperimen" : "Lanjut eksperimen"}</button><button type="button" onClick={reset}>Ulangi eksperimen</button></div>
    <details className="journey-details"><summary>Asumsi baterai dan cuaca</summary><p>Hujan ringan 180 W/m², lebat 65 W/m²; bukan penurunan persentase tetap. Produksi = kapasitas × radiasi / 1.000 × 0,78. Beban tetap sesuai input. Baterai mulai kosong, lalu mendapat 30 menit pengisian surya saat cerah sebelum cuaca berubah; jika tidak ada surplus, tetap kosong. Daya isi/pakai maksimum 2 kW, efisiensi 95% per arah. Tidak mengisi dari jaringan. Arah jatuh hujan pada ilustrasi dua dimensi bukan orientasi geografis peta. Eksperimen maksimal satu jam; ulangi untuk mulai lagi.</p><p>CO₂ jaringan = daya impor × faktor emisi jaringan aplikasi. Bila faktor belum tersedia, ditampilkan tanda kosong. Surplus ekspor tidak diberi kredit CO₂. Angka monitor rumah tidak diubah eksperimen ini. Semua input dan hasil bersifat simulasi, bukan catatan pemasangan atau sensor fisik.</p></details>
  </section>;
}
