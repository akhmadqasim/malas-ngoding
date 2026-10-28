import { ChevronLeft } from "../icons.ts";
import { Button, Skeleton } from "@heroui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PemdaHomes, PemdaSummary } from "../../shared/auth.ts";
import { fmtCompact, fmtNumber } from "../../shared/format.ts";
import { api } from "../api.ts";
import { Estimate } from "../components/Estimate.tsx";
import { LayerSwitch } from "../components/LayerSwitch.tsx";
import { useAppStore } from "../store.ts";
import { stopIdleOrbit } from "../map/camera.ts";
import type { RegionSummary } from "../../shared/types.ts";
import { ApplicationsPanel } from "./ApplicationsPanel.tsx";
import { TransitionPriorities } from "./TransitionPriorities.tsx";

/**
 * The local government's dashboard in the left sheet: homes residents registered, per region, how many want
 * rooftop solar and the PV their roofs could hold, with the consenting homes as anonymous points on the
 * map. Every province view stays open to this account too (the menu top right).
 */
export function PemdaView({ regions: regionData }: { regions: RegionSummary[] }) {
  const view = useAppStore(s => s.pemdaGoal);
  const setView = useAppStore(s => s.setPemdaGoal);
  const user = useAppStore((s) => s.user);
  const setOpen = useAppStore((s) => s.setPemdaOpen);
  const setPoints = useAppStore((s) => s.setPemdaHomes);
  const [summary, setSummary] = useState<PemdaSummary | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [allPoints, setAllPoints] = useState<PemdaHomes | null>(null);
  const [pointProblem, setPointProblem] = useState<string | null>(null);
  const [filter, setFilter] = useState<"installed" | "interested" | "all">("installed");
  const [showPoints, setShowPoints] = useState(true);
  const visiblePoints = useMemo(() => allPoints && ({ ...allPoints, features: allPoints.features.filter(f =>
    filter === "all" || (filter === "installed" ? f.properties.installed : f.properties.interested && !f.properties.installed)) }), [allPoints, filter]);

  const load = useCallback(() => {
    setProblem(null);
    api.pemdaSummary().then(setSummary, (err: unknown) => setProblem(err instanceof Error ? err.message : "Ringkasan gagal dimuat."));
  }, []);
  useEffect(load, [load]);
  // The points are shown from the start; the switch hides them.
  useEffect(() => {
    let live = true;
    api.pemdaHomes().then(data => { if (live) setAllPoints(data); }, () => { if (live) setPointProblem("Titik rumah gagal dimuat. Muat ulang dasbor untuk mencoba lagi."); });
    return () => { live = false; };
  }, []);
  useEffect(() => { setPoints(view === "adoption" && showPoints ? visiblePoints : null); }, [view, showPoints, visiblePoints, setPoints]);

  const frameHomes = () => {
    const map = useAppStore.getState().map;
    if (!map || !visiblePoints?.features.length) return;
    const coords = visiblePoints.features.map(f => f.geometry.coordinates);
    stopIdleOrbit();
    map.fitBounds([[Math.min(...coords.map(p => p[0])), Math.min(...coords.map(p => p[1]))],
      [Math.max(...coords.map(p => p[0])), Math.max(...coords.map(p => p[1]))]],
      { padding: { top: 100, bottom: 150, left: Math.min(380, window.innerWidth * 0.25), right: 70 }, maxZoom: 17, duration: 1200 });
  };

  const regions = summary ? [...summary.regions].sort((a, b) => b.homes - a.homes || b.potentialKwp - a.potentialKwp) : [];
  const t = summary?.totals;

  return (
    <div className="sheet__body pemda" role="region" aria-label="Dasbor pemerintah daerah">
      <Button variant="ghost" size="sm" className="back" onPress={() => setOpen(false)}>
        <ChevronLeft aria-hidden />
        Semua wilayah
      </Button>
      <h2 className="place">{view === "reports" ? "Laporan pemasangan PLTS" : "Mulai transisi daerah"}</h2>
      <p className="place__meta">{user?.name ?? "Pemerintah daerah"}</p>
      <div className="journey-tabs" role="group" aria-label="Fokus pemerintah daerah"><Button size="sm" variant={view === "priority" ? "primary" : "ghost"} onPress={() => setView("priority")}>Prioritas awal</Button><Button size="sm" variant={view === "adoption" ? "primary" : "ghost"} onPress={() => setView("adoption")}>Adopsi PLTS warga</Button><Button size="sm" variant={view === "reports" ? "primary" : "ghost"} onPress={()=>setView("reports")}>Laporan PLTS</Button></div>

      {view === "reports" ? <ApplicationsPanel admin/> : view === "priority" ? <TransitionPriorities regions={regionData} /> : problem ? (
        <div className="scenario__failure" role="alert">
          <p>{problem}</p>
          <Button size="sm" onPress={load}>
            Coba lagi
          </Button>
        </div>
      ) : !summary || !t ? (
        <div className="scenario__loading" aria-busy>
          <Skeleton className="scenario__skeleton scenario__skeleton--big" />
          <Skeleton className="scenario__skeleton" />
        </div>
      ) : (
        <>
          <div className="readout">
            <p className="readout__label">Rumah warga terdaftar</p>
            <p className="readout__figure num">{fmtNumber(t.homes)}</p>
            <p className="readout__unit">
              {fmtNumber(t.interested)} tertarik memasang panel surya
              {summary.demoHomes > 0 ? `, termasuk ${fmtNumber(summary.demoHomes)} rumah data demo` : ""}
            </p>
          </div>
          <div className="dashboard-project-actions"><p className="group-label">Mulai rencana energi wilayah</p><div>
            {(["sun", "wind"] as const).map(kind => <Button key={kind} size="sm" variant="outline" onPress={() => {
              const state = useAppStore.getState(); state.setPemdaOpen(false); state.setPotentialKind(kind); state.setPotentialOpen(true);
            }}>{kind === "sun" ? "Rencanakan PLTS" : "Rencanakan PLTB"}</Button>)}
          </div></div>
          <dl className="facts">
            <div className="fact"><dt className="fact__label">Terverifikasi untuk pendataan</dt><dd className="fact__value"><span className="fact__number num">{fmtNumber(t.verified ?? 0)} rumah</span><span className="fact__unit">{fmtNumber(t.verifiedKwp ?? 0,2)} kWp diperiksa pemda; bukan izin pemasangan</span></dd></div>
            <div className="fact">
              <dt className="fact__label">Sudah memasang PLTS</dt>
              <dd className="fact__value"><span className="fact__number num">{fmtNumber(t.installed)} rumah</span>
                <span className="fact__unit">{fmtNumber(t.installedKwp, 2)} kWp kapasitas laporan pemilik; status verifikasi terpisah</span></dd>
            </div>
            <div className="fact">
              <dt className="fact__label">Potensi PLTS atap</dt>
              <dd className="fact__value">
                <span className="fact__number num">{fmtNumber(t.potentialKwp)} kWp</span>
                <span className="fact__unit">
                  dari atap rumah terdaftar, <Estimate />
                </span>
              </dd>
            </div>
            <div className="fact">
              <dt className="fact__label">Listrik rumah terdaftar</dt>
              <dd className="fact__value">
                <span className="fact__number num">{fmtCompact(t.kwhYear)} kWh</span>
                <span className="fact__unit">
                  per tahun, <Estimate />
                </span>
              </dd>
            </div>
          </dl>

          <div className="ranking pemda__ranking">
            <p className="ranking__head">
              <span>Wilayah</span>
              <span>terpasang / terdaftar</span>
            </p>
            <ol className="ranking__list">
              {regions.map((r) => (
                <li key={r.regionId}>
                  <button type="button" className="ranking__row" onClick={() => useAppStore.getState().selectRegion(r.regionId)}>
                    <span className="ranking__rank num" aria-hidden>
                      {fmtNumber(r.homes)}
                    </span>
                    <span className="ranking__name">{r.regionName}</span>
                    <span className="ranking__value num">
                      {fmtNumber(r.installed)} / {fmtNumber(r.homes)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div className="pemda__points">
            <label className="group-label" htmlFor="pemda-home-filter">Rumah dari database</label>
            <select id="pemda-home-filter" className="pemda__filter" value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
              <option value="installed">Sudah memasang panel surya</option>
              <option value="interested">Berminat, belum terpasang</option>
              <option value="all">Semua rumah terdaftar</option>
            </select>
            <LayerSwitch
              label="Titik rumah di peta"
              on={showPoints}
              onChange={setShowPoints}
            />
            <p className="pemda__legend">
              <i className="pemda__dot pemda__dot--installed" aria-hidden /> sudah terpasang <i className="pemda__dot pemda__dot--interested" aria-hidden /> berminat <i className="pemda__dot" aria-hidden /> belum tercatat terpasang
            </p>
            {pointProblem && <p role="alert" className="account__problem">{pointProblem}</p>}
            {allPoints && <p className="sheet__note">{fmtNumber(visiblePoints?.features.length ?? 0)} rumah berizin tampil sesuai filter. Klik penanda untuk rincian. Panel 3D adalah ilustrasi dan hanya muncul jika tapak gedung tersedia pada peta.</p>}
            {allPoints && !visiblePoints?.features.length && <p className="sheet__note">Belum ada rumah berizin yang cocok dengan filter ini.</p>}
            <Button size="sm" variant="outline" isDisabled={!showPoints || !visiblePoints?.features.length} onPress={frameHomes}>Lihat rumah di peta</Button>
          </div>

          <footer className="sheet__foot">
            <p className="sheet__note">
              Hanya rumah yang pemiliknya mengizinkan yang tampil di peta, sebagai titik tanpa nama dan email. Klik wilayah untuk rekomendasinya, atau buka
              Skenario wilayah, Digital twin, dan Rencana pembangkit melalui navigasi.
            </p>
            {summary.demoHomes > 0 && (
              <p className="sheet__source">
                Rumah data demo berdiri di bangunan nyata dari{" "}
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                  © kontributor OpenStreetMap
                </a>{" "}
                (data di bawah ODbL 1.0). Atribut rumah demo termasuk status dan kapasitas PLTS adalah data sintetis, bukan pemasangan nyata.
              </p>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
