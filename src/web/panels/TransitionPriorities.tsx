import { useEffect, useState } from "react";
import { Button, Checkbox } from "@heroui/react";
import type { RegionSummary } from "../../shared/types.ts";
import type { ScenarioBasis } from "../../shared/scenario.ts";
import { MapPin, PanelsTopLeft, Zap, ShieldCheck, Wallet } from "../icons.ts";
import { VisualGuide } from "../components/VisualGuide.tsx";
import { transitionPriorities } from "../../shared/transitionPriority.ts";
import { fmtNumber, fmtRupiah } from "../../shared/format.ts";
import { api } from "../api.ts";
import { useAppStore } from "../store.ts";

export function TransitionPriorities({ regions }: { regions: RegionSummary[] }) {
  const [basis, setBasis] = useState<ScenarioBasis | null>(null);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<"efficiency" | "impact">("efficiency");
  const [selected, setSelected] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [evidence, setEvidence] = useState<Record<string, { site: string; roof: string; grid: string; permit: string; budget: string }>>({});
  const [checks, setChecks] = useState<Record<string, boolean[]>>({});
  useEffect(() => { let live = true; setFailed(false); api.scenario().then(value => { if (live) setBasis(value); }, () => { if (live) setFailed(true); }); return () => { live = false; }; }, [retry]);
  if (failed) return <div role="alert"><p>Data untuk membandingkan wilayah belum tersedia.</p><Button onPress={() => setRetry(v => v + 1)}>Coba lagi</Button></div>;
  if (!basis) return <p role="status">Membandingkan potensi wilayah…</p>;
  const ranked = transitionPriorities(regions, basis, sort);
  const chosen = ranked.find(r => r.id === selected) ?? ranked[0];
  const completed = chosen ? (checks[chosen.id] ?? []).filter(Boolean).length : 0;
  const row = (r: typeof ranked[number], index: number) => <li key={r.id}><button type="button" aria-pressed={chosen?.id === r.id} onClick={() => setSelected(r.id)}>
    <span className="transition-ranking__number">{index + 1}</span><span><strong><MapPin className="visual-region-icon" aria-hidden />{r.name}</strong><small>{r.rankValue == null ? "Data pembanding belum lengkap" : sort === "efficiency" ? `${fmtNumber(r.tonnesPerBillion!, 1)} ton CO₂/tahun per Rp 1 miliar` : `${fmtNumber(r.project.co2AvoidedKgYear / 1000)} ton CO₂/tahun pada skenario 10%`}</small></span>
  </button></li>;
  return <section className="transition-priorities" aria-label="Prioritas awal transisi wilayah">
    <VisualGuide role="pemda" title="Mulai dari wilayah mana?">Bandingkan potensi, cek kesiapan, lalu susun pilot pertama.</VisualGuide>
    <p className="journey-copy">Bandingkan calon program PLTS atap sebelum menentukan lokasi pilot dan anggaran.</p>
    <label className="journey-sort">Tujuan prioritas<select value={sort} onChange={e => { setSort(e.target.value as typeof sort); setSelected(null); }}>
      <option value="efficiency">Dampak CO₂ per anggaran yang sama</option><option value="impact">Total pengurangan CO₂ terbesar</option>
    </select></label>
    <ol className="transition-ranking">{ranked.slice(0, 3).map(row)}</ol>
    {chosen && <div className="journey-next" aria-label="Langkah awal wilayah terpilih"><h3>{chosen.name}: kandidat kajian awal</h3>
      <p>{chosen.yieldKwh == null ? "Lengkapi data radiasi dan biaya sebelum membandingkan wilayah ini." : `Setiap 1 kWp diperkirakan menghasilkan ${fmtNumber(chosen.yieldKwh)} kWh/tahun. Urutan ini berasal dari potensi teknis, bukan bukti wilayah sudah siap membangun.`}</p>
      <ol><li>Audit atap kantor dan fasilitas umum yang dapat dijadikan pilot.</li><li>Periksa kondisi atap, sambungan jaringan, izin, dan kesiapan pengelola.</li><li>Susun kapasitas serta anggaran setelah lokasi lolos pemeriksaan.</li></ol>
      <p className="transition-readiness">Kesiapan lapangan: <strong>{completed ? `${completed}/4 pemeriksaan dicatat` : "belum dinilai"}</strong></p>
      <details className="journey-details"><summary>Cek kesiapan pilot wilayah ini</summary><div className="transition-checklist">{["Audit atap selesai", "Kapasitas jaringan dikonfirmasi", "Izin dan pengelola jelas", "Anggaran pilot tersedia"].map((label, index) => { const Icon = [PanelsTopLeft, Zap, ShieldCheck, Wallet][index]!; return <Checkbox key={label} isSelected={checks[chosen.id]?.[index] ?? false} onChange={value => setChecks(previous => { const next = [...(previous[chosen.id] ?? [false, false, false, false])]; next[index] = value; return { ...previous, [chosen.id]: next }; })}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><Icon className="visual-region-icon" aria-hidden />{label}</Checkbox.Content></Checkbox>; })}</div><div className="lab-inputs">{([['site', 'Lokasi pilot / fasilitas'], ['roof', 'Catatan dan referensi audit atap'], ['grid', 'Referensi konfirmasi jaringan'], ['permit', 'Pengelola dan referensi izin'], ['budget', 'Anggaran dan sumber pendanaan']] as const).map(([key, label]) => <label key={key}>{label}<input aria-label={label} maxLength={500} value={evidence[chosen.id]?.[key] ?? ""} onChange={e => setEvidence(previous => ({ ...previous, [chosen.id]: { site: "", roof: "", grid: "", permit: "", budget: "", ...previous[chosen.id], [key]: e.target.value } }))} /></label>)}</div><Button size="sm" variant="outline" onPress={() => {
        const draft = { type: "draft-pilot-belum-diverifikasi", region: chosen.name, createdAt: new Date().toISOString(), checks: checks[chosen.id] ?? [false, false, false, false], evidence: evidence[chosen.id] ?? {}, model: { kWp: chosen.project.kWp, costRp: chosen.project.costRp }, note: "Catatan pengguna, bukan bukti verifikasi, izin, atau persetujuan pembangunan." };
        const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "draf-pilot-transisi.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Unduh draf kajian pilot</Button><p>Isian referensi merupakan catatan pengguna; dokumen belum diunggah atau diperiksa. Unduh draf sebelum menutup halaman.</p><p>Catatan sesi ini saja, belum disimpan ke server atau diverifikasi. Checklist tidak mengubah urutan potensi teknis dan bukan izin pembangunan.</p></details>
      {chosen.yieldKwh != null && <p className="journey-copy">Skenario pasokan surya 10%: {fmtNumber(chosen.project.kWp)} kWp, biaya model {fmtRupiah(chosen.project.costRp)}. Bukan harga penawaran.</p>}
      <div className="journey-actions"><Button size="sm" variant="primary" onPress={() => { const state = useAppStore.getState(); state.setPemdaOpen(false); void state.selectRegion(chosen.id); }}>Lihat wilayah di peta</Button>
        <Button size="sm" variant="ghost" onPress={() => { const state = useAppStore.getState(); state.setPemdaOpen(false); state.setScenarioShare(0.1); state.setScenarioOpen(true); }}>Uji skenario 10%</Button></div>
    </div>}
    {ranked.length > 3 && <details className="journey-details"><summary>Lihat {ranked.length - 3} wilayah lainnya</summary><ol className="transition-ranking">{ranked.slice(3).map((r, index) => row(r, index + 3))}</ol></details>}
    <details className="journey-details"><summary>Dasar urutan dan data yang masih kurang</summary><p>Efisiensi = produksi tahunan per kWp × faktor CO₂ dihindari ÷ biaya per kWp, disetarakan ke anggaran Rp 1 miliar. Dampak total menggunakan skenario 10% konsumsi listrik wilayah. Rumus memakai data dan asumsi yang sama dengan Skenario wilayah; bukan skor kesiapan lapangan.</p><p>Belum tersedia: kapasitas jaringan tersisa, audit atap, kepemilikan, izin, anggaran aktual, dan jadwal pengadaan. Karena itu aplikasi tidak menjanjikan wilayah mana selesai paling cepat. Minat serta pemasangan warga, termasuk data demo, tidak dipakai untuk menaikkan peringkat ini.</p></details>
  </section>;
}
