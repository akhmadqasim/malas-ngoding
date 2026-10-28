import { ChevronLeft, Pause, Play } from "../icons.ts";
import { Button, I18nProvider, Label, Skeleton, Slider } from "@heroui/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtNumber } from "../../shared/format.ts";
import { witaMs } from "../../shared/pvForecast.ts";
import { rooftopScenario, type ScenarioBasis } from "../../shared/scenario.ts";
import { type TwinBasis, type TwinHour, twinScale, twinTimeline } from "../../shared/twin.ts";
import type { RegionSummary } from "../../shared/types.ts";
import { api } from "../api.ts";
import { AnimatedNumber } from "../components/AnimatedNumber.tsx";
import { chem } from "../components/Chem.tsx";
import { Estimate } from "../components/Estimate.tsx";
import { Segmented } from "../components/Segmented.tsx";
import { useAppStore } from "../store.ts";
import { sensorFrame, type WeatherCase } from "../../shared/telemetry.ts";
import { useSensorClock, useTelemetrySettings } from "../telemetry.ts";
import { WEATHER_CASES } from "./TelemetryPanel.tsx";

/** One hour of the day per step while the day plays: 24 hours in about 17 s. */
export const PLAY_STEP_MS = 700;
/** The forecast is read again this often while the twin is open (the server caches it for an hour). */
const RESYNC_MS = 10 * 60_000;

type Solar = "none" | "scenario";

// Module-level formatters keep AnimatedNumber from restarting its count on every render.
const mw = (kw: number) => fmtNumber(kw / 1000);
const tonnes = (kg: number) => fmtNumber(kg / 1000);

const WITA = "Asia/Makassar";
const clock = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: WITA });
const day = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", timeZone: WITA });
const syncClock = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: WITA });
const sensorClock = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: WITA });

/**
 * The digital twin's day in the left sheet: from the current hour, the next 24 hours of Kalimantan Timur
 * hour by hour. Each region's load follows a daily curve (an assumption), rooftop solar follows the live
 * Open-Meteo forecast at that region, and the CO2 columns swell at the evening peak and dip where the sun
 * covers the load. The map's light follows the hour shown. The numbers come from shared/twin.ts.
 */
export function TwinView({ regions }: { regions: RegionSummary[] }) {
  return (
    <I18nProvider locale="id-ID">
      <TwinBody regions={regions} />
    </I18nProvider>
  );
}

