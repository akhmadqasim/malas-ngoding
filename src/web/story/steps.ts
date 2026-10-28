import { flyToProvince } from "../map/camera.ts";
import { useAppStore } from "../store.ts";

/*
 * The guided story: two tracks through the same map, one for residents (warga) and one for local government
 * (pemda). Each step names its phase of the energy transition and the SDG target it serves, sets the map to
 * the view it talks about, and says in a sentence or two what to look at. Leaving the story leaves the map
 * as the last step set it, to explore freely.
 */

export type StoryTrack = "warga" | "pemda";
/** The energy transition, in four phases: where Kaltim stands, understanding it, planning, acting. */
export type TransitionPhase = "sekarang" | "memahami" | "merencanakan" | "bertindak";

export const PHASE_LABEL: Record<TransitionPhase, string> = {
  sekarang: "Kondisi sekarang",
  memahami: "Memahami",
  merencanakan: "Merencanakan transisi",
  bertindak: "Bertindak",
};

export interface StoryStep {
  /** Short name in the stepper. */
  label: string;
  title: string;
  text: string;
  phase: TransitionPhase;
  /** The SDG targets this step serves, as written in the SDG list (for example "7.1"). */
  sdg: string[];
  /** Sets the map and the panels to this step's view. */
  enter: () => void;
}

/** A building near the centre of Samarinda that the demo uses (docs/technical/demo-script.md). */
const DEMO_BUILDING: [number, number] = [117.1475, -0.4955];

/** Closes every view a step may have opened, so each step starts from a known map. */
function clearViews(): void {
  const s = useAppStore.getState();
  if (s.homeOpen) s.setHomeOpen(false);
  if (s.pemdaOpen) s.setPemdaOpen(false);
  if (s.buildingStatus !== "idle") s.closeBuilding();
  if (s.scenarioOpen) s.setScenarioOpen(false);
  if (s.twinOpen) s.setTwinOpen(false);
  if (s.potentialOpen) s.setPotentialOpen(false);
}

function province(): void {
  clearViews();
  const s = useAppStore.getState();
  s.setMetric("co2");
  if (s.selectedRegionId !== null) s.selectRegion(null);
  else if (s.map) flyToProvince(s.map);
}

function region(id: string): void {
  clearViews();
  useAppStore.getState().selectRegion(id);
}

/**
 * Opens a building on `tab`, keeping it when it is already open: the signed-in resident's own home when they
 * have marked one, else the demo building.
 */
function building(tab: "energi" | "surya" | "cuaca"): void {
  const s = useAppStore.getState();
  if (s.homeOpen) s.setHomeOpen(false);
  if (s.pemdaOpen) s.setPemdaOpen(false);
  if (s.scenarioOpen) s.setScenarioOpen(false);
  if (s.twinOpen) s.setTwinOpen(false);
  if (s.potentialOpen) s.setPotentialOpen(false);
  s.setPanelTab(tab);
  if (s.buildingStatus === "idle") {
    if (s.selectedRegionId !== null) s.selectRegion(null);
    const home = s.home;
    void useAppStore
      .getState()
      .selectBuildingAt(home ? [home.lng, home.lat] : DEMO_BUILDING, home ? { type: home.buildingType, name: "Rumah saya" } : { name: "Gedung contoh di Samarinda" });
  }
}

function scenario(): void {
  clearViews();
  const s = useAppStore.getState();
  if (s.selectedRegionId !== null) s.selectRegion(null);
  s.setScenarioShare(0.2);
  s.setScenarioOpen(true);
}

function twin(): void {
  clearViews();
  const s = useAppStore.getState();
  if (s.selectedRegionId !== null) s.selectRegion(null);
  s.setTwinOpen(true);
}

function potential(): void {
  clearViews();
  const s = useAppStore.getState();
  if (s.selectedRegionId !== null) s.selectRegion(null);
  s.setPotentialOpen(true);
  s.setPotentialKind("sun");
}

