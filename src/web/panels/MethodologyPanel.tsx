import { Button, Drawer, Skeleton } from "@heroui/react";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import buildingTypes from "../../../data/seed/building-types.json";
import equivalents from "../../../data/seed/equivalents.json";
import { fmtNumber } from "../../shared/format.ts";
import type { BuildingType, Equivalent, FuelType, GridMix } from "../../shared/types.ts";
import { ApiError, api } from "../api.ts";
import { chem } from "../components/Chem.tsx";
import { Estimate } from "../components/Estimate.tsx";
import { FUEL_LABELS, FUELS } from "../map/fuels.ts";
import "../recommendations.css";

/** Kg CO2 per kWh of the grid-mix average: each fuel's share times its own factor. */
export function fuelMixAverage(grid: Pick<GridMix, "shares" | "fuelFactors">): number {
  return FUELS.reduce((sum, fuel) => sum + (grid.shares[fuel] ?? 0) * (grid.fuelFactors[fuel] ?? 0), 0);
}

/** A seed value counts as checked only when its source says "verified" (and not "unverified"). */
export function isVerified(source: string): boolean {
  return /\bverified\b/i.test(source);
}

const factor = (n: number) => fmtNumber(n, 2);
const pct = (share: number) => `${fmtNumber(share * 100)}%`;
/** Per-unit factors as precise as the seed gives them: 0,017, 0,19, 22, 111,1. */
const perUnit = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });

const TYPE_TEXT: Record<BuildingType, { label: string; basis: string }> = {
  rumah: { label: "Rumah", basis: "Dari konsumsi rumah tangga 900 sampai 1.300 VA" },
  ruko: { label: "Ruko", basis: "Sekitar setengah rata-rata gedung komersial" },
  kantor: { label: "Kantor", basis: "Survei ESDM SEC 2021, rata-rata 180,95" },
  pemerintahan: { label: "Kantor pemerintah", basis: "Sekitar 70% kantor swasta, jam AC lebih pendek" },
  sekolah: { label: "Sekolah", basis: "Kipas dan lampu, sedikit ruang ber-AC" },
  kampus: { label: "Kampus", basis: "Dari pengukuran satu fakultas teknik (84,71)" },
  rumah_sakit: { label: "Rumah sakit", basis: "Survei ESDM SEC 2021, rata-rata 180,81" },
  hotel: { label: "Hotel", basis: "Survei ESDM SEC 2021, rata-rata 208,15" },
  mal: { label: "Mal", basis: "Survei ESDM SEC 2021, rata-rata 286,54" },
  ibadah: { label: "Rumah ibadah", basis: "Lampu, kipas, pengeras suara" },
  gudang: { label: "Gudang", basis: "Lampu dan kipas" },
  industri: { label: "Industri ringan", basis: "Industri berat butuh data meteran sendiri" },
};

const EQUIVALENT_BASIS: Record<Equivalent["key"], string> = {
  mobil_km: "Rata-rata mobil baru 190 g per km, sumber sekunder",
  motor_km: "2,31 kg CO2 per liter bensin dibagi 45 km per liter",
  pohon: "Angka yang sering dikutip; rentangnya 10 sampai 40 kg",
  charge_hp: "15 Wh per pengisian penuh dikali faktor jaringan 1,14",
  penerbangan: "Kalkulator ICAO ICEC, ekonomi sekali jalan 1.255 km",
};

const TYPE_ROWS = (Object.keys(TYPE_TEXT) as BuildingType[]).map((type) => {
  const seed = (buildingTypes as Record<BuildingType, { intensityKwhM2Year: number; typicalFloors: number; source: string }>)[type];
  return { type, ...TYPE_TEXT[type], intensity: seed.intensityKwhM2Year, floors: seed.typicalFloors, assumption: !isVerified(seed.source) };
});

const EQUIVALENT_ROWS = (equivalents as { key: Equivalent["key"]; label: string; kgCo2PerUnit: number; source: string }[]).map((e) => ({
  ...e,
  basis: EQUIVALENT_BASIS[e.key],
  assumption: !isVerified(e.source),
}));

/**
 * "Cara menghitung dan sumber data": a text button that opens a side sheet with the formulas, the factor
 * tables (asumsi rows marked) and every data source with its licence. Mounted in "Tentang peta ini".
 */
