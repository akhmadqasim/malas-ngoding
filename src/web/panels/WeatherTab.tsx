import { Skeleton } from "@heroui/react";
import { Clouds, Droplet, Sun } from "@gravity-ui/icons";
import { motion } from "motion/react";
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { fmtNumber } from "../../shared/format.ts";
import { dropSentence, isRainyHour, NEAR_CLEAR_PCT } from "../../shared/pvForecast.ts";
import type { PvHour } from "../../shared/types.ts";
import { api, type WeatherResponse } from "../api.ts";
import { Estimate } from "../components/Estimate.tsx";
import { forecastIsCurrent } from "../map/autoRain.ts";
import { DURATION, EASE_OUT } from "../motion.ts";
import { useAppStore } from "../store.ts";
import type { BuildingTabProps } from "./buildingTabs.ts";
import { TabFailure, useChartCursor, useWidth } from "./tabParts.tsx";
import {
  type DayRow,
  dayLabel,
  dayRows,
  defaultSolarRequest,
  forecastWindow,
  hourLabel,
  niceScale,
  rainSpans,
  type Sky,
  tickText,
  witaDate,
} from "./solarWeather.ts";

/** Panel size used when the building has no simulated size (simulation failed, or the roof is too small). */
const SAMPLE_KWP = 1;


const SKY_TEXT: Record<Sky, string> = { cerah: "Cerah", berawan: "Berawan", hujan: "Hujan" };
const SKY_ICON = { cerah: Sun, berawan: Clouds, hujan: Droplet } as const;

type Sizing = { kWp: number; sample: boolean };

/**
 * The Cuaca tab: the Open-Meteo forecast for this building, turned into panel output. The panels are the
 * size the Surya tab simulated (or the default simulation); the hourly chart covers 72 hours with the rain
 * hours shaded, and each day says how far it falls below a clear sky at this spot (model) and why.
 */
export function WeatherTab(props: BuildingTabProps) {
  return <WeatherForecast key={props.building.featureId} {...props} />;
}

function WeatherForecast({ building, at }: BuildingTabProps) {
  const featureId = building.featureId;
  const simulated = useAppStore((s) => (s.solarSizing?.featureId === featureId ? s.solarSizing.kWp : null));
  const setSolarSizing = useAppStore((s) => s.setSolarSizing);
  const [fallback, setFallback] = useState(false);
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [lng, lat] = at;

  // No size from the Surya tab yet: run its default simulation, so both tabs talk about the same panels.
  useEffect(() => {
    if (simulated !== null) return;
    let live = true;
    api
      .simulateSolar(defaultSolarRequest(building, at))
      .then((r) => {
        if (live) setSolarSizing({ featureId, kWp: r.kWp });
      })
      .catch(() => {
        if (live) setFallback(true);
      });
    return () => {
      live = false;
    };
    // The building and point only matter for the first sizing; `featureId` keys the whole tab.
  }, [simulated, featureId, setSolarSizing]);

  const sizing: Sizing | null =
    simulated !== null && simulated > 0 ? { kWp: simulated, sample: false } : simulated === 0 || fallback ? { kWp: SAMPLE_KWP, sample: true } : null;
  const kWp = sizing?.kWp ?? null;

  useEffect(() => {
    if (kWp === null) return;
    let live = true;
    api
      .weather(lat, lng, kWp)
      .then((w) => {
        if (!live) return;
        setWeather(w);
        setFailure(null);
      })
      .catch((err: unknown) => {
        if (live) setFailure(err instanceof Error ? err.message : "Prakiraan cuaca gagal dimuat.");
      });
    return () => {
      live = false;
    };
  }, [lat, lng, kWp, attempt]);

  if (failure && !weather) return <TabFailure what="Prakiraan cuaca" message={failure} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!weather || !sizing) return <WeatherSkeleton />;
  return <Forecast weather={weather} sizing={sizing} at={at} />;
}

