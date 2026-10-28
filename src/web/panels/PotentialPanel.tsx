import { ChevronLeft, Hammer, Sun, Wind, ArrowUp } from "../icons.ts";
import { Button, I18nProvider, Label, Skeleton, Slider } from "@heroui/react";
import { farmRadiusM, MAX_SOLAR_MWP, MAX_TURBINES, solarFarm, windFarm } from "../../shared/buildSite.ts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtNumber } from "../../shared/format.ts";
import { cellPotential, type CellPotential, pvYieldMwhPerMwp, scaleBetween } from "../../shared/potential.ts";
import { api, type PotentialCollection, type PotentialProperties } from "../api.ts";
import { Estimate } from "../components/Estimate.tsx";
import { presetTone } from "../map/effects.ts";
import { type PotentialKind, useAppStore } from "../store.ts";
import { mixRamp, rampTokens } from "../theme.ts";
import { compassName } from "../../shared/wind.ts";

const KINDS = [
  { key: "sun" as const, label: "Surya (PLTS)" },
  { key: "wind" as const, label: "Angin (PLTB)" },
];

/** Grid coordinates as an atlas writes them: "117,5° BT, 0,5° LS". */
function where(p: Pick<PotentialProperties, "lng" | "lat">, precision = 1): string {
  const lat = `${fmtNumber(Math.abs(p.lat), precision)}° ${p.lat < 0 ? "LS" : "LU"}`;
  return `${fmtNumber(p.lng, precision)}° BT, ${lat}`;
}

/**
 * The renewable potential map in the left sheet: NASA POWER's 25-year sun and wind over Kalimantan Timur,
 * cell by cell. The best cells are ranked; a cell picked on the map or in the list shows what 1 MWp of
 * ground-mounted solar or one 4,5 MW turbine would make there. The wind is stated as it is: too weak.
 */
