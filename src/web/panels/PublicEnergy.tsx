import { Button } from "@heroui/react";
import { useState } from "react";
import { VisualGuide } from "../components/VisualGuide.tsx";
import { House, CloudRain, Wallet, ShieldCheck } from "../icons.ts";
import { EnergyLab } from "./EnergyLab.tsx";
import { AddressSearch } from "../components/AddressSearch.tsx";
import { goToPlace } from "../map/goToPlace.ts";
import { useAppStore } from "../store.ts";
export function PublicEnergy() {
  const [question, setQuestion] = useState("start");
  const answers: Record<string, string> = {
    start: "Belum perlu akun. Coba lab di bawah, atau cari alamat dan pilih atap di peta untuk menghitung potensi bangunan. Hasil belum disimpan sebagai rumahmu.",
    rain: "Panel tetap bisa menghasilkan listrik ketika hujan selama ada cahaya. Produksinya biasanya berkurang. Kekurangan daya dipasok jaringan atau baterai yang masih terisi. Coba hujan ringan dan lebat di lab.",
    cost: "Perkiraan bergantung kapasitas, kondisi atap, pola pemakaian, dan biaya pemasangan. Pilih atap di peta lalu buka manfaat panel surya. Angkanya perkiraan model, bukan penawaran atau jaminan tagihan.",
    account: "Akun diperlukan untuk menyimpan rumah, tagihan, dan laporan pemasangan. Akses publik tidak membuat catatan pemasangan atau membagikan rumah ke pemda. Berbagi data dilakukan lewat pilihan izin pada akun warga.",
  };
  return <div className="sheet__body home public-energy citizen-benefit"><h2 className="place">Energi rumah tanpa akun</h2><VisualGuide title="Belum punya akun? Coba dulu, yuk!">Pilih cuaca, lihat kerja panel, lalu cari rumahmu saat siap.</VisualGuide>
    <AddressSearch compact onPick={place => { useAppStore.getState().setHomeOpen(false); void goToPlace(place); }} />
    <div className="visual-question-grid" role="group" aria-label="Pertanyaan masyarakat">{([{key:"start",label:"Mulai dari mana?",Icon:House},{key:"rain",label:"Kalau hujan?",Icon:CloudRain},{key:"cost",label:"Biaya & hemat",Icon:Wallet},{key:"account",label:"Perlu akun?",Icon:ShieldCheck}]).map(({key,label,Icon}) => <button type="button" key={key} aria-pressed={question===key} onClick={() => setQuestion(key)}><Icon aria-hidden /><span>{label}</span></button>)}</div><p role="status">{answers[question]}</p>
    <EnergyLab />
    <div className="journey-actions"><Button onPress={() => useAppStore.getState().setLoginOpen(true)}>Masuk atau buat akun untuk menyimpan</Button><Button variant="ghost" onPress={() => useAppStore.getState().setHomeOpen(false)}>Jelajahi peta</Button></div><p>Input lab hanya ada di sesi halaman ini dan hilang saat dimuat ulang. Tidak ada rumah contoh yang dicatat sebagai rumah warga.</p>
  </div>;
}