function Forecast({ weather, sizing, at }: { weather: WeatherResponse; sizing: Sizing; at: [number, number] }) {
  // The forecast is read against the clock once per answer, so the chart does not shift while you look.
  const now = useMemo(() => Date.now(), [weather]);
  const hours = useMemo(() => forecastWindow(weather.hours, now), [weather, now]);
  const rows = useMemo(() => dayRows(weather.days, weather.hours, now, { lng: at[0], lat: at[1], kWp: sizing.kWp }), [weather, now, at, sizing.kWp]);
  const { current } = weather;
  const sky: Sky = current.raining ? "hujan" : current.cloudPct >= 60 ? "berawan" : "cerah";
  const SkyIcon = SKY_ICON[sky];
  // An old forecast (Open-Meteo down) says nothing about now; the stale note below says why the line is gone.
  const aboutNow = forecastIsCurrent(weather, now);

  return (
    <div className="sw-tab sw-weather">
      {aboutNow && (
        <p className="sw-weather__now">
          <SkyIcon className="sw-weather__icon" aria-hidden />
          <span>
            Sekarang <strong className="sw-weather__sky">{SKY_TEXT[sky].toLowerCase()}</strong>, awan{" "}
            <span className="num">{fmtNumber(current.cloudPct)}%</span>
            {current.precipMm > 0 && (
              <>
                , hujan <span className="num">{fmtNumber(current.precipMm, 1)} mm</span>
              </>
            )}
          </span>
        </p>
      )}
      {weather.stale && (
        <p className="sw-tab__warn">Open-Meteo sedang tidak bisa dihubungi, jadi ini prakiraan terakhir yang tersimpan.</p>
      )}
      <HourlyChart hours={hours} sizing={sizing} now={now} />
      <DayList rows={rows} />
      <footer className="sw-tab__foot">
        <p className="sw-tab__note">
          Produksi = kapasitas panel × radiasi matahari × 0,78 (rugi panas, kabel, inverter). Awan dan hujan menurunkan radiasi, jadi
          produksinya ikut turun. Langit cerah dihitung dari posisi matahari di titik ini (model Haurwitz).
        </p>
        <p className="sw-tab__source">Sumber: prakiraan cuaca Open-Meteo per jam, diperbarui tiap jam.</p>
      </footer>
    </div>
  );
}

/** Panel output per hour for the next 72 hours, with the rain hours shaded. */
function HourlyChart({ hours, sizing, now }: { hours: PvHour[]; sizing: Sizing; now: number }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const cursor = useChartCursor(hours.length);
  const { active } = cursor;
  const today = witaDate(now);
  const total = hours.reduce((s, h) => s + h.pvKwh, 0);
  const scale = niceScale(Math.max(0, ...hours.map((h) => h.pvKwh)));
  const H = 132;
  const AXIS = 32;
  const BOTTOM = 20;
  const TOP = 6;
  const plotW = Math.max(0, width - AXIS - 4);
  const n = hours.length;
  const x = (i: number) => AXIS + (n > 1 ? (i / (n - 1)) * plotW : 0);
  const y = (v: number) => H - BOTTOM - (Math.max(0, v) / scale.max) * (H - BOTTOM - TOP);
  const spans = rainSpans(hours);
  const half = n > 1 ? plotW / (n - 1) / 2 : 0;

  const line = hours.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(h.pvKwh).toFixed(1)}`).join("");
  const area = n ? `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : "";
  // Day boundaries (midnight) and a label in the middle of each day's stretch.
  const days = useMemo(() => {
    const out: { date: string; from: number; to: number }[] = [];
    hours.forEach((h, i) => {
      const date = h.time.slice(0, 10);
      const last = out.at(-1);
      if (last && last.date === date) last.to = i;
      else out.push({ date, from: i, to: i });
    });
    return out;
  }, [hours]);

  const hourText = (h: PvHour) =>
    `${dayLabel(h.time.slice(0, 10), today)} ${hourLabel(h.time)}: ${fmtNumber(h.pvKwh, 2)} kWh${isRainyHour(h) ? `, hujan ${fmtNumber(h.precipMm, 1)} mm` : `, awan ${fmtNumber(h.cloudPct)}%`}`;
  const at = active === null ? null : hours[active];
  const reading = at ? hourText(at) : `${n} jam ke depan: ${fmtNumber(total, 1)} kWh`;
  const spoken = cursor.keyboard === null ? undefined : hours[cursor.keyboard];

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    if (n < 2 || px < AXIS - half) return cursor.point(null);
    cursor.point(Math.min(n - 1, Math.max(0, Math.round(((px - AXIS) / plotW) * (n - 1)))));
  };

  return (
    <section className="sw-chart" aria-labelledby="pv-chart-title">
      <h3 className="sw-chart__title" id="pv-chart-title">
        Produksi per jam, panel {fmtNumber(sizing.kWp, 2)} kWp
      </h3>
      <p className="sw-chart__reading num">
        {reading}, <Estimate />
      </p>
      <p className="sw-sr-only" aria-live="polite">
        {spoken ? `${hourText(spoken)}, perkiraan` : ""}
      </p>
      <div ref={box} className="sw-chart__box">
        {width > 0 && n > 0 && (
          <svg
            className="sw-chart__svg"
            width={width}
            height={H}
            role="group"
            aria-roledescription="grafik"
            aria-label={`Produksi panel per jam untuk ${n} jam ke depan, total ${fmtNumber(total, 1)} kWh; ${spans.length ? `${spans.reduce((s, [a, b]) => s + b - a + 1, 0)} jam hujan` : "tanpa hujan"}. Panah kiri dan kanan membaca tiap jam.`}
            tabIndex={0}
            onPointerMove={pick}
            onPointerLeave={() => cursor.point(null)}
            onKeyDown={cursor.onKeyDown}
            onBlur={cursor.clear}
          >
            <g aria-hidden>
            <defs>
              <clipPath id="pv-reveal">
                <motion.rect
                  x={0}
                  y={0}
                  height={H}
                  initial={{ width: 0 }}
                  animate={{ width }}
                  transition={{ duration: DURATION.bar, ease: EASE_OUT }}
                />
              </clipPath>
            </defs>
            {spans.map(([a, b]) => (
              <rect
                key={a}
                className="sw-chart__rain"
                x={Math.max(AXIS, x(a) - half)}
                width={Math.min(x(b) + half, AXIS + plotW) - Math.max(AXIS, x(a) - half)}
                y={TOP}
                height={H - BOTTOM - TOP}
              />
            ))}
            {scale.ticks.map((t) => (
              <g key={t}>
                <line className="sw-chart__grid" x1={AXIS} x2={AXIS + plotW} y1={y(t)} y2={y(t)} />
                <text className="sw-chart__tick" x={AXIS - 6} y={y(t)} dy="0.32em" textAnchor="end">
                  {tickText(t)}
                </text>
              </g>
            ))}
            {days.slice(1).map((d) => (
              <line key={d.date} className="sw-chart__day" x1={x(d.from) - half} x2={x(d.from) - half} y1={TOP} y2={H - BOTTOM + 4} />
            ))}
            {days.map((d) =>
              // A day needs room for its name; the first and last stretch can be a few hours only.
              x(d.to) - x(d.from) >= 44 ? (
                <text key={d.date} className="sw-chart__tick" x={(x(d.from) + x(d.to)) / 2} y={H - 4} textAnchor="middle">
                  {dayLabel(d.date, today)}
                </text>
              ) : null,
            )}
            <g clipPath="url(#pv-reveal)">
              <path className="sw-chart__area" d={area} />
              <path className="sw-chart__line" d={line} />
            </g>
            {at && active !== null && (
              <g className="sw-chart__cursor">
                <line x1={x(active)} x2={x(active)} y1={TOP} y2={H - BOTTOM} />
                <circle cx={x(active)} cy={y(at.pvKwh)} r={4} />
              </g>
            )}
            </g>
          </svg>
        )}
      </div>
      <div className="sw-chart__legend">
        <span className="sw-chart__key">
          <span className="sw-chart__swatch sw-chart__swatch--line" aria-hidden />
          kWh per jam
        </span>
        <span className="sw-chart__key">
          <span className="sw-chart__swatch sw-chart__swatch--rain" aria-hidden />
          Jam hujan
        </span>
        {sizing.sample && <span className="sw-chart__key sw-chart__key--note">contoh panel 1 kWp</span>}
      </div>
    </section>
  );
}

