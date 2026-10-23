import { useEffect, useRef, useState } from "react";
import type { TargetFeature } from "mapbox-gl";
import type { Home } from "../../shared/auth.ts";
import { fmtNumber, fmtRupiah } from "../../shared/format.ts";
import { api, type SolarSimulation } from "../api.ts";
import { useAppStore } from "../store.ts";
import { buildingAt, footprintContains } from "../map/buildings.ts";
import { installationSlots, renderInstallation, clearInstallation } from "../map/installationPreview.ts";
import { VisualGuide } from "../components/VisualGuide.tsx";
import { PanelsTopLeft, Play, Plus, Minus, Wallet, Sun, ShieldCheck, Xmark, ArrowRight } from "../icons.ts";
import { EnergyLab } from "./EnergyLab.tsx";
export function InstallationSimulator({home,initialPanels,onClose}:{home:Home;initialPanels:number;onClose:()=>void}) {
 const map=useAppStore(s=>s.map);
 const [feature,setFeature]=useState<TargetFeature|null>(null),[checked,setChecked]=useState(false);
 const [count,setCount]=useState(Math.max(1,initialPanels)),[after,setAfter]=useState(true),[replay,setReplay]=useState(0);
 const [result,setResult]=useState<SolarSimulation|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 const section=useRef<HTMLElement>(null);
 const slots=feature?installationSlots(feature.geometry):[];
 const max=Math.min(20000,Math.floor(home.roofAreaM2*0.6/5.5/0.55),slots.length);
 useEffect(()=>{section.current?.scrollIntoView({block:"start"});},[]);
 useEffect(()=>{
  if(!map)return; let live=true;
  const find=()=>{if(!live)return;const f=buildingAt(map,home.lng,home.lat,100);if(f&&footprintContains(f.geometry,[home.lng,home.lat])){setFeature(current=>current?.id===f.id?current:f);setChecked(true);}else if(map.isSourceLoaded("city-architecture"))setChecked(true);};
  find();map.on("idle",find);return()=>{live=false;map.off("idle",find);};
 },[map,home.featureId,home.lng,home.lat]);
 useEffect(()=>{if(max>0)setCount(n=>Math.min(n,max));},[max]);
 useEffect(()=>{
  if(!feature||max<=0)return;let live=true;setResult(null);setError(false);
  const timer=setTimeout(()=>void api.simulateSolar({lat:home.lat,lng:home.lng,roofAreaM2:home.roofAreaM2,kwhYear:home.kwhYear,backupHours:0,buildingType:home.buildingType,panelCount:Math.min(count,max)}).then(r=>{if(live)setResult(r);},()=>{if(live)setError(true);}),180);
  return()=>{live=false;clearTimeout(timer);};
 },[count,max,feature,home, retry]);
 useEffect(()=>{
  if(!map||!feature||max<=0)return;
  if(!after){clearInstallation(map);return;}
  let frame=0;const start=performance.now(),reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animate=()=>{const progress=reduced?1:Math.min(1,(performance.now()-start)/1000);renderInstallation(map,feature,Math.min(count,max),progress);if(progress<1)frame=requestAnimationFrame(animate);};
  animate();return()=>{cancelAnimationFrame(frame);clearInstallation(map);};
 },[map,feature,count,max,after,replay]);
 return <section ref={section} className="installation-simulator" aria-label="Simulasi pemasangan panel surya"><header className="installation-heading"><span><PanelsTopLeft aria-hidden />Pratinjau pemasangan</span><button type="button" aria-label="Tutup simulasi pemasangan" onClick={onClose}><Xmark aria-hidden /></button></header>
 <VisualGuide role="teknisi" title="Coba pasang panel di atapmu">Atur jumlah panel. Lihat perubahan di rumah 3D dan perkiraan manfaatnya.</VisualGuide>
 <p className="installation-badge"><ShieldCheck aria-hidden />Pratinjau saja · bukan pemasangan nyata</p>
 {!feature||max<=0?<p role="status">{!checked?"Memuat bentuk atap rumah…":"Atap belum cukup jelas untuk menempatkan panel dengan aman. Tidak ada panel yang diletakkan di luar bangunan."}</p>:<>
 <div className="installation-count"><button type="button" aria-label="Kurangi panel" disabled={count<=1} onClick={()=>setCount(n=>n-1)}><Minus aria-hidden /></button><div><strong>{count}</strong><span>panel × 550 Wp</span></div><button type="button" aria-label="Tambah panel" disabled={count>=max} onClick={()=>setCount(n=>n+1)}><Plus aria-hidden /></button></div>
 <input aria-label="Jumlah panel pratinjau" type="range" min="1" max={max} value={count} onChange={e=>setCount(Number(e.target.value))}/>
 <p className="journey-copy">Maksimal {max} panel pada area aman pratinjau. Susunan dan atap datar di peta bersifat ilustratif; perlu survei atap.</p>
 <div className="installation-toggle" role="group" aria-label="Perbandingan pemasangan"><button type="button" aria-pressed={!after} onClick={()=>setAfter(false)}>Sebelum</button><ArrowRight aria-hidden /><button type="button" aria-pressed={after} onClick={()=>setAfter(true)}>Sesudah</button></div>
 <button className="installation-replay" type="button" onClick={()=>{setAfter(true);setReplay(n=>n+1);}}><Play aria-hidden />Putar pemasangan</button>
 <p className="journey-copy">Perkiraan setelah pemasangan {count} panel:</p>
 {error?<div role="alert">Perhitungan belum tersedia. <button type="button" onClick={()=>setRetry(n=>n+1)}>Hitung ulang</button></div>:!result?<p role="status">Menghitung manfaat {count} panel…</p>:<dl className="visual-benefits"><div><Sun aria-hidden /><dt>Produksi rata-rata</dt><dd>{fmtNumber(result.kwhYear/365,1)} kWh/hari</dd></div><div><Wallet aria-hidden /><dt>Hemat perkiraan</dt><dd>{fmtRupiah(result.savingRpYear/12)}/bln</dd></div><div><PanelsTopLeft aria-hidden /><dt>Biaya awal model</dt><dd>{fmtRupiah(result.costRp)}</dd></div></dl>}
 <p className="journey-copy">Perhitungan tahunan dibagi rata, bukan produksi hari ini. Ekspor tidak diberi kredit penghematan. Harga model, bukan penawaran.</p>
 {result&&<details className="journey-details"><summary>Lanjut uji hujan dan baterai</summary><EnergyLab key={result.kWp} solarOnly initialKwp={result.kWp} initialLoad={home.kwhYear/8760}/></details>}
 </>}
 </section>;
}
