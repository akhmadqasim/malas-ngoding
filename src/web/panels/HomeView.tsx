import { ChevronLeft, Sun, House, Wallet, PanelsTopLeft, Zap, Settings, Comments, MapPin, ShieldCheck, ChartColumn, ClipboardList } from "../icons.ts";
import { Button, Checkbox, Description, I18nProvider, Input, Label, Skeleton, TextField } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import type { Home } from "../../shared/auth.ts";
import { fmtNumber, fmtRupiah } from "../../shared/format.ts";
import { api, type SolarSimulation } from "../api.ts";
import { chem } from "../components/Chem.tsx";
import { Estimate } from "../components/Estimate.tsx";
import { AddressSearch } from "../components/AddressSearch.tsx";
import { goToPlace } from "../map/goToPlace.ts";
import { useAppStore } from "../store.ts";
import { BUILDING_TYPE_LABELS } from "./buildingTabs.ts";
import { VisualGuide } from "../components/VisualGuide.tsx";
import { PublicEnergy } from "./PublicEnergy.tsx";
import { InstallationSimulator } from "./InstallationSimulator.tsx";
import { TelemetryPanel } from "./TelemetryPanel.tsx";

/** A whole number typed in a field, or null when the field is empty or not a positive number. */
const positive = (s: string) => {
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return s.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The signed-in resident's home in the left sheet. Without a home yet it says how to mark one (click the
 * house on the map, then "Ini rumah saya"). With one: its electricity (from the PLN bill when the resident
 * gives it, else the model estimate), the rooftop solar it suits, what the resident lets the local
 * government see, and a question ready for the energy assistant.
 */
export function HomeView({onReport,onApply}:{onReport?:()=>void;onApply?:()=>void} = {}) {
  const home = useAppStore((s) => s.home);
  const user = useAppStore((s) => s.user);
  const setOpen = useAppStore((s) => s.setHomeOpen);

  if (!user) return <PublicEnergy />;
  return (
    <I18nProvider locale="id-ID">
      <div className="sheet__body home" role="region" aria-label="Rumah saya">
        {!home && <Button variant="ghost" size="sm" className="back" onPress={() => setOpen(false)}>
          <ChevronLeft aria-hidden />
          Pilih rumah di peta
        </Button>}
        <h2 className="place">Rumah saya</h2>
        <p className="place__meta">{home ? "Lokasi rumah sudah tersimpan" : "Tetapkan lokasi rumah satu kali untuk mulai"}</p>
        {home ? <HomeDetail key={home.updatedAt} home={home} onReport={onReport} onApply={onApply} /> : <NoHome />}
      </div>
    </I18nProvider>
  );
}

function NoHome() {
  return (
    <div className="home__empty">
      <VisualGuide title="Yuk, temukan rumahmu!">Pilih rumah sekali. Setelah itu, tinggal login untuk melihat panel dan penghematan.</VisualGuide>
      <p className="journey-lede">Mulai dari rumahmu</p>
      <AddressSearch compact onPick={(place) => void goToPlace(place)} />
      <p className="home__step">
        <span className="num">1</span> Cari alamat atau pakai lokasimu, lalu klik atap rumahmu di peta.
      </p>
      <p className="home__step">
        <span className="num">2</span> Di panel gedung, periksa jenis dan jumlah lantai, lalu tekan <strong>Ini rumah saya</strong>.
      </p>
      <p className="home__step">
        <span className="num">3</span> Kembali ke sini untuk mengisi tagihan PLN dan melihat saran panel surya.
      </p>
    </div>
  );
}