/** One row per day: the sky, the day's output and what the rain costs. */
function DayList({ rows }: { rows: DayRow[] }) {
  return (
    <section className="sw-days" aria-labelledby="days-title">
      <h3 className="sw-chart__title" id="days-title">
        Produksi per hari
      </h3>
      <ol className="sw-days__list">
        {rows.map((r) => {
          const Icon = SKY_ICON[r.sky];
          return (
            <li key={r.date} className="sw-days__row">
              <Icon className="sw-days__icon" aria-hidden />
              <span className="sw-days__name">
                {r.label}
                <span className="sw-days__sky">{SKY_TEXT[r.sky]}</span>
              </span>
              <span className="sw-days__value">
                <span className="num">{fmtNumber(r.pvKwh, 1)}</span> kWh
              </span>
              {r.dropPct !== null && (
                <span className="sw-days__drop">
                  {r.dropPct >= NEAR_CLEAR_PCT ? (
                    <>
                      produksi turun <span className="num">{r.dropPct}%</span> karena {r.cause}
                    </>
                  ) : (
                    dropSentence(r)
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="sw-chart__unit">
        Turunnya dibanding langit cerah (model) di titik ini, untuk panel yang sama, <Estimate />
      </p>
    </section>
  );
}

function WeatherSkeleton() {
  return (
    <div className="sw-tab__skeleton" aria-busy="true" aria-label="Memuat prakiraan cuaca">
      <Skeleton animationType="none" className="sw-skeleton-line" />
      <Skeleton animationType="none" className="sw-skeleton-block" />
      <Skeleton animationType="none" className="sw-skeleton-line sw-skeleton-line--wide" />
      <Skeleton animationType="none" className="sw-skeleton-line sw-skeleton-line--wide" />
      <Skeleton animationType="none" className="sw-skeleton-line sw-skeleton-line--wide" />
    </div>
  );
}

