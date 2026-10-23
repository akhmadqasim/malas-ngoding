import { useTelemetrySettings } from "../telemetry.ts";
import { Marker } from "mapbox-gl";
import { useEffect, useState } from "react";
import { useAppStore } from "../store.ts";
import { AccountControl } from "./AccountControl.tsx";
import { InstallationJourney } from "./InstallationJourney.tsx";
import { ApplicationsPanel } from "./ApplicationsPanel.tsx";
import { HomeView } from "./HomeView.tsx";
import { House, MapPin, Sun, ClipboardList } from "../icons.ts";
import { buildingAt, footprintContains, setBuildingTone } from "../map/buildings.ts";
import type { TargetFeature } from "mapbox-gl";
import { presetTone } from "../map/effects.ts";
import { stopIdleOrbit } from "../map/camera.ts";
/** The resident workspace always reads the home attached to the current authenticated account. */
export function CitizenWorkspace() {
  const [reports,setReports] = useState(false);
  const [applying,setApplying] = useState(false);
  const monitoring = useTelemetrySettings(s => s.buildingReading !== null);
  const home = useAppStore(s => s.home);
  const map = useAppStore(s => s.map);
  const lightPreset = useAppStore(s => s.lightPreset);
  const user = useAppStore(s => s.user);
  useEffect(() => { const s = useAppStore.getState(); s.closeBuilding(); s.selectRegion(null); s.setHomeOpen(true); s.setStory(null); }, []);
  useEffect(() => {
    if (!home || !map || monitoring) return;
    const element = document.createElement("div"); element.className = "citizen-home-pin"; element.textContent = "Rumah saya";
    const marker = new Marker({ element, anchor: "bottom", altitude: Math.max(2, home.heightM ?? 4) }).setLngLat([home.lng, home.lat]).addTo(map);
    return () => { marker.remove(); };
  }, [map, home?.featureId, home?.lng, home?.lat, monitoring]);
  useEffect(() => {
    if (!home || !map) return;
    let selected: TargetFeature | null = null;
    const highlight = () => {
      if (selected) return;
      const feature = buildingAt(map, home.lng, home.lat, 100);
      if (!feature || !footprintContains(feature.geometry, [home.lng, home.lat])) return;
      setBuildingTone(map, presetTone(lightPreset), true);
      selected = feature; map.setFeatureState(feature, {select:true});
    };
    map.on("idle", highlight);
    return () => { map.off("idle", highlight); if (selected && map.isStyleLoaded()) map.setFeatureState(selected, {select:false}); };
  }, [map, home?.featureId, home?.lng, home?.lat, lightPreset]);
  useEffect(() => {
    if (!home || !map) return;
    stopIdleOrbit();
    const focus = () => {
      // The atlas terrain must be off at roof scale: native building bases are at zero elevation.
      // BuildingPanel used to own this, but it is intentionally unmounted in the resident workspace.
      if (map.getTerrain()) map.setTerrain(null);
      map.resize();
      const mobile = window.innerWidth <= 900;
      const padding = mobile ? {left:20,right:20,top:30,bottom:20} : {left:64,right:64,top:60,bottom:80};
      // Frame the saved roof at its physical size, instead of an arbitrary neighbourhood zoom.
      const halfSide = Math.max(12, Math.sqrt(home.footprintM2) * 1.2);
      const dy = halfSide / 111320, dx = dy / Math.max(0.1, Math.cos(home.lat * Math.PI / 180));
      const camera = map.cameraForBounds([[home.lng - dx, home.lat - dy], [home.lng + dx, home.lat + dy]], {padding, bearing:-20, maxZoom:21});
      map.jumpTo({...camera, center:[home.lng,home.lat], zoom:Math.max(18.5, Math.min(21, camera?.zoom ?? 20)), pitch:50, bearing:-20, padding});
    };
    focus(); window.addEventListener("resize", focus);
    return () => window.removeEventListener("resize", focus);
  }, [map, home?.featureId, home?.lng, home?.lat]);
  return <section className="citizen-workspace" aria-label="Dashboard rumah pribadi">
    <header className="citizen-header"><div className="citizen-header__brand"><House aria-hidden /><div><strong>Panel surya rumah saya</strong><small>Selamat datang, {user?.name}</small></div></div><AccountControl /></header>
    <div className="citizen-scene-title"><Sun aria-hidden /><span>Panel surya untuk rumah ini</span></div>
    <div className="citizen-content"><nav className="citizen-section-tabs" aria-label="Menu warga"><button type="button" aria-current={!reports&&!applying?"page":undefined} onClick={()=>{setReports(false);setApplying(false);}}><House aria-hidden/>Rumah saya</button><button type="button" aria-current={reports?"page":undefined} onClick={()=>{setReports(true);setApplying(false);}}><ClipboardList aria-hidden/>Laporan panel</button><button type="button" aria-current={applying?"page":undefined} onClick={()=>{setReports(false);setApplying(true);}}><Sun aria-hidden/>Pasang panel</button></nav>{applying?<InstallationJourney onBack={()=>setApplying(false)}/>:reports?<ApplicationsPanel/>:<HomeView onReport={()=>setReports(true)} onApply={()=>setApplying(true)}/>}</div>
    <aside className="citizen-map-caption"><MapPin aria-hidden /><div><strong>Rumah saya · tampilan 3D</strong><p>{home?.regionName ?? "Lokasi rumah tersimpan"} · lokasi tersimpan</p><small>Data energi masih simulasi sensor virtual.</small></div></aside>
  </section>;
}