export const STORY: Record<StoryTrack, { name: string; lede: string; steps: StoryStep[] }> = {
  warga: {
    name: "Untuk masyarakat",
    lede: "Dari listrik di rumahmu sampai panel surya di atapmu.",
    steps: [
      {
        label: "Listrik kita",
        title: "Listrik Kaltim masih dari batu bara",
        text: "Tinggi kolom adalah emisi CO₂ tiap wilayah. Sebagian besar listrik yang kita pakai dibangkitkan dari batu bara, jadi setiap kWh ikut menambah emisi.",
        phase: "sekarang",
        sdg: ["7.2", "13.2"],
        enter: province,
      },
      {
        label: "Gedungmu",
        title: "Berapa listrik dan emisi satu gedung?",
        text: "Rumahmu bila sudah kamu tandai (masuk sebagai warga, klik rumahnya, lalu Ini rumah saya), atau satu gedung contoh di Samarinda: perkiraan listriknya per tahun dan per bulan.",
        phase: "memahami",
        sdg: ["7.3"],
        enter: () => building("energi"),
      },
      {
        label: "Panel surya",
        title: "Berapa panel surya muat di atapnya?",
        text: "Tab Surya menghitung kapasitas panel, bagian listrik yang tertutup, biaya dan lama balik modal dengan tarif PLN. Atapnya berubah kuning di peta.",
        phase: "merencanakan",
        sdg: ["7.2"],
        enter: () => building("surya"),
      },
      {
        label: "Cuaca",
        title: "Berapa produksi panel besok?",
        text: "Tab Cuaca memakai prakiraan cuaca asli: hari cerah panel menghasilkan lebih banyak, hujan dan awan menurunkannya.",
        phase: "memahami",
        sdg: ["7.2"],
        enter: () => building("cuaca"),
      },
      {
        label: "Kalau semua ikut",
        title: "Kalau banyak atap memasang panel",
        text: "Geser slider: bila sebagian listrik tiap wilayah datang dari atap sendiri, kolom emisi turun dan panel kiri menghitung CO₂ yang hilang.",
        phase: "merencanakan",
        sdg: ["7.2", "13.2"],
        enter: scenario,
      },
      {
        label: "Langkahmu",
        title: "Yang bisa kamu lakukan",
        text: "Hemat listrik di jam puncak malam, cek atapmu di tab Surya sebelum membeli panel, dan tanyakan apa saja ke Asisten energi di kanan bawah.",
        phase: "bertindak",
        sdg: ["7.3", "12.8"],
        enter: province,
      },
    ],
  },
  pemda: {
    name: "Untuk pemerintah",
    lede: "Dari data per wilayah sampai lokasi PLTS dan kebijakannya.",
    steps: [
      {
        label: "Peta emisi",
        title: "Kondisi energi 10 kabupaten dan kota",
        text: "Daftar di kiri mengurutkan wilayah menurut emisi. Samarinda, Kutai Kartanegara dan Balikpapan menyumbang emisi terbesar.",
        phase: "sekarang",
        sdg: ["7.2", "13.2"],
        enter: province,
      },
      {
        label: "Akses listrik",
        title: "Masih ada desa yang belum dilayani PLN",
        text: "Kutai Barat masih punya desa tanpa layanan PLN. Panel kiri menunjukkan rasio elektrifikasi dan rekomendasi yang disusun untuk pemdanya.",
        phase: "memahami",
        sdg: ["7.1"],
        enter: () => region("kutai-barat"),
      },
      {
        label: "Target PLTS atap",
        title: "Berapa kapasitas dan biaya untuk satu target?",
        text: "Geser slider untuk menguji target: kapasitas panel (MWp), biaya pasang dan emisi yang dihindari muncul sebelum kebijakan dijalankan.",
        phase: "merencanakan",
        sdg: ["7.2", "13.2"],
        enter: scenario,
      },
      {
        label: "Operasi 24 jam",
        title: "Beban puncak terjadi malam hari",
        text: "Tekan Putar 24 jam. Siang hari surya menutup sebagian beban, tetapi puncak sekitar pukul 19.00 tetap dari jaringan: transisi butuh penyimpanan atau pembangkit bersih malam hari.",
        phase: "memahami",
        sdg: ["7.2", "7.b"],
        enter: twin,
      },
      {
        label: "Lokasi PLTS",
        title: "Di mana membangun PLTS?",
        text: "Matahari Kaltim merata, anginnya terlalu lemah untuk PLTB. Pilih sel teratas lalu Bangun PLTS di sini: lokasi dicek agar tidak di permukiman, perairan atau kawasan lindung.",
        phase: "merencanakan",
        sdg: ["7.2", "11.3"],
        enter: potential,
      },
      {
        label: "Kebijakan",
        title: "Rekomendasi untuk pemerintah daerah",
        text: "Setiap wilayah punya rekomendasi sendiri, misalnya PLTS atap gedung pemerintah di Samarinda. Pakai angka-angka ini sebagai bahan RUED dan RPJMD, lalu jelajahi wilayah lain.",
        phase: "bertindak",
        sdg: ["7.2", "7.a", "13.2"],
        enter: () => region("samarinda"),
      },
    ],
  },
};