export function MethodologyPanel() {
  return (
    <Drawer>
      <Button variant="outline" size="sm" className="methodology-open">
        Cara menghitung dan sumber data
      </Button>
      <Drawer.Backdrop variant="transparent">
        <Drawer.Content placement="right">
          <Drawer.Dialog className="methodology">
            <Drawer.CloseTrigger aria-label="Tutup" className="methodology__close" />
            <Drawer.Header className="methodology__header">
              <Drawer.Heading className="methodology__title">Cara menghitung dan sumber data</Drawer.Heading>
              <p className="methodology__lede">
                Semua angka di peta ini perkiraan dari data publik, bukan hasil meteran. Baris bertanda <Assumption /> memakai
                angka kerja tim yang belum punya sumber terverifikasi.
              </p>
            </Drawer.Header>
            <Drawer.Body className="methodology__body">
              <MethodologyLoader />
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}

type GridState = { status: "loading" } | { status: "ready"; grid: GridMix } | { status: "error"; message: string };

/** Reads the grid mix from /api/grid each time the sheet opens, then shows the content. */
function MethodologyLoader() {
  const [state, setState] = useState<GridState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    api
      .grid()
      .then((grid) => live && setState({ status: "ready", grid }))
      .catch((err: unknown) => {
        if (live) setState({ status: "error", message: err instanceof ApiError ? err.message : "Terjadi kesalahan yang tidak terduga." });
      });
    return () => {
      live = false;
    };
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (state.status === "ready") return <MethodologyContent grid={state.grid} />;
  if (state.status === "error") {
    return (
      <div className="recs__failure" role="alert">
        <p className="recs__failure-text">
          Data bauran listrik belum bisa dimuat. <span className="recs__failure-reason">{state.message}</span>
        </p>
        <Button size="sm" variant="primary" onPress={retry}>
          Coba lagi
        </Button>
      </div>
    );
  }
  return (
    <div className="methodology__skeleton" aria-busy aria-label="Memuat data bauran listrik">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} animationType="none" className="recs__skeleton-line" />
      ))}
    </div>
  );
}

/** The quiet "asumsi" mark of a table row whose value has no verified source. */
function Assumption() {
  return <em className="methodology__assumption">asumsi</em>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="methodology__section" aria-labelledby={id}>
      <h3 id={id} className="methodology__heading">
        {chem(title)}
      </h3>
      {children}
    </section>
  );
}

function Formula({ children }: { children: ReactNode }) {
  return <p className="methodology__formula">{children}</p>;
}

