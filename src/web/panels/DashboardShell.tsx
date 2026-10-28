import { BookOpen, ChartColumn, Clock, House, MapPin, Sun, ClipboardList } from "../icons.ts";
import { Button } from "@heroui/react";
import { useEffect } from "react";
import { AccountControl } from "./AccountControl.tsx";
import { useAppStore } from "../store.ts";
import { AddressSearch } from "../components/AddressSearch.tsx";
import { goToPlace } from "../map/goToPlace.ts";
import { buildingViewPadding, footprintContains } from "../map/buildings.ts";
import { KALTIM_VIEW, stopIdleOrbit } from "../map/camera.ts";
import type { RegionSummary } from "../../shared/types.ts";
import { LiveOverview } from "./LiveOverview.tsx";
import { Character } from "../components/Character.tsx";

type View = "overview" | "home" | "homes" | "potential" | "scenario" | "twin" | "solar" | "reports";
type Item = { key: View; label: string; detail: string; Icon: typeof House };
const overview: Item = { key: "overview", label: "Peta energi", detail: "Emisi, listrik, dan wilayah", Icon: ChartColumn };
const home: Item = { key: "home", label: "Rumah saya", detail: "Sensor simulasi dan PLTS", Icon: House };
const solar: Item = { key: "solar", label: "Manfaat panel surya", detail: "Perkiraan hemat untuk rumahmu", Icon: Sun };
const homes: Item = { key: "homes", label: "Prioritas transisi", detail: "Bandingkan wilayah dan adopsi", Icon: House };
const reports: Item = {key:"reports",label:"Laporan PLTS",detail:"Pemeriksaan pemasangan warga",Icon:ClipboardList};
const potential: Item = { key: "potential", label: "Rencana pembangkit", detail: "Lokasi PLTS dan PLTB", Icon: MapPin };
const scenario: Item = { key: "scenario", label: "Skenario wilayah", detail: "Dampak perluasan PLTS atap", Icon: Sun };
const twin: Item = { key: "twin", label: "Digital twin", detail: "Simulasi energi 24 jam", Icon: Clock };