function TwinBody({ regions }: { regions: RegionSummary[] }) {
  const now = useSensorClock();
  const [liveMode, setLiveMode] = useState(true);
  const [weatherCase, setWeatherCase] = useState<WeatherCase>("auto");
  const setRegionReading = useTelemetrySettings(s => s.setRegionReading);
  const [basis, setBasis] = useState<TwinBasis | null>(null);
  const [scenario, setScenario] = useState<ScenarioBasis | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [solar, setSolar] = useState<Solar>("none");
  const share = useAppStore((s) => s.scenarioShare);
  const setScale = useAppStore((s) => s.setScenarioScale);
  const setTwinTime = useAppStore((s) => s.setTwinTime);
  const setOpen = useAppStore((s) => s.setTwinOpen);

  const load = useCallback(() => {
    setFailed(null);
    let live = true;
    Promise.all([api.twin(), api.scenario()])
      .then(([t, s]) => {
        if (!live) return;
        setBasis(t);
        setScenario(s);
      })
      .catch((err: unknown) => live && setFailed(err instanceof Error ? err.message : "Data kembar digital gagal dimuat."));
    return () => {
      live = false;
    };
  }, []);
  useEffect(load, [load]);
  // Stay in step with the weather: read the forecast again every 10 minutes while open.
  useEffect(() => {
    const timer = setInterval(() => {
      api.twin().then(setBasis, () => {});
    }, RESYNC_MS);
    return () => clearInterval(timer);
  }, []);

  const kWp = useMemo(() => {
    if (solar === "none" || !scenario) return new Map<string, number>();
    return new Map(rooftopScenario(regions, scenario, share).regions.map((r) => [r.id, r.kWp]));
  }, [solar, scenario, regions, share]);
  const timeline = useMemo(() => (basis ? twinTimeline(regions, basis, kWp) : []), [basis, regions, kWp]);
  const last = Math.max(timeline.length - 1, 0);
  const liveIndex = timeline.findIndex(h => now >= witaMs(h.time) && now < witaMs(h.time) + 3600_000);
  const at = liveMode ? Math.max(0, liveIndex) : Math.min(index, last);
  const baseHour = timeline[at];
  const hour = useMemo<TwinHour | undefined>(() => {
    if (!liveMode || !baseHour || !basis) return baseHour;
    const rows = baseHour.regions.map(row => {
      const forecast = basis.regions.find(r => r.id === row.id)?.hours.find(h => h.time === baseHour.time);
      const frame = sensorFrame({ id: row.id, kwhYear: 0, baseLoadKw: row.loadKw, kWp: kWp.get(row.id) ?? 0, gridFactor: basis.gridFactorKgPerKwh }, now, weatherCase, forecast);
      return { ...row, loadKw: frame.loadKw, solarKw: frame.solarKw, gridKw: frame.importKw, co2KgPerHour: frame.co2KgHour, ghiWm2: frame.irradiance, cloudPct: frame.cloudPct, raining: frame.rainMmHour > 0 };
    });
    const sum = (key: "loadKw" | "solarKw" | "gridKw" | "co2KgPerHour") => rows.reduce((total, row) => total + row[key], 0);
    return { ...baseHour, regions: rows, loadKw: sum("loadKw"), solarKw: sum("solarKw"), gridKw: sum("gridKw"), co2KgPerHour: sum("co2KgPerHour"), surplusKw: rows.reduce((n, r) => n + Math.max(0, r.solarKw - r.loadKw), 0) };
  }, [liveMode, baseHour, basis, kWp, now, weatherCase]);

  // The map follows the hour shown: the CO2 columns and the light.
  useEffect(() => {
    if (!hour) return;
    setScale(twinScale(hour, regions));
    setTwinTime(hour.time);
    setRegionReading(liveMode ? { co2KgHour: hour.co2KgPerHour, regionRates: Object.fromEntries(hour.regions.map(r => [r.id, r.co2KgPerHour])), time: now } : null);
  }, [hour, regions, setScale, setTwinTime, liveMode, setRegionReading, now]);
  useEffect(() => () => setRegionReading(null), [setRegionReading]);

  // Playing the day: one hour per step, stopping at the end.
  const lastRef = useRef(last);
  lastRef.current = last;
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setIndex((i) => {
        if (i >= lastRef.current) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, PLAY_STEP_MS);
    return () => clearInterval(timer);
  }, [playing]);
  const togglePlay = () => {
    setLiveMode(false);
    if (!playing && at >= last) setIndex(0);
    setPlaying((p) => !p);
  };

  const raining = hour ? regions.filter((r) => hour.regions.find((x) => x.id === r.id)?.raining).map((r) => r.name) : [];
  const nameOf = (id: string) => regions.find((r) => r.id === id)?.name ?? id;
  const borrowed = (basis?.regions ?? []).flatMap((r) => (r.borrowedFrom ? [`${nameOf(r.id)} memakai prakiraan ${nameOf(r.borrowedFrom)}`] : []));

  return (
    <div className="sheet__body twin" role="region" aria-label="Kembar digital 24 jam">
      <Button variant="ghost" size="sm" className="back" onPress={() => setOpen(false)}>
        <ChevronLeft aria-hidden />
        Semua wilayah
      </Button>
      <h2 className="place">Digital twin energi</h2>
      <p className="twin__intro">Sensor virtual wilayah mengubah beban, produksi surya, dan emisi pada peta setiap 2 detik. Pilih prakiraan 24 jam untuk menelusuri waktu.</p>
      <div className="twin-live-mode"><Button size="sm" variant={liveMode ? "primary" : "ghost"} onPress={() => { setPlaying(false); setLiveMode(true); }}>Simulasi langsung</Button><Button size="sm" variant={liveMode ? "ghost" : "primary"} onPress={() => { setLiveMode(false); setIndex(0); }}>Prakiraan 24 jam</Button></div>
      {liveMode && <><div className="twin-live-status" role="status"><span className="iot-heartbeat" /><strong>Sensor simulasi aktif</strong><span>{sensorClock.format(now)} WITA</span></div><div className="iot-weather-controls" role="group" aria-label="Skenario cuaca wilayah">{WEATHER_CASES.map(c => <button key={c.key} type="button" aria-pressed={weatherCase === c.key} onClick={() => setWeatherCase(c.key)}>{c.label}</button>)}</div><p className="sheet__note">Cuaca uji siang bersifat sintetis. Pilih Skenario PLTS atap di bawah untuk melihat pengaruhnya pada produksi.</p></>}
      <p className="place__meta twin__sync">
        {basis
          ? basis.stale
            ? `Prakiraan lama dipakai, Open-Meteo belum terjangkau (dicek ${syncClock.format(new Date(basis.syncedAt))} WITA)`
            : `Tersinkron ${syncClock.format(new Date(basis.syncedAt))} WITA dengan prakiraan cuaca Open-Meteo`
          : "Menyinkronkan dengan prakiraan cuaca..."}
      </p>

      {failed ? (
        <div className="scenario__failure" role="alert">
          <p>{failed}</p>
          <Button size="sm" onPress={load}>
            Coba lagi
          </Button>
        </div>
      ) : !hour ? (
        <div className="scenario__loading" aria-busy>
          <Skeleton className="scenario__skeleton scenario__skeleton--big" />
          <Skeleton className="scenario__skeleton" />
          <Skeleton className="scenario__skeleton" />
        </div>
      ) : (
        <>
          <div className="readout twin__clock">
            <p className="readout__label">{liveMode ? "Waktu sensor simulasi" : at === 0 ? "Awal prakiraan" : "Jam di peta"}</p>
            <p className="readout__figure num">{liveMode ? sensorClock.format(now) : clock.format(new Date(witaMs(hour.time)))}</p>
            <p className="readout__unit">WITA, {day.format(new Date(witaMs(hour.time)))}</p>
          </div>

          <div className="twin__controls">
            <Button variant="primary" size="sm" className="twin__play" onPress={togglePlay}>
              {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
              {playing ? "Jeda" : "Putar 24 jam"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={at === 0}
              onPress={() => {
                setPlaying(false);
                setIndex(0);
                setLiveMode(true);
              }}
            >
              Sekarang
            </Button>
          </div>
          <Slider
            className="scenario__slider twin__slider"
            value={at}
            minValue={0}
            maxValue={last}
            step={1}
            onChange={(v) => {
              setPlaying(false);
              setLiveMode(false);
              setIndex(Array.isArray(v) ? (v[0] ?? 0) : v);
            }}
          >
            <Label>Geser jam</Label>
            <Slider.Output>{`+${at} jam`}</Slider.Output>
            <Slider.Track>
              <Slider.Fill />
              <Slider.Thumb />
            </Slider.Track>
          </Slider>

          <DayChart timeline={timeline} at={at} />

          <div className="twin__solar">
            <span className="group-label" id="twin-solar">
              PLTS atap
            </span>
            <Segmented
              labelledBy="twin-solar"
              options={[
                { key: "none", label: "Tanpa PLTS tambahan" },
                { key: "scenario", label: `Skenario ${fmtNumber(share * 100)}%`, title: "Kapasitas dari Skenario PLTS atap" },
              ]}
              value={solar}
              onChange={setSolar}
              indicatorId="twin-solar-indicator"
            />
          </div>

          <dl className="facts">
            <TwinFact label="Beban listrik" unit="MW">
              <AnimatedNumber value={hour.loadKw} format={mw} />
            </TwinFact>
            <TwinFact label="Dari PLTS atap" unit="MW">
              <AnimatedNumber value={hour.solarKw} format={mw} />
            </TwinFact>
            <TwinFact label="Dari jaringan PLN" unit="MW">
              <AnimatedNumber value={hour.gridKw} format={mw} />
            </TwinFact>
            <TwinFact label="Emisi CO2" unit="ton per jam">
              <AnimatedNumber value={hour.co2KgPerHour} format={tonnes} />
            </TwinFact>
          </dl>
          <p className="twin__weather">{raining.length ? `Hujan pada jam ini: ${raining.join(", ")}.` : "Tidak ada wilayah yang hujan pada jam ini."}</p>
          {borrowed.length > 0 && <p className="twin__weather">{`Prakiraan belum terbaca di beberapa wilayah: ${borrowed.join("; ")}.`}</p>}

          <footer className="sheet__foot">
            <p className="sheet__note">Simulasi berbasis model, belum terhubung ke sensor lapangan. Variasi 2 detik dihasilkan perangkat virtual; bukan pengukuran emisi atau konsumsi nyata. Tinggi kolom: emisi pada jam itu dibanding jam rata-rata wilayahnya. Cahaya peta mengikuti jam.</p>
            <p className="sheet__source">
              {chem(
                `Pola beban harian: asumsi pola umum beban PLN dengan puncak pukul 19.00 (belum ada data per jam untuk Kaltim). Radiasi matahari dan awan: prakiraan Open-Meteo per wilayah. Faktor emisi jaringan ${fmtNumber(basis!.gridFactorKgPerKwh, 2)} kg CO2 per kWh.`,
              )}
            </p>
          </footer>
        </>
      )}
    </div>
  );
}

/** The day at a glance: load (line), what the grid supplies (amber area) and rooftop solar (yellow), with the hour shown. */
function DayChart({ timeline, at }: { timeline: TwinHour[]; at: number }) {
  const W = 300;
  const H = 72;
  const max = Math.max(...timeline.map((h) => Math.max(h.loadKw, h.solarKw)), 1);
  const x = (i: number) => (timeline.length > 1 ? (i / (timeline.length - 1)) * W : 0);
  const y = (kw: number) => H - (kw / max) * (H - 4);
  const line = (f: (h: TwinHour) => number) => timeline.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(f(h)).toFixed(1)}`).join("");
  const area = (f: (h: TwinHour) => number) => `${line(f)}L${W},${H}L0,${H}Z`;
  const first = timeline[0];
  const end = timeline.at(-1);
  return (
    <figure className="twin__chart" aria-label="Beban, jaringan PLN dan PLTS atap selama 24 jam">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        <path className="twin__grid" d={area((h) => h.gridKw)} />
        <path className="twin__sun" d={area((h) => Math.min(h.solarKw, h.loadKw))} />
        <path className="twin__load" d={line((h) => h.loadKw)} />
        <line className="twin__cursor" x1={x(at)} x2={x(at)} y1={0} y2={H} />
      </svg>
      <figcaption className="twin__axis num">
        <span>{first ? clock.format(new Date(witaMs(first.time))) : ""}</span>
        <span className="twin__key">
          <i className="twin__swatch twin__swatch--grid" /> PLN <i className="twin__swatch twin__swatch--sun" /> Surya
        </span>
        <span>{end ? clock.format(new Date(witaMs(end.time))) : ""}</span>
      </figcaption>
    </figure>
  );
}

function TwinFact({ label, unit, children }: { label: string; unit: string; children: ReactNode }) {
  return (
    <div className="fact">
      <dt className="fact__label">{chem(label)}</dt>
      <dd className="fact__value">
        <span className="fact__number">{children}</span>
        <span className="fact__unit">
          {unit}, <Estimate />
        </span>
      </dd>
    </div>
  );
}
