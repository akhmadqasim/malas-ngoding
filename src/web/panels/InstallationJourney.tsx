import {useEffect, useState} from "react";
import {ArrowLeft, ArrowRight, Sun, ClipboardCheck, CalendarDays, HardHat, FileCheck, Wrench, CircleCheck, RotateCcw} from "lucide-react";
import {useAppStore} from "../store.ts";
import {VisualGuide} from "../components/VisualGuide.tsx";
import {buildingAt,footprintContains} from "../map/buildings.ts";
import {renderInstallation,clearInstallation} from "../map/installationPreview.ts";
import {TelemetryPanel} from "./TelemetryPanel.tsx";
import {fmtRupiah} from "../../shared/format.ts";

const KEY="solar-installation-prototype-v1";
const steps=[
 {title:"Pengajuan diterima",icon:ClipboardCheck,hint:"Pemda akan memeriksa kesiapan rumah dan mengatur survei."},
 {title:"Survei dijadwalkan",icon:CalendarDays,hint:"Tim teknisi demo akan meninjau atap dan kebutuhan listrik."},
 {title:"Hasil survei siap",icon:FileCheck,hint:"Warga meninjau rancangan panel dan estimasi biaya sebelum melanjutkan."},
 {title:"Rencana disetujui",icon:CircleCheck,hint:"Pemda mengoordinasikan jadwal pemasangan dengan teknisi demo."},
 {title:"Pemasangan dijadwalkan",icon:HardHat,hint:"Teknisi menyiapkan panel, inverter, dan perlengkapan pemasangan."},
 {title:"Sedang dipasang",icon:Wrench,hint:"Panel dan inverter dipasang, lalu diuji oleh teknisi demo."},
 {title:"Pemasangan selesai",icon:Sun,hint:"Rumah siap mencoba pemantauan produksi energi simulasi."},
] as const;
interface Journey {id:string;owner:number;home:string;region:string;panels:number;stage:number;created:string;survey:string;installation:string;history:{stage:number;at:string}[]}
function read():Journey[]{try{const raw=JSON.parse(localStorage.getItem(KEY)??"[]");return Array.isArray(raw)?raw.filter((r:Journey)=>typeof r.id==="string"&&typeof r.owner==="number"&&Number.isInteger(r.stage)&&r.stage>=0&&r.stage<steps.length&&Number.isInteger(r.panels)&&r.panels>0&&Array.isArray(r.history)):[];}catch{return [];}}
const date=(s:string)=>new Date(s).toLocaleString("id-ID",{timeZone:"Asia/Makassar",dateStyle:"medium",timeStyle:"short"});
/** Browser-only demo workflow. It never marks a database home as installed or verified. */
export function InstallationJourney({admin=false,onBack}:{admin?:boolean;onBack:()=>void}){
 const map=useAppStore(s=>s.map);
 const user=useAppStore(s=>s.user),home=useAppStore(s=>s.home);
 const [records,setRecords]=useState<Journey[]>(read),[selected,setSelected]=useState<string|null>(null),[panels,setPanels]=useState(2),[confirmed,setConfirmed]=useState(false),[error,setError]=useState("");
 const [schedule,setSchedule]=useState(""),[editing,setEditing]=useState(false),[watching,setWatching]=useState(false);
 useEffect(()=>{const sync=()=>setRecords(read());window.addEventListener("storage",sync);return()=>window.removeEventListener("storage",sync);},[]);
 const save=(next:Journey[])=>{try{localStorage.setItem(KEY,JSON.stringify(next));setRecords(next);setError("");return true;}catch{setError("Penyimpanan browser tidak tersedia. Izinkan penyimpanan untuk menjalankan demo ini.");return false;}};
 const visible=admin?records:records.filter(r=>r.owner===user?.id&&r.home===home?.featureId);
 const current=admin?visible.find(r=>r.id===selected):visible[0];
 useEffect(()=>{
 if(admin||!map||!home||!current||current.stage<5)return;
 let drawn=false;
 const draw=()=>{if(drawn)return;const f=buildingAt(map,home.lng,home.lat,100);if(f&&footprintContains(f.geometry,[home.lng,home.lat])){drawn=true;renderInstallation(map,f,current.panels,1);}};
 draw();map.on("idle",draw);return()=>{map.off("idle",draw);clearInstallation(map);};
 },[admin,map,home?.featureId,current?.id,current?.stage,current?.panels]);
 const maxPanels=Math.max(0,Math.min(12,Math.floor((home?.potentialKwp??0)/0.55)));
 const count=Math.min(panels,maxPanels),cost=(current?.panels??count)*5500000;
 const advance=(stage:number)=>{if(!current)return;const latest=read();const actual=latest.find(r=>r.id===current.id);if(!actual||actual.stage!==current.stage){setRecords(latest);setError("Tahap demo berubah di tab lain. Periksa kembali sebelum melanjutkan.");return;}
 if(save(latest.map(r=>r.id===current.id?{...r,stage,survey:stage===1?`${schedule}+08:00`:r.survey,installation:stage===4?`${schedule}+08:00`:r.installation,history:[...r.history,{stage,at:new Date().toISOString()}]}:r))){setEditing(false);setSchedule("");}};
 const submit=()=>{if(!user||!home||!confirmed||count<1)return;const latest=read();if(latest.some(r=>r.owner===user.id&&r.home===home.featureId)){setRecords(latest);return;}const now=new Date().toISOString();save([...latest,{id:crypto.randomUUID(),owner:user.id,home:home.featureId,region:home.regionName??"Rumah demo",panels:count,stage:0,created:now,survey:"",installation:"",history:[{stage:0,at:now}]}]);};
 const nextAdmin=current?({0:1,1:2,3:4,4:5,5:6} as Record<number,number>)[current.stage]:undefined;
 const actionLabel=current?({0:"Jadwalkan survei demo",1:"Terbitkan hasil survei demo",3:"Jadwalkan pemasangan demo",4:"Mulai pemasangan demo",5:"Selesaikan dan uji sistem demo"} as Record<number,string>)[current.stage]:undefined;
 return <section className="applications-panel installation-journey" aria-label="Prototipe pengajuan pemasangan">
 <button type="button" className="prototype-back" onClick={onBack}><ArrowLeft aria-hidden/>Kembali</button>
 <p className="prototype-badge"><Sun aria-hidden/>Prototipe · data simulasi</p>
 <h2>{admin?"Koordinasi pemasangan":"Pasang panel di rumah saya"}</h2>
 <p>Demo tersimpan di browser ini. Tidak mengirim pesanan, pembayaran, atau penugasan teknisi sungguhan.</p>
 {error&&<p role="alert">{error}</p>}
 {admin&&!current?<><VisualGuide role="pemda" title="Dampingi warga sampai panel menyala">Pengajuan demo warga dari browser yang sama akan muncul di sini. Gunakan akun warga lebih dulu untuk mencoba alurnya.</VisualGuide><ul className="report-list">{visible.map(r=><li key={r.id}><button onClick={()=>{setSelected(r.id);setEditing(false);}}><strong>PLTS demo · {r.id.slice(0,8)}</strong><span>{r.region} · {r.panels} panel</span><span className="report-status">{steps[r.stage]!.title}</span></button></li>)}</ul></>:!current?<>
 <VisualGuide role="warga" title="Mulai dari survei rumah">Pilih jumlah panel sebagai gambaran awal. Teknisi demo akan memeriksa rancangan sebelum kamu menyetujuinya.</VisualGuide>
 {!home?<p>Simpan rumah melalui Rumah saya terlebih dahulu.</p>:<form className="application-form" onSubmit={e=>{e.preventDefault();submit();}}>
 <div className="prototype-package"><Sun aria-hidden/><div><strong>{count} panel · {(count*0.55).toFixed(2)} kWp</strong><p>{home.regionName} · rumah yang tersimpan di akunmu</p></div></div>
 <label>Jumlah panel awal<select value={count} onChange={e=>setPanels(Number(e.target.value))}>{Array.from({length:maxPanels},(_,i)=><option key={i+1} value={i+1}>{i+1} panel</option>)}</select></label>
 {maxPanels===0&&<p>Potensi atap belum cukup untuk paket contoh. Periksa data rumah terlebih dahulu.</p>}
 <p>Anggaran contoh {fmtRupiah(cost)}. Asumsi demo Rp 5,5 juta per panel termasuk komponen sistem; bukan penawaran pemasang atau hasil survei.</p>
 <label className="report-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Saya ingin mencoba pengajuan survei untuk rumah ini.</label>
 <div className="journey-actions"><button type="submit" disabled={!confirmed||count<1}><ArrowRight aria-hidden/>Ajukan survei demo</button></div></form>}
 </>:<>
 {admin&&<button className="prototype-back" onClick={()=>{setSelected(null);setEditing(false);}}><ArrowLeft aria-hidden/>Semua pengajuan demo</button>}
 <VisualGuide role={current.stage>=4?"teknisi":admin?"pemda":"warga"} title={steps[current.stage]!.title}>{steps[current.stage]!.hint}</VisualGuide>
 <div className="prototype-package"><Sun aria-hidden/><div><strong>{current.panels} panel · {(current.panels*0.55).toFixed(2)} kWp</strong><p>{current.region} · ID {current.id.slice(0,8)}</p></div></div>
 <details className="prototype-progress"><summary>Lihat perjalanan · tahap {current.stage+1} dari {steps.length}</summary><ol className="prototype-timeline" aria-label="Tahapan pemasangan">{steps.map((s,i)=>{const Icon=s.icon;return <li key={s.title} data-state={i<current.stage?"done":i===current.stage?"active":"waiting"} aria-current={i===current.stage?"step":undefined}><Icon aria-hidden/><div><strong>{s.title}</strong>{i===current.stage&&<p>{s.hint}</p>}<small>{current.history.find(h=>h.stage===i)?date(current.history.find(h=>h.stage===i)!.at):"Belum dimulai"}</small></div></li>;})}</ol></details>
 {current.survey&&<p><CalendarDays aria-hidden/>Survei: {date(current.survey)} WITA · Tim Surya Demo</p>}
 {current.stage>=2&&<div className="report-next"><strong>Rancangan contoh hasil survei</strong><p>Atap diasumsikan siap. {current.panels} panel, inverter, struktur penyangga, dan uji sistem. Anggaran contoh {fmtRupiah(cost)}; hasil survei ini dibuat untuk demonstrasi.</p></div>}
 {current.installation&&<p><HardHat aria-hidden/>Pemasangan: {date(current.installation)} WITA · Tim Surya Demo</p>}
 {admin&&nextAdmin!==undefined&&(editing&&(current.stage===0||current.stage===3)?<form className="application-form" onSubmit={e=>{e.preventDefault();const time=Date.parse(`${schedule}+08:00`);if(!Number.isFinite(time)||time<=Date.now()){setError("Pilih jadwal demo yang akan datang (WITA).");return;}advance(nextAdmin);}}><label>Jadwal demo (WITA)<input type="datetime-local" required value={schedule} onChange={e=>setSchedule(e.target.value)}/></label><div className="journey-actions"><button type="submit">Simpan jadwal demo</button><button type="button" onClick={()=>setEditing(false)}>Batal</button></div></form>:<div className="journey-actions"><button onClick={()=>current.stage===0||current.stage===3?setEditing(true):advance(nextAdmin)}><ArrowRight aria-hidden/>{actionLabel}</button></div>)}
 {admin&&current.stage===2&&<p role="status">Menunggu warga menyetujui rancangan demo dari akun mereka.</p>}
 {!admin&&current.stage===2&&<div className="journey-actions"><button onClick={()=>advance(3)}><FileCheck aria-hidden/>Setujui rancangan demo</button></div>}
 {!admin&&current.stage!==2&&current.stage<6&&<p role="status">Menunggu tindak lanjut pemda. Untuk presentasi, lanjutkan tahap melalui akun pemda di browser yang sama.</p>}
 {!admin&&current.stage===6&&<div className="journey-actions"><button onClick={()=>setWatching(v=>!v)}><Sun aria-hidden/>{watching?"Tutup pemantauan simulasi":"Buka pemantauan simulasi"}</button></div>}
 {!admin&&watching&&current.stage===6&&home&&<><p className="prototype-badge">Kapasitas demo · {(current.panels*0.55).toFixed(2)} kWp</p><TelemetryPanel simple id={home.featureId} at={[home.lng,home.lat]} kwhYear={home.kwhYear} installed capacity={current.panels*0.55} roofHeight={home.heightM??3.2}/></>}
 {!admin&&<details><summary>Ulangi presentasi</summary><p>Hapus hanya pengajuan demo rumah ini dan mulai lagi dari awal.</p><div className="journey-actions"><button onClick={()=>{save(read().filter(r=>r.id!==current.id));setConfirmed(false);}}><RotateCcw aria-hidden/>Reset pengajuan demo ini</button></div></details>}
 </>}
 </section>;
}