export function PotentialView() {
  const cells = useAppStore((s) => s.potentialCells);
  const kind = useAppStore((s) => s.potentialKind);
  const pickedId = useAppStore((s) => s.potentialCellId);
  const setKind = useAppStore((s) => s.setPotentialKind);
  const pick = useAppStore((s) => s.setPotentialCell);
  const setData = useAppStore((s) => s.setPotentialData);
  const setOpen = useAppStore((s) => s.setPotentialOpen);
  const project = useAppStore(s => s.buildSite);
  const clickedAt = useAppStore(s => s.potentialClickAt);
  const tone = useAppStore((s) => presetTone(s.lightPreset));
  const [failed, setFailed] = useState<string | null>(null);

  const features = cells?.features.map((f) => f.properties) ?? [];
  const a = cells?.assumptions;
  const potential = useMemo(() => new Map(a ? features.map((p) => [p.id, cellPotential(p, a)]) : []), [cells]);
  // The sun's scale spans the cells' own range; the wind's runs from calm to the viable speed.
  const range = useMemo(() => {
    if (!a || !features.length) return { lo: 0, hi: 1 };
    if (kind === "wind") return { lo: 0, hi: a.wind.viableMeanMs };
    const g = features.map((p) => p.ghi);
    return { lo: Math.min(...g), hi: Math.max(...g) };
  }, [cells, kind]);
  const value = useCallback(
    (p: PotentialProperties) => (kind === "sun" ? p.ghi : (potential.get(p.id)?.hubMs ?? 0)),
    [kind, potential],
  );

  const load = useCallback(() => {
    setFailed(null);
    api
      .potential()
      .then((fc) => {
        const s = scaleBetween(fc.features.map((f) => f.properties), (p) => p.ghi, Math.min(...fc.features.map((f) => f.properties.ghi)), Math.max(...fc.features.map((f) => f.properties.ghi)));
        setData(fc, new Map([...s].map(([p, t]) => [p.id, t])));
      })
      .catch((err: unknown) => setFailed(err instanceof Error ? err.message : "Data potensi gagal dimuat."));
  }, [setData]);
  useEffect(() => {
    if (!cells) load();
  }, [cells, load]);

  // The map's colours follow the kind shown.
  useEffect(() => {
    if (!cells) return;
    const s = scaleBetween(features, value, range.lo, range.hi);
    setData(cells, new Map([...s].map(([p, t]) => [p.id, t])));
  }, [kind, cells && potential]);

  // PLTS needs gentle land as much as sun: the sun is ranked by irradiance times the share of land at or below 5°.
  const rank = (p: PotentialProperties) => (kind === "sun" && p.terrain ? p.ghi * (p.terrain.flat5Pct / 100) : value(p));
  const ranked = [...features].sort((x, y) => rank(y) - rank(x)).slice(0, 5);
  const picked = features.find((p) => p.id === pickedId) ?? null;
  const ramp = rampTokens(kind, tone);
  const t = (p: PotentialProperties) => (range.hi > range.lo ? Math.min(Math.max((value(p) - range.lo) / (range.hi - range.lo), 0), 1) : 0.5);
  const best = ranked[0];
  const bestWind = best && kind === "wind" ? potential.get(best.id) : undefined;

  return (
    <div className="sheet__body potential" role="region" aria-label="Potensi energi terbarukan">
      <Button variant="ghost" size="sm" className="back" onPress={() => setOpen(false)}>
        <ChevronLeft aria-hidden />
        Semua wilayah
      </Button>
      <h2 className="place">Rencana proyek</h2>
      <p className="place__meta scenario__lede">Susun simulasi pembangkit dari teknologi dan lokasi yang tepat.</p>
      <ol className="planning-steps" aria-label="Tahapan perencanaan">
        {["Teknologi", "Lokasi", "Kapasitas", "Hasil"].map((label, i) => <li key={label} data-done={i < (project ? 3 : picked ? 2 : 1) || undefined} aria-current={i === (project ? 3 : picked ? 2 : 1) ? "step" : undefined}><span>{i + 1}</span>{label}</li>)}
      </ol>

      <details className="potential__kind planning-tech-picker" open={!project}>
        <summary>1 · Teknologi proyek{project ? ` — ${kind === "sun" ? "PLTS" : "PLTB"}` : ""}</summary>
        <div className="planning-technologies">{KINDS.map(item => <button type="button" key={item.key} aria-pressed={kind === item.key} onClick={() => setKind(item.key)}>
          {item.key === "sun" ? <Sun aria-hidden /> : <Wind aria-hidden />}
          <strong>{item.key === "sun" ? "PLTS" : "PLTB"}</strong><small>{item.key === "sun" ? "Panel surya skala lahan" : "Turbin angin"}</small>
        </button>)}</div>
      </details>

      {failed ? (
        <div className="scenario__failure" role="alert">
          <p>{failed}</p>
          <Button size="sm" onPress={load}>
            Coba lagi
          </Button>
        </div>
      ) : !cells || !a ? (
        <div className="scenario__loading" aria-busy>
          <Skeleton className="scenario__skeleton scenario__skeleton--big" />
          <Skeleton className="scenario__skeleton" />
        </div>
      ) : (
        <>
          <details className="planning-discovery" open={!picked}>
            <summary>{picked ? "Bandingkan dengan lokasi lain" : "2 · Pilih rekomendasi atau klik peta"}</summary>
          <div className="potential__legend">
            <div className="potential__ramp" style={{ background: `linear-gradient(to right, ${ramp.join(", ")})` }} aria-hidden />
            <div className="potential__ticks num">
              <span>{fmtNumber(range.lo, kind === "sun" ? 2 : 0)}</span>
              <span>{fmtNumber(range.hi, kind === "sun" ? 2 : 0)}</span>
            </div>
            <p className="potential__unit">
              {kind === "sun" ? "kWh/m² per hari (sama dengan jam puncak matahari)" : `m/s di ketinggian ${a.wind.hubHeightM} m; ujung kanan = batas layak ${a.wind.viableMeanMs} m/s`}
            </p>
          </div>

          <p className="potential__verdict">
            {kind === "sun"
              ? `Matahari Kaltim merata: ${fmtNumber(range.lo, 2)} sampai ${fmtNumber(range.hi, 2)} kWh/m² per hari, cukup untuk PLTS di mana saja. Lokasi terbaik ditentukan lahan dan jaringan, bukan cuaca.`
              : `Angin Kaltim lemah. Sel terbaik hanya sekitar ${fmtNumber(bestWind?.hubMs ?? 0, 1)} m/s di ${a.wind.hubHeightM} m (faktor kapasitas sekitar ${fmtNumber((bestWind?.windCf ?? 0) * 100)}%), di bawah ${a.wind.viableMeanMs} m/s yang umumnya dibutuhkan PLTB skala besar. Untuk Kaltim, PLTS lebih masuk akal.`}
          </p>

          <div className="ranking potential__ranking">
            <p className="ranking__head">
              <span>{kind === "sun" ? "Terbaik untuk PLTS: cerah dan landai" : "Sel paling berangin"}</span>
              <span>{kind === "sun" ? "kWh/m²/hari" : "m/s"}</span>
            </p>
            <ol className="ranking__list">
              {ranked.map((p, i) => (
                <li key={p.id}>
                  <button type="button" className="ranking__row" data-active={p.id === pickedId || undefined} onClick={() => {
                    pick(p.id);
                    useAppStore.getState().map?.flyTo({ center: p.at, zoom: 9.3, pitch: 45, duration: 1000 });
                  }}>
                    <span className="ranking__rank num" aria-hidden>
                      {i + 1}
                    </span>
                    <span className="ranking__name">
                      {p.regionName}{" "}
                      <span className="potential__where">
                        {where(p)}
                        {kind === "sun" && p.terrain ? `, landai ${fmtNumber(p.terrain.flat5Pct)}%` : ""}
                      </span>
                    </span>
                    <span className="ranking__value num">{fmtNumber(value(p), kind === "sun" ? 2 : 1)}</span>
                    <span className="ranking__track" aria-hidden>
                      <span className="ranking__bar" style={{ backgroundColor: mixRamp(ramp, t(p)), transform: `scaleX(${Math.max(t(p), 0.04)})` }} />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
          </details>

          {picked ? (
            <>
              <div className="planning-location"><span className="group-label">Lokasi terpilih</span><strong>{picked.regionName}</strong><span>{where({ lng: (project?.at ?? clickedAt ?? picked.at)[0], lat: (project?.at ?? clickedAt ?? picked.at)[1] }, 4)}</span></div>
              <BuildControls key={`${picked.id}-${kind}`} cell={picked} kind={kind} cells={cells} />
              <details className="planning-discovery"><summary>Data potensi dan kondisi lokasi</summary><CellDetail cell={picked} p={potential.get(picked.id)!} kind={kind} a={a} /></details>
            </>
          ) : (
            <p className="sheet__note potential__hint">Klik sel di peta atau di daftar untuk melihat perkiraan produksinya.</p>
          )}

          <details className="planning-discovery"><summary>Sumber data dan batasan</summary><footer className="sheet__foot">
            <p className="sheet__note">
              Kemiringan, permukiman, perairan, taman nasional dan lahan basah sudah dicek (peta Mapbox bisa belum lengkap di pedalaman); status kawasan hutan, gambut resmi KLHK, dan jarak ke jaringan transmisi belum. Ini indikasi awal, bukan studi kelayakan.
            </p>
            <p className="sheet__source">
              NASA POWER (ALLSKY_SFC_SW_DWN grid 1°, WS50M MERRA-2 0,5° × 0,625°), diakses 22 Oktober 2026. Data BMKG yang terbuka hanya prakiraan 3 hari, jadi tidak dipakai untuk potensi jangka panjang. Kemiringan: Terrain Tiles (Mapzen) di AWS Open Data, diakses 22 Oktober 2026; SRTM data courtesy of the U.S. Geological Survey. Model 3D panel dan turbin dibuat sendiri. Asumsi PLTS dan turbin: docs/research/renewable-potential.md.
            </p>
          </footer></details>
        </>
      )}
    </div>
  );
}

function CellDetail({
  cell,
  p,
  kind,
  a,
}: {
  cell: PotentialProperties;
  p: CellPotential;
  kind: PotentialKind;
  a: NonNullable<ReturnType<typeof useAppStore.getState>["potentialCells"]>["assumptions"];
}) {
  return (
    <div className="potential__cell">
      <p className="potential__cell-title">
        {cell.regionName} <span className="potential__where">{where(cell)}</span>
      </p>
      <dl className="facts">
        {kind === "sun" ? (
          <>
            <Fact label="Radiasi matahari" value={fmtNumber(cell.ghi, 2)} unit="kWh/m² per hari" />
            <Fact label="Produksi PLTS 1 MWp" value={fmtNumber(p.pvMwhPerMwp)} unit="MWh per tahun" estimate />
            {cell.terrain && (
              <>
                <Fact label="Lahan landai (≤ 5°)" value={`${fmtNumber(cell.terrain.flat5Pct)}%`} unit={`dari daratan sel, ≤ 10°: ${fmtNumber(cell.terrain.flat10Pct)}%`} />
                <Fact
                  label="Kemiringan rata-rata"
                  value={`${fmtNumber(cell.terrain.slopeMean, 1)}°`}
                  unit={`elevasi rata-rata ${fmtNumber(cell.terrain.elevMean)} m`}
                />
              </>
            )}
            <Fact label="Lahan" value={fmtNumber(a.pv.haPerMwp, 2)} unit="ha per MWp" estimate />
            <Fact label="Biaya" value={`Rp ${fmtNumber(a.pv.costRpPerMwp / 1e9)} miliar`} unit="per MWp" estimate />
          </>
        ) : (
          <>
            <Fact label="Angin di 50 m" value={fmtNumber(cell.ws50, 1)} unit="m/s, rata-rata" />
            <Fact label={`Angin di ${a.wind.hubHeightM} m`} value={fmtNumber(p.hubMs, 1)} unit="m/s" estimate />
            <Fact label="Faktor kapasitas" value={`${fmtNumber(p.windCf * 100, 1)}%`} unit={`turbin ${fmtNumber(a.wind.ratedMw, 1)} MW`} estimate />
            <Fact label="Produksi satu turbin" value={fmtNumber(p.windMwhPerTurbine)} unit="MWh per tahun" estimate />
          </>
        )}
      </dl>
      <p className="potential__plant">
        {cell.plantName && cell.plantKm !== null
          ? `Pembangkit terdekat: ${cell.plantName}, sekitar ${fmtNumber(cell.plantKm)} km.`
          : "Belum ada data pembangkit di dekatnya."}
        {kind === "wind" && !p.windViable ? " Di bawah batas layak PLTB." : ""}
      </p>
    </div>
  );
}

/**
 * "Bangun di sini": a PLTS of chosen MWp or a few turbines at the spot clicked in this cell (its land point
 * when picked from the list). The farm stands on the map in 3D and the camera goes down to it.
 */
function BuildControls({ cell, kind, cells }: { cell: PotentialProperties; kind: PotentialKind; cells: PotentialCollection }) {
  const site = useAppStore((s) => s.buildSite);
  const clickAt = useAppStore((s) => s.potentialClickAt);
  const setSite = useAppStore((s) => s.setBuildSite);
  const here = site && site.cellId === cell.id && site.kind === kind ? site : null;
  const sun = kind === "sun";
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [windProblem, setWindProblem] = useState<string | null>(null);
  const [windLoading, setWindLoading] = useState(false);
  useEffect(() => {
    if (!here || sun) return;
    let live = true;
    const [lng, lat] = here.at;
    const loadWind = async () => {
      setWindLoading(true); setWindProblem(null);
      try {
        const weather = await api.wind(lat, lng);
        if (!live) return;
        const current = useAppStore.getState().buildSite;
        if (!current || current.kind !== "wind" || current.at[0] !== lng || current.at[1] !== lat) return;
        if (!weather.current.wind) { setSite({ ...current, wind: undefined }); setWindProblem("Arah angin belum tersedia. Rotor diam sampai prakiraan lokasi tersedia."); return; }
        setSite({ ...current, wind: { ...weather.current.wind, stale: weather.stale } });
      } catch {
        if (live) {
          const current = useAppStore.getState().buildSite;
          if (current?.kind === "wind" && current.at[0] === lng && current.at[1] === lat && current.wind) setSite({ ...current, wind: { ...current.wind, stale: true } });
          setWindProblem("Prakiraan angin gagal dimuat. Coba pilih ulang lokasi; rotor tetap diam jika belum ada data.");
        }
      }
      finally { if (live) setWindLoading(false); }
    };
    void loadWind();
    const refresh = () => { if (document.visibilityState === "visible") void loadWind(); };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [here?.at[0], here?.at[1], here?.cellId, sun, setSite]);

  // The site check keeps the largest farm the slider allows clear, so resizing never needs a new check.
  const build = async () => {
    const asked = clickAt ?? cell.at;
    setSearching(true);
    setProblem(null);
    try {
      const found = await api.site(asked, farmRadiusM(kind, sun ? MAX_SOLAR_MWP : MAX_TURBINES, cells.assumptions));
      if (!found.clear) {
        setProblem("Tidak ada lahan kosong dalam 25 km dari titik ini: semuanya permukiman, bangunan, perairan atau kawasan lindung. Coba klik titik lain di sel ini.");
        return;
      }
      setSite({ kind, at: found.at, cellId: cell.id, size: sun ? 10 : 1, movedKm: found.movedKm });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Pengecekan lokasi gagal.");
    } finally {
      setSearching(false);
    }
  };

  if (!here) {
    return (
      <div className="potential__build">
        <Button variant="primary" size="sm" isPending={searching} onPress={build}>
          <Hammer aria-hidden />
          {searching ? "Memeriksa lahan…" : "Periksa lahan & mulai simulasi"}
        </Button>
        {problem ? (
          <p className="potential__warn" role="alert">
            {problem}
          </p>
        ) : (
          <p className="potential__hint">
            {clickAt ? "Dekat titik yang Anda klik." : "Dekat titik daratan sel ini; klik peta untuk memilih titik lain."} Lokasi dicek dulu agar tidak
            di permukiman, bangunan, perairan, taman nasional atau lahan basah.
          </p>
        )}
      </div>
    );
  }

  const a = cells.assumptions;
  const solar = sun ? solarFarm(here.at, here.size, cell.ghi, a, cells.avoidedKgPerKwh) : null;
  const wind = sun ? null : windFarm(here.at, here.size, cell.ws50, a, cells.avoidedKgPerKwh);
  const steep = sun && cell.terrain !== null && cell.terrain.flat5Pct < 50;
  return (
    <I18nProvider locale="id-ID">
      <div className="potential__build">
        {!sun && <div className="planning-wind" role="status">
          <span className="planning-wind__arrow" aria-hidden style={{ transform: `rotate(${(here.wind?.fromDeg ?? 0) + 180}deg)` }}><ArrowUp /></span>
          <div><strong>{here.wind ? `${fmtNumber(here.wind.speedMs, 1)} m/s · dari ${compassName(here.wind.fromDeg)}` : windLoading ? "Memuat arah angin…" : "Prakiraan angin lokasi"}</strong>
            <p>{here.wind ? `Ke ${compassName(here.wind.fromDeg + 180)} · model cuaca 10 m, ${here.wind.time.replace("T", " ")} WITA${here.wind.stale ? " · data tersimpan, rotor diam" : " · cek setiap 60 detik"}` : windProblem ?? "Arah dan orientasi turbin mengikuti model cuaca Open-Meteo."}</p>
          </div>
        </div>}
        <Slider
          className="scenario__slider"
          value={here.size}
          minValue={1}
          maxValue={sun ? MAX_SOLAR_MWP : MAX_TURBINES}
          step={1}
          onChange={(v) => setSite({ ...here, size: Array.isArray(v) ? (v[0] ?? 1) : v })}
        >
          <Label>{sun ? "Kapasitas PLTS" : "Jumlah turbin"}</Label>
          <Slider.Output>{sun ? `${here.size} MWp` : `${here.size} turbin, ${fmtNumber(here.size * a.wind.ratedMw, 1)} MW`}</Slider.Output>
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
        <p className="group-label">Hasil simulasi proyek</p>
        <dl className="facts planning-results">
          {solar && (
            <>
              <Fact label="Luas lahan" value={fmtNumber(solar.areaHa, 1)} unit={`ha, ${fmtNumber(solar.tables.length)} meja panel`} estimate />
              <Fact label="Produksi" value={fmtNumber(solar.mwhYear)} unit="MWh per tahun" estimate />
              <Fact label="CO₂ dihindari" value={fmtNumber(solar.co2AvoidedTonYear)} unit="ton per tahun" estimate />
              <Fact label="Biaya pasang" value={`Rp ${fmtNumber(solar.costRp / 1e9)} miliar`} unit="sekali bayar" estimate />
            </>
          )}
          {wind && (
            <>
              <Fact label="Faktor kapasitas" value={`${fmtNumber(wind.capacityFactor * 100, 1)}%`} unit={`angin ${fmtNumber(wind.hubMs, 1)} m/s di ${a.wind.hubHeightM} m`} estimate />
              <Fact label="Produksi" value={fmtNumber(wind.mwhYear)} unit="MWh per tahun" estimate />
              <Fact label="CO₂ dihindari" value={fmtNumber(wind.co2AvoidedTonYear)} unit="ton per tahun" estimate />
              <Fact label="Setara PLTS" value={fmtNumber(wind.mwhYear / pvYieldMwhPerMwp(cell.ghi, a.pv.performanceRatio), 1)} unit="MWp untuk listrik yang sama" estimate />
            </>
          )}
        </dl>
        <p className="potential__hint">
          {here.movedKm > 0
            ? `Digeser ${fmtNumber(here.movedKm, 1)} km dari titik pilihan ke lahan tanpa bangunan, permukiman, perairan, taman nasional atau lahan basah menurut peta Mapbox.`
            : "Tidak ada bangunan, permukiman, perairan, taman nasional atau lahan basah di lahan ini menurut peta Mapbox."}
        </p>
        {steep && <p className="potential__warn">Separuh lebih daratan sel ini lebih curam dari 5°: pilih titik di lembah atau dataran.</p>}
        {wind && !wind.viable && (
          <p className="potential__warn">Rata-rata angin jangka panjang di bawah batas kelayakan PLTB. Gerak rotor mengikuti prakiraan sesaat dan bukan ukuran kelayakan proyek.</p>
        )}
        <Button variant="ghost" size="sm" onPress={() => setSite(null)}>
          Hapus dari peta
        </Button>
      </div>
    </I18nProvider>
  );
}

function Fact({ label, value, unit, estimate }: { label: string; value: string; unit: string; estimate?: boolean }) {
  return (
    <div className="fact">
      <dt className="fact__label">{label}</dt>
      <dd className="fact__value">
        <span className="fact__number num">{value}</span>
        <span className="fact__unit">
          {unit}
          {estimate && (
            <>
              , <Estimate />
            </>
          )}
        </span>
      </dd>
    </div>
  );
}