export function MethodologyContent({ grid }: { grid: GridMix }) {
  const average = fuelMixAverage(grid);
  const higherPct = average > 0 ? (grid.factorKgPerKwh / average - 1) * 100 : 0;
  const fuels = FUELS.filter((f: FuelType) => (grid.shares[f] ?? 0) > 0);

  return (
    <>
      <Section title="Listrik per wilayah">
        <p>
          Penjualan listrik PLN 2024 per cabang (BPS Kalimantan Timur) dibagi ke kabupaten dan kota menurut jumlah
          pelanggan. Pembagian ini mengabaikan industri, jadi wilayah dengan tambang dan pabrik (Bontang, Kutai Timur, Kutai
          Barat) bisa meleset sekitar 30%.
        </p>
      </Section>

      <Section title="Emisi CO2">
        <Formula>{chem(`CO2 (kg) = listrik (kWh) × ${factor(grid.factorKgPerKwh)} kg CO2 per kWh`)}</Formula>
        <dl className="methodology__factors">
          <div className="methodology__factor" data-used>
            <dt>Faktor resmi Sistem Mahakam</dt>
            <dd>
              <span className="methodology__value num">{factor(grid.factorKgPerKwh)}</span> {chem("kg CO2/kWh")}, dipakai
            </dd>
            <dd className="methodology__factor-note">
              Nilai combined margin dari Kementerian ESDM (Kepmen 163.K/HK.02/MEM.S/2021), data 2019.
            </dd>
          </div>
          <div className="methodology__factor">
            <dt>Rata-rata bauran listrik</dt>
            <dd>
              <span className="methodology__value num">{factor(average)}</span> {chem("kg CO2/kWh")}, <Estimate />
            </dd>
            <dd className="methodology__factor-note">Bauran {grid.year} dikali faktor per bahan bakar pada tabel di bawah.</dd>
          </div>
        </dl>
        <p>
          Aplikasi memakai {factor(grid.factorKgPerKwh)} karena itu angka resmi untuk jaringan Kalimantan Timur. Combined
          margin mengukur emisi pembangkit yang berubah bila listrik dihemat atau digantikan PLTS, jadi cocok untuk menghitung
          emisi yang bisa dihindari. Rata-rata bauran hanya perkiraan kami dari kapasitas pembangkit. Akibatnya angka{" "}
          {chem("CO2")} di peta sekitar {fmtNumber(higherPct)}% lebih tinggi daripada bila memakai rata-rata bauran.
        </p>
      </Section>

      <Section title="Bauran listrik dan faktor per bahan bakar">
        <table className="methodology__table">
          <caption>
            Bauran {grid.year}: kapasitas terpasang (Dinas ESDM Kaltim) dikali faktor kapasitas. Faktor bahan bakar: IPCC
            2006 dibagi efisiensi pembangkit.
          </caption>
          <thead>
            <tr>
              <th scope="col">Bahan bakar</th>
              <th scope="col" className="methodology__num">
                Porsi
              </th>
              <th scope="col" className="methodology__num">
                {chem("kg CO2/kWh")}
              </th>
              <th scope="col">Dasar</th>
            </tr>
          </thead>
          <tbody>
            {fuels.map((fuel) => (
              <tr key={fuel} data-assumption>
                <th scope="row">{FUEL_LABELS[fuel]}</th>
                <td className="methodology__num num">{pct(grid.shares[fuel] ?? 0)}</td>
                <td className="methodology__num num">{factor(grid.fuelFactors[fuel] ?? 0)}</td>
                <td>
                  <Assumption />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Rincian per bahan bakar di panel gedung memakai porsi ini, lalu diskalakan supaya totalnya tetap sama dengan kWh ×{" "}
          {factor(grid.factorKgPerKwh)}.
        </p>
      </Section>

      <Section title="Listrik satu gedung">
        <Formula>kWh per tahun = luas lantai dasar × jumlah lantai × intensitas energi</Formula>
        <p>
          Jenis gedung ditebak dari tempat terdekat di peta (radius 25 m), atau dari luas lantai dasar bila tidak ada. Jumlah
          lantai = tinggi gedung ÷ 3,5 m, atau jumlah lantai umum bila tinggi tidak diketahui. Luas dibatasi 10 sampai 50.000 m²
          dan lantai 1 sampai 40.
        </p>
        <table className="methodology__table">
          <caption>Intensitas energi per jenis gedung, kWh per m² lantai per tahun.</caption>
          <thead>
            <tr>
              <th scope="col">Jenis</th>
              <th scope="col" className="methodology__num">
                kWh/m²
              </th>
              <th scope="col" className="methodology__num">
                Lantai
              </th>
              <th scope="col">Dasar</th>
            </tr>
          </thead>
          <tbody>
            {TYPE_ROWS.map((row) => (
              <tr key={row.type} data-assumption={row.assumption || undefined}>
                <th scope="row">{row.label}</th>
                <td className="methodology__num num">{fmtNumber(row.intensity)}</td>
                <td className="methodology__num num">{fmtNumber(row.floors)}</td>
                <td>
                  {row.basis}
                  {row.assumption && (
                    <>
                      , <Assumption />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Padanan CO2">
        <Formula>{chem("padanan = kg CO2 ÷ kg CO2 per satuan")}</Formula>
        <table className="methodology__table">
          <caption>{chem("Supaya angka kilogram mudah dibayangkan.")}</caption>
          <thead>
            <tr>
              <th scope="col">Padanan</th>
              <th scope="col" className="methodology__num">
                {chem("kg CO2")}
              </th>
              <th scope="col">Dasar</th>
            </tr>
          </thead>
          <tbody>
            {EQUIVALENT_ROWS.map((row) => (
              <tr key={row.key} data-assumption={row.assumption || undefined}>
                <th scope="row">{row.label}</th>
                <td className="methodology__num num">{perUnit.format(row.kgCo2PerUnit)}</td>
                <td>
                  {chem(row.basis)}
                  {row.assumption && (
                    <>
                      , <Assumption />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Panel surya">
        <Formula>hasil per kWp per tahun = jam puncak matahari × 365 × 0,78</Formula>
        <p>
          Jam puncak matahari dari NASA POWER di titik gedung (4,2 jam bila layanan itu tidak terjangkau). Harga panel,
          baterai, dan tarif PLN berasal dari berita dan blog vendor 2026 yang belum diverifikasi. Balik modal dihitung
          sederhana, tanpa bunga dan kenaikan tarif.
        </p>
      </Section>

      <Section title="Rekomendasi untuk pemerintah daerah">
        <p>
          Ditulis oleh AI (Claude) hanya dari angka di aplikasi ini: data wilayah, pembangkit di dalam wilayah, jam puncak
          matahari, desa tanpa listrik PLN, dan bauran listrik. Bila AI tidak tersedia, saran disusun dari aturan tetap dan
          diberi label berbasis aturan.
        </p>
      </Section>

      <Section title="Sumber data dan lisensi">
        <ul className="methodology__sources">
          {SOURCES.map((s) => (
            <li key={s.name} className="methodology__source">
              <p className="methodology__source-name">{s.href ? <a href={s.href} target="_blank" rel="noreferrer">{s.name}</a> : s.name}</p>
              <p>{chem(s.use)}</p>
              <p className="methodology__licence">{s.licence}</p>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

const SOURCES: { name: string; href?: string; use: string; licence: string }[] = [
  {
    name: "geoBoundaries gbOpen IDN ADM2",
    href: "https://www.geoboundaries.org/",
    use: "Batas 10 kabupaten dan kota (sumber asli: BPS, World Food Programme, OCHA ROAP).",
    licence:
      "CC BY 3.0 IGO. geoBoundaries (www.geoboundaries.org); Runfola, D., dkk. (2020), geoBoundaries: A global database of political administrative boundaries, PLoS ONE 15(4): e0231866.",
  },
  {
    name: "BPS Kalimantan Timur",
    href: "https://kaltim.bps.go.id/",
    use: "Penjualan listrik PLN per cabang, pelanggan, rasio elektrifikasi (Kalimantan Timur Dalam Angka 2025), proyeksi penduduk 2025.",
    licence: "Data publik BPS, dikutip dengan menyebut sumber.",
  },
  {
    name: "Kementerian ESDM dan Dinas ESDM Kalimantan Timur",
    use: "Faktor emisi Sistem Mahakam (Kepmen 163.K/HK.02/MEM.S/2021), intensitas energi gedung (SEC 2021), kapasitas pembangkit (Satu Data Kaltim).",
    licence: "Dokumen dan data pemerintah, dikutip dengan menyebut sumber.",
  },
  {
    name: "Berita 2026",
    use: "Jumlah desa yang belum dilayani PLN, dari pernyataan Gubernur yang dikutip media.",
    licence: "Belum terverifikasi.",
  },
  {
    name: "IPCC 2006 Guidelines dan kalkulator ICAO (ICEC)",
    use: "Faktor emisi per bahan bakar dan padanan penerbangan.",
    licence: "Dikutip dengan menyebut sumber.",
  },
  {
    name: "NASA POWER",
    href: "https://power.larc.nasa.gov/",
    use: "Radiasi matahari untuk simulasi panel surya.",
    licence: "Data terbuka dari NASA Langley Research Center, Prediction Of Worldwide Energy Resources (POWER) Project.",
  },
  {
    name: "Open-Meteo",
    href: "https://open-meteo.com/",
    use: "Prakiraan cuaca dan radiasi per jam.",
    licence: "CC BY 4.0. Weather data by Open-Meteo.com.",
  },
  {
    name: "Mapbox dan OpenStreetMap",
    href: "https://www.openstreetmap.org/copyright",
    use: "Peta dasar, gedung 3D, dan tempat di sekitar gedung.",
    licence: "© Mapbox (Mapbox Terms of Service), © kontributor OpenStreetMap (ODbL).",
  },
  {
    name: "Global Energy Monitor (gem.wiki) dan daftar pembangkit WRI",
    href: "https://www.gem.wiki/",
    use: "Kapasitas, status, dan lokasi pembangkit; sebagian lokasi perkiraan tim.",
    licence: "gem.wiki CC BY-NC-SA; aplikasi ini nonkomersial.",
  },
  {
    name: "Berita dan blog vendor 2026",
    use: "Tarif PLN, harga panel surya dan baterai.",
    licence: "Belum terverifikasi, dicatat sebagai asumsi.",
  },
];