function HomeDetail({ home, onReport, onApply }: { home: Home; onReport?:()=>void;onApply?:()=>void }) {
  const settings = useRef<HTMLDetailsElement>(null);
  const [labOpen, setLabOpen] = useState(false);
  const requestedGoal = useAppStore(s => s.homeGoal);
  const setGoal = useAppStore(s => s.setHomeGoal);
  const goal = requestedGoal ?? (home.installedPv ? "monitor" : "benefit");
  const showMonitor = true;
  const setHome = useAppStore((s) => s.setHome);
  const [kwh, setKwh] = useState(home.kwhMonth === null ? "" : String(home.kwhMonth));
  const [bill, setBill] = useState(home.billRpMonth === null ? "" : String(home.billRpMonth));
  const [interested, setInterested] = useState(home.interestedPv);
  const [installed, setInstalled] = useState(home.installedPv ?? false);
  const [capacity, setCapacity] = useState(home.installedKwp == null ? "" : String(home.installedKwp));
  const [consent, setConsent] = useState(home.consentMap);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [solar, setSolar] = useState<SolarSimulation | null>(null);
  const [solarError, setSolarError] = useState(false);
  const [solarRetry, setSolarRetry] = useState(0);
  const dirty =
    positive(kwh) !== home.kwhMonth || positive(bill) !== home.billRpMonth || interested !== home.interestedPv || consent !== home.consentMap || installed !== (home.installedPv ?? false) || (installed ? positive(capacity) : null) !== (home.installedKwp ?? null);

  // The rooftop solar that suits this home: the same simulation as the building panel, on its own numbers.
  useEffect(() => {
    let live = true;
    setSolar(null);
    setSolarError(false);
    api
      .simulateSolar({ lat: home.lat, lng: home.lng, roofAreaM2: home.roofAreaM2, kwhYear: home.kwhYear, backupHours: 0, buildingType: home.buildingType })
      .then((r) => live && setSolar(r))
      .catch(() => { if (live) { setSolar(null); setSolarError(true); } });
    return () => {
      live = false;
    };
  }, [home, solarRetry]);

  const save = async () => {
    setSaving(true);
    setProblem(null);
    try {
      const { featureId, lng, lat, footprintM2, heightM, buildingType, floors } = home;
      const kwhMonth = positive(kwh);
      const answer = await api.saveHome({
        featureId,
        lng,
        lat,
        footprintM2,
        heightM,
        buildingType,
        floors,
        kwhMonth,
        // The kWh from the bill is the sharper number: a bill amount only counts when no kWh is given.
        billRpMonth: kwhMonth === null ? positive(bill) : null,
        interestedPv: interested,
        installedPv: installed,
        installedKwp: installed ? positive(capacity) : null,
        consentMap: consent,
      });
      setHome(answer.home);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  };

  const showOnMap = () => { setLabOpen(value => !value); };
  const ask = () => {
    const s = useAppStore.getState();
    s.setChatOpen(true);
    s.setChatDraft("Untuk rumah saya, panel surya berapa kWp yang cocok dan berapa lama balik modalnya?");
  };

  return (
    <>
      <p className="home__where"><MapPin aria-hidden />
        {BUILDING_TYPE_LABELS[home.buildingType]}, {home.floors} lantai, {home.regionName ?? "di luar Kalimantan Timur"}
      </p>
      {home.verifiedKwp != null && home.verifiedAt && <p className="report-callout"><ShieldCheck aria-hidden/>Terverifikasi pemda untuk pendataan · {fmtNumber(home.verifiedKwp,2)} kWp. Bukan izin pemasangan.</p>}
      <div className="journey-tabs visual-task-tabs" role="group" aria-label="Tujuan energi rumah"><Button size="sm" variant={goal === "benefit" ? "primary" : "ghost"} onPress={() => {setLabOpen(false);setGoal("benefit");}} aria-label="Manfaat untuk saya"><Wallet aria-hidden /><span>Hemat listrik</span></Button><Button size="sm" variant={goal === "monitor" ? "primary" : "ghost"} onPress={() => {setLabOpen(false);setGoal("monitor");}} aria-label="Pantau rumah"><Sun aria-hidden /><span>Kondisi panel</span></Button></div>
      {!labOpen && <VisualGuide role={goal === "monitor" ? "teknisi" : "warga"} title={goal === "monitor" ? "Yuk, cek panel rumahmu" : "Mau tahu bisa hemat berapa?"}>{goal === "monitor" ? "Lihat listrik dari panel, kebutuhan rumah, dan bantuan jaringan di bawah." : "Ini perkiraan untuk rumahmu. Tekan Coba panel untuk melihat pengaruh cuaca."}</VisualGuide>}
      {!labOpen && <div className="visual-shortcuts"><button type="button" onClick={() => { if(settings.current) {settings.current.open=true;settings.current.scrollIntoView({block:"start",behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});} }}><Settings aria-hidden /><span>Data rumah</span></button><button type="button" onClick={ask}><Comments aria-hidden /><span>Tanya pendamping</span></button></div>}
      {goal === "monitor" && showMonitor && <TelemetryPanel simple roofHeight={home.heightM ?? home.floors * 3.2} id={home.featureId} at={[home.lng, home.lat]} kwhYear={home.kwhYear} installed={home.installedPv ?? false} capacity={home.installedKwp ?? 0} />}
      {goal === "benefit" && !labOpen && <section className="citizen-benefit" aria-label="Manfaat panel surya untuk rumah"><h3><Sun aria-hidden />{home.installedPv ? "Bagaimana manfaat skenario atap lain?" : "Panel surya bisa membantu apa?"}</h3>
        {solarError ? <div role="alert"><p>Perkiraan manfaat belum bisa dihitung.</p><Button size="sm" onPress={() => setSolarRetry(v => v + 1)}>Hitung ulang</Button></div> : !solar ? <p role="status">Menghitung potensi rumahmu…</p> : <><span className="citizen-benefit__label"><Wallet aria-hidden />Perkiraan penghematan</span><strong className="citizen-benefit__saving">{fmtRupiah(solar.savingRpYear / 12)}<small>per bulan</small></strong>
          <div className="journey-actions"><Button variant="primary" size="sm" aria-label="Lihat pilihan panel di atap" onPress={showOnMap}><PanelsTopLeft aria-hidden />Coba panel</Button><Button variant="ghost" size="sm" onPress={ask}><Comments aria-hidden />Tanya asisten</Button></div>
          <dl className="visual-benefits" aria-label="Ringkasan manfaat panel"><div><PanelsTopLeft aria-hidden /><dt>Jumlah panel</dt><dd>{fmtNumber(solar.panels)} panel</dd></div><div><Zap aria-hidden /><dt>Listrik terbantu</dt><dd>{fmtNumber(solar.coveragePct)}% / tahun</dd></div><div><Wallet aria-hidden /><dt>Biaya awal model</dt><dd>{fmtRupiah(solar.costRp)}</dd></div></dl>
          <p className="journey-copy">Perkiraan, bukan harga penawaran atau jaminan tagihan.</p>
          </>}
      </section>}
      {labOpen && <InstallationSimulator home={home} initialPanels={solar?.panels ?? 1} onClose={() => setLabOpen(false)} />}
      {!labOpen && onApply && <button className="report-home-cta" type="button" onClick={onApply}><Sun aria-hidden/><span><strong>Ingin memasang panel?</strong><small>Coba alur survei sampai pemasangan · prototipe.</small></span></button>}
      {!labOpen && onReport && <button className="report-home-cta" type="button" onClick={onReport}><ClipboardList aria-hidden/><span><strong>Sudah memasang panel?</strong><small>Laporkan pemasangan untuk pendataan pemda.</small></span></button>}
      {!labOpen && <>
      <details className="journey-details"><summary><ChartColumn aria-hidden />Perhitungan lengkap dan status pemasangan</summary>
      <p className="journey-copy">{home.installedPv ? `${home.installedKwp == null ? "Kapasitas belum diisi" : `${fmtNumber(home.installedKwp, 2)} kWp dilaporkan terpasang`}. Laporan pemilik.` : "Belum ada pemasangan tercatat. Simulasi tidak mengubah status pemasangan."}</p>
      <div className="readout">
        <p className="readout__label">Listrik terpakai</p>
        <p className="readout__figure num">{fmtNumber(home.kwhYear)}</p>
        <p className="readout__unit">
          kWh per tahun, {home.kwhSource === "tagihan" ? "dari tagihan PLN yang kamu isi" : <Estimate />}
        </p>
      </div>

      <div className="home__solar">
        <p className="group-label">{home.installedPv ? "Simulasi alternatif panel surya" : "Saran panel surya untuk rumah ini"}</p>
        {solar ? (
          <dl className="facts">
            <div className="fact">
              <dt className="fact__label">Kapasitas</dt>
              <dd className="fact__value">
                <span className="fact__number num">{fmtNumber(solar.kWp, 2)} kWp</span>
                <span className="fact__unit">
                  {fmtNumber(solar.panels)} panel, <Estimate />
                </span>
              </dd>
            </div>
            <div className="fact">
              <dt className="fact__label">Kebutuhan tertutup</dt>
              <dd className="fact__value">
                <span className="fact__number num">{fmtNumber(solar.coveragePct)}%</span>
                <span className="fact__unit">
                  dari listrik setahun, <Estimate />
                </span>
              </dd>
            </div>
            <div className="fact">
              <dt className="fact__label">Biaya pasang</dt>
              <dd className="fact__value">
                <span className="fact__number num">{fmtRupiah(solar.costRp)}</span>
                <span className="fact__unit">
                  hemat {fmtRupiah(solar.savingRpYear)} per tahun, <Estimate />
                </span>
              </dd>
            </div>
            <div className="fact">
              <dt className="fact__label">Balik modal</dt>
              <dd className="fact__value">
                <span className="fact__number num">{fmtNumber(solar.paybackPanelYears, 1)} tahun</span>
                <span className="fact__unit">
                  {chem(`CO2 dihindari ${fmtNumber(solar.co2AvoidedKgYear)} kg per tahun`)}, <Estimate />
                </span>
              </dd>
            </div>
          </dl>
        ) : solarError ? <p>Perhitungan belum tersedia. Gunakan Hitung ulang di Manfaat untuk saya.</p> : (
          <Skeleton className="scenario__skeleton scenario__skeleton--big" />
        )}
        <div className="home__actions">
          <Button variant="primary" size="sm" onPress={showOnMap}>
            Coba skenario rumah ini
          </Button>
          <Button variant="outline" size="sm" onPress={ask}>
            Tanya asisten
          </Button>
        </div>
      </div>

      </details>
      <details ref={settings} className="journey-details"><summary><Settings aria-hidden />Ubah tagihan, pemasangan, dan izin data</summary><div className="home__form">
        <p className="group-label">Data dari tagihan PLN (boleh kosong)</p>
        <TextField name="kwh" inputMode="numeric" value={kwh} onChange={setKwh}>
          <Label>Pemakaian per bulan, kWh</Label>
          <Input placeholder="contoh 220" />
          <Description>Tertulis di struk atau aplikasi PLN Mobile. Angka ini menggantikan perkiraan.</Description>
        </TextField>
        <TextField name="bill" inputMode="numeric" value={bill} onChange={setBill} isDisabled={positive(kwh) !== null}>
          <Label>Atau tagihan per bulan, Rp</Label>
          <Input placeholder="contoh 320000" />
        </TextField>
        <Checkbox isSelected={installed} onChange={setInstalled}>
          <Checkbox.Content>
            <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
            Rumah ini sudah memasang panel surya
          </Checkbox.Content>
        </Checkbox>
        {installed && <TextField name="installedKwp" inputMode="decimal" value={capacity} onChange={setCapacity}>
          <Label>Kapasitas terpasang, kWp (boleh kosong)</Label>
          <Input placeholder="contoh 2,2" />
          <Description>Isi kapasitas sistem yang sudah dipasang, bukan hasil simulasi. Status ini merupakan laporan pemilik.</Description>
        </TextField>}
        <Checkbox isSelected={interested} onChange={setInterested}>
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            Saya tertarik memasang panel surya
          </Checkbox.Content>
        </Checkbox>
        <Checkbox isSelected={consent} onChange={setConsent}>
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            Izinkan pemerintah daerah melihat rumah ini sebagai titik di peta, tanpa nama dan email
          </Checkbox.Content>
        </Checkbox>
        {problem && (
          <p className="account__problem" role="alert">
            {problem}
          </p>
        )}
        <div className="home__actions">
          <Button variant="primary" size="sm" isDisabled={!dirty} isPending={saving} onPress={save}>
            <ShieldCheck aria-hidden />Simpan
          </Button>
          <p className="journey-copy">Lokasi rumah sudah terhubung dengan akun ini. Perubahan tagihan dan panel di halaman ini tetap berlaku untuk rumah yang sama.</p>
        </div>
      </div></details>
      <footer className="sheet__foot">
        <p className="sheet__source">
          {fmtNumber(home.roofAreaM2)} m² atap, muat sampai {fmtNumber(home.potentialKwp, 1)} kWp. Simulasi panel memakai tarif PLN, jam matahari NASA POWER dan
          aturan tanpa imbalan ekspor (Permen ESDM 2/2024).
        </p>
      </footer>
      </>}
    </>
  );
}
