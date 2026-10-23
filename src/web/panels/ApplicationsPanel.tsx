import {useEffect,useRef,useState} from "react";
import {STATUS_LABELS,APPLICATION_STATUSES,isActiveStatus,type SolarApplication,type SolarApplicationSummary,type PemdaApplicationSummary} from "../../shared/applications.ts";
import {applicationsApi} from "../applicationsApi.ts";
import {InstallationJourney} from "./InstallationJourney.tsx";
import {ApplicationForm} from "./ApplicationForm.tsx";
import {ApplicationDetail} from "./ApplicationDetail.tsx";
import {VisualGuide} from "../components/VisualGuide.tsx";
import {ClipboardList,Plus,RefreshCw} from "lucide-react";
export function ApplicationsPanel({admin=false}:{admin?:boolean}){
 const [prototype,setPrototype]=useState(false);
 const [items,setItems]=useState<(SolarApplicationSummary|PemdaApplicationSummary)[]>([]),[cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<string|null>(null),[creating,setCreating]=useState(false),[loading,setLoading]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState<string|null>(null),[filter,setFilter]=useState(""),[search,setSearch]=useState(""),[query,setQuery]=useState("");const seq=useRef(0);
 const load=async(more=false)=>{const n=++seq.current;setLoading(true);setError(null);const qs=new URLSearchParams({limit:"20"});if(more&&cursor)qs.set("cursor",cursor);if(admin&&filter)qs.set("status",filter);if(admin&&query)qs.set("q",query);
 try{const page=await applicationsApi.list(admin,qs.toString());if(n!==seq.current)return;setItems(old=>more?[...old,...page.items.filter(item=>!old.some(o=>o.id===item.id))]:page.items);setCursor(page.nextCursor);setLoaded(true);}catch(e){if(n===seq.current)setError(e instanceof Error?e.message:"Daftar laporan gagal dimuat.");}finally{if(n===seq.current)setLoading(false);}};
 useEffect(()=>{void load();return()=>{seq.current++;};},[admin,filter,query]);
 const done=(app:SolarApplication)=>{setCreating(false);setSelected(app.id);void load();};
 if(prototype)return <InstallationJourney admin={admin} onBack={()=>setPrototype(false)}/>;
 if(creating)return <ApplicationForm onDone={done} onCancel={()=>{setCreating(false);void load();}}/>;
 if(selected)return <ApplicationDetail id={selected} admin={admin} onBack={()=>{setSelected(null);void load();}} onChanged={()=>void load()}/>;
 const active=items.find(i=>isActiveStatus(i.status));
 return <section className="applications-panel" aria-label={admin?"Antrean laporan PLTS":"Laporan panel saya"}><button className="report-home-cta" type="button" onClick={()=>setPrototype(true)}><Plus aria-hidden/><span><strong>{admin?"Pengajuan pemasangan baru":"Ingin memasang panel?"}</strong><small>Coba alur pemasangan · prototipe browser</small></span></button><h2><ClipboardList aria-hidden/>{admin?"Pemeriksaan laporan":"Laporan panel saya"}</h2><VisualGuide role={admin?"pemda":"warga"} title={admin?"Periksa pemasangan yang dilaporkan":"Panel terpasang, data tercatat"}>{admin?"Tinjau foto dan bukti, minta perbaikan, atau jadwalkan survei sesuai kebutuhan.":"Kirim data panel yang sudah terpasang dan ikuti pemeriksaannya di sini."}</VisualGuide><p>Untuk pendataan pemda, bukan permohonan pemasangan atau izin pasang.</p>
 <div className="journey-actions"><button type="button" disabled={loading} onClick={()=>void load()}><RefreshCw aria-hidden/>Perbarui daftar</button>{!admin&&loaded&&!error&&<button type="button" onClick={()=>active?setSelected(active.id):setCreating(true)}><Plus aria-hidden/>{active?"Lihat laporan aktif":"Laporkan pemasangan"}</button>}</div>
 {admin&&<form className="report-filters" onSubmit={e=>{e.preventDefault();setQuery(search);}}><label>Status laporan<select aria-label="Status laporan" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Semua status</option>{APPLICATION_STATUSES.map(s=><option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label><label>Cari nomor atau nama kontak<input value={search} maxLength={100} onChange={e=>setSearch(e.target.value)}/></label><button type="submit">Cari laporan</button></form>}
 {loading&&<p role="status">Memuat laporan…</p>}{error&&<p role="alert">{error}</p>}{loaded&&!loading&&!error&&!items.length&&<p>{admin?"Belum ada laporan yang sesuai filter.":"Belum ada laporan. Masih mencoba panel? Lanjutkan simulasi di Rumah saya; laporkan setelah sistem benar-benar terpasang."}</p>}
 <ul className="report-list">{items.map(i=><li key={i.id}><button type="button" onClick={()=>setSelected(i.id)}><strong>{i.reference}</strong>{"contactName" in i&&<span>{i.contactName}{i.demo?" · demo":""}</span>}<span className={`report-status report-status--${i.status}`}>{STATUS_LABELS[i.status]}</span><small>{i.regionName} · {i.installedKwp} kWp</small></button></li>)}</ul>
 {cursor&&<button type="button" disabled={loading} onClick={()=>void load(true)}>Muat laporan lainnya</button>}
 </section>;
}