export function DashboardShell({ regions }: { regions: RegionSummary[] }) {
  const s = useAppStore();
  const warga = s.user?.role === "warga";
  const items = warga ? [home, solar] : s.user?.role === "pemda" ? [homes, reports, potential, overview, scenario, twin] : [solar, overview, potential, scenario, twin];
  const selected = s.buildingStatus !== "idle";
  const citizenBenefit = (warga || !s.user) && s.homeOpen && !selected && (s.homeGoal ?? (s.home?.installedPv ? "monitor" : "benefit")) === "benefit";
  const active: View = selected && warga && s.panelTab === "surya" ? "solar" : s.potentialOpen ? "potential" : s.pemdaOpen ? s.pemdaGoal === "reports" ? "reports" : "homes" : s.homeOpen ? !s.user || s.homeGoal === "benefit" ? "solar" : "home" : s.scenarioOpen ? "scenario" : s.twinOpen ? "twin" : "overview";
  useEffect(() => {
    const map = s.map;
    if (!map || selected) return;
    const resize = () => map.easeTo({ padding: buildingViewPadding(), duration: 0 });
    const adjust = () => {
      if (active === "home" && s.home) map.flyTo({ center: [s.home.lng, s.home.lat], zoom: 17.8, pitch: 55, padding: buildingViewPadding(), duration: 1000 });
      else if (active === "twin" || active === "scenario") {
        stopIdleOrbit();
        map.flyTo({ ...KALTIM_VIEW, zoom: window.innerWidth <= 760 ? 5 : 6.3, padding: buildingViewPadding(), duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1400 });
      } else resize();
    };
    const frame = requestAnimationFrame(() => { if (map.isMoving()) map.once("moveend", adjust); else adjust(); });
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(frame); map.off("moveend", adjust); window.removeEventListener("resize", resize); };
  }, [s.map, active, selected, s.home?.featureId]);
  const title = selected ? "Analisis bangunan" : items.find(i => i.key === active)?.label ?? "Peta energi";
  const navigate = (key: View) => {
    const state = useAppStore.getState();
    state.closeBuilding(); state.setChatOpen(false); state.setStory(null);
    state.setPemdaOpen(false); state.setHomeOpen(false); state.setScenarioOpen(false); state.setTwinOpen(false); state.setPotentialOpen(false);
    if (state.selectedRegionId) state.selectRegion(null);
    if (key === "home" || key === "solar") {
      state.setHomeGoal(key === "solar" ? "benefit" : null);
      state.setHomeOpen(true);
    } else if (key === "homes" || key === "reports") { state.setPemdaGoal(key === "reports" ? "reports" : "priority"); state.setPemdaOpen(true); }
    else if (key === "potential") state.setPotentialOpen(true);
    else if (key === "scenario") state.setScenarioOpen(true);
    else if (key === "twin") state.setTwinOpen(true);
  };
  return <>
    <header className="dashboard-header">
      <a className="dashboard-brand" href="#" onClick={e => { e.preventDefault(); navigate("overview"); }}>
        <span className="dashboard-brand__mark" aria-hidden><Sun /></span>
        <span><strong>Malas Ngoding</strong><small>Atlas energi Kalimantan Timur</small></span>
      </a>
      <div className="dashboard-search">
        <AddressSearch compact label="Cari lokasi di Kalimantan Timur" onPick={place => {
          const state = useAppStore.getState();
          if (!state.potentialOpen) { void goToPlace(place); return; }
          const cell = state.potentialCells?.features.find(f => footprintContains(f.geometry, place.at));
          if (cell) state.pickPotentialAt(cell.properties.id, place.at);
          stopIdleOrbit(); state.map?.flyTo({ center: place.at, zoom: 10, pitch: 40, duration: 1000 });
        }} />
      </div>
      <div className="dashboard-account"><span className="dashboard-role">{warga ? "Warga" : s.user ? "Pemerintah daerah" : "Akses publik"}</span><AccountControl /></div>
    </header>
    <nav className="dashboard-nav" aria-label={warga ? "Navigasi warga" : s.user ? "Navigasi pemda" : "Navigasi peta"}>
      <p className="dashboard-nav__eyebrow">{warga ? "Energi rumah" : "Ruang kerja energi"}</p>
      <div className="dashboard-nav__items">{items.map(({ key, label, detail, Icon }) => <button key={key} type="button" className="dashboard-nav__item"
        aria-current={key === active ? "page" : undefined} onClick={() => navigate(key)}>
        <Icon aria-hidden /><span><strong>{label}</strong><small>{detail}</small></span>
      </button>)}</div>
      <div className="dashboard-nav__foot"><div className="dashboard-character-guide"><Character role={warga ? "warga" : s.user ? "pemda" : "teknisi"} variant="guide" /><span>{warga ? "Kenali energi rumahmu" : s.user ? "Rencanakan energi daerah" : "Jelajahi energi bersama"}</span></div>
        <Button size="sm" variant="outline" onPress={() => s.setStory({ track: s.user?.role ?? null, step: 0 })}><BookOpen aria-hidden />Panduan penggunaan</Button>
        <span>Data 2019–2026 · angka model ditandai perkiraan</span>
      </div>
    </nav>
    <div className="dashboard-context">
      <div><p className="dashboard-context__breadcrumb">{warga ? "Dashboard warga" : s.user ? "Dashboard pemerintah daerah" : "Eksplorasi energi"}<span>/</span>{title}</p>
        <h1>{title}</h1><p>{selected ? "Periksa jenis bangunan, kebutuhan listrik, dan potensi atapnya." : active === "twin" ? "Putar simulasi energi 24 jam dan lihat dampaknya pada peta wilayah." : active === "potential" ? "Tentukan lokasi dan kapasitas proyek. Hasilnya langsung terlihat pada peta." : warga ? "Pantau rumahmu dan rencanakan penggunaan energi yang lebih baik." : "Jelajahi wilayah dan susun rencana energi dari satu ruang kerja."}</p>
      </div>{citizenBenefit ? <ol className="citizen-steps" aria-label="Langkah energi rumah"><li data-active={!s.home}>Temukan rumah</li><li data-active={!!s.home}>Lihat manfaat</li><li>Pantau panel</li></ol> : s.user?.role === "pemda" && s.pemdaOpen && s.pemdaGoal !== "reports" && !selected ? <ol className="citizen-steps" aria-label="Langkah transisi daerah"><li data-active>Bandingkan</li><li>Verifikasi</li><li>Pilot</li></ol> : <LiveOverview regions={regions} />}
    </div>
    {s.potentialOpen && <div className="planning-map-hint" role="status"><MapPin aria-hidden /><div><strong>{s.buildSite ? "Pratinjau proyek di lokasi terpilih" : s.potentialCellId != null ? "Lokasi dipilih. Periksa lahan di panel kanan." : "Pilih lokasi pada peta"}</strong><p>{s.buildSite ? "Ubah kapasitas di panel kanan untuk memperbarui simulasi." : "Klik area berwarna, cari alamat, atau pilih rekomendasi lokasi."}</p></div>
      {s.potentialCellId != null && <Button size="sm" variant="outline" onPress={() => { s.setBuildSite(null); s.setPotentialCell(null); }}>Pilih ulang</Button>}
    </div>}
  </>;
}
