import { estimateBuilding } from "../../../shared/estimate.ts";
import { fmtKg, fmtKwh, fmtNumber, fmtRupiah } from "../../../shared/format.ts";
import type { BuildingInput, BuildingType } from "../../../shared/types.ts";
import { parseSolarInput, simulateSolarAt } from "../../routes/solar.ts";
import { cachedPoi, poiCacheKey } from "../cache.ts";
import { buildingTypeLabel, estimated, kaltimPoint, latParam, lngParam, percent, point, type ServerTool } from "./common.ts";

// Building-level tools: a rough estimate for the building at a point, and rooftop solar.

const BUILDING_TYPES: readonly BuildingType[] = [
  "rumah",
  "ruko",
  "kantor",
  "pemerintahan",
  "sekolah",
  "kampus",
  "rumah_sakit",
  "hotel",
  "mal",
  "ibadah",
  "gudang",
  "industri",
];

/** Footprint estimate_building_at assumes: it only has a point, not the building outline. */
export const DEFAULT_FOOTPRINT_M2 = 150;

const FOOTPRINT_NOTE =
  `Luas lantai dasar belum diketahui karena gedungnya belum dipilih di peta, jadi dipakai asumsi ${DEFAULT_FOOTPRINT_M2} m2. ` +
  "Angka di panel gedung bisa berbeda karena memakai luas sebenarnya.";
const POI_DOWN_NOTE = "Data POI peta sedang tidak bisa diambil, jadi jenis gedung ditebak dari luas lantai dasar.";

export const estimateBuildingAt: ServerTool = {
  definition: {
    name: "estimate_building_at",
    description:
      "Rough electricity and CO2 estimate for the building at a point, without selecting it. It reads the nearest map POI within 25 m to tell the building type (for example a school) and assumes a 150 m2 footprint, so its numbers can differ from the building panel, which measures the real footprint. When the app state has a selected building, use that instead. Good for checking what is at a place before showing it. Only for points in or near Kalimantan Timur.",
    input_schema: {
      type: "object",
      properties: { lng: lngParam("the building"), lat: latParam("the building") },
      required: ["lng", "lat"],
    },
  },
  run: async (deps, i) => {
    const p = point(i);
    if ("problem" in p) return p;
    const far = kaltimPoint(p.lng, p.lat);
    if (far) return far;
    const found = await cachedPoi(deps, p.lng, p.lat);
    const input: BuildingInput = {
      featureId: `chat:${poiCacheKey(p.lng, p.lat)}`,
      lng: p.lng,
      lat: p.lat,
      footprintM2: DEFAULT_FOOTPRINT_M2,
      heightM: null,
      poiClass: found.poi?.class ?? null,
      poiType: found.poi?.type ?? null,
    };
    const [where, types, grid, equivalents] = await Promise.all([
      deps.db.regionAt(p.lng, p.lat),
      deps.db.getBuildingTypes(),
      deps.db.getGridMix(),
      deps.db.getEquivalentFactors(),
    ]);
    const est = estimateBuilding(input, { types, grid, equivalents, region: where });
    return {
      result: {
        location: { lng: p.lng, lat: p.lat },
        region: est.region?.name ?? "Di luar Kalimantan Timur",
        poi: found.poi
          ? { name: found.poi.name, class: found.poi.class, type: found.poi.type, distanceM: Math.round(found.poi.distanceM) }
          : null,
        type: buildingTypeLabel(est.type),
        buildingType: est.type,
        typeFrom: est.typeSource === "poi" ? "POI peta terdekat" : "tebakan dari luas lantai dasar",
        floors: est.floors,
        footprintM2: DEFAULT_FOOTPRINT_M2,
        floorAreaM2: est.floorAreaM2,
        kwhYear: Math.round(est.kwhYear),
        kwhYearText: estimated(`${fmtKwh(est.kwhYear)} per tahun`),
        kwhMonthText: estimated(`${fmtKwh(est.kwhMonth)} per bulan`),
        co2YearText: estimated(`${fmtKg(est.co2KgYear)} CO2 per tahun`),
        equivalents: est.equivalents.map((e) => `${fmtNumber(e.value)} ${e.label}`),
        assumptions: [FOOTPRINT_NOTE, ...(found.degraded ? [POI_DOWN_NOTE] : []), ...est.assumptions],
      },
    };
  },
};

export const simulateSolar: ServerTool = {
  definition: {
    name: "simulate_solar",
    description:
      "Rooftop solar for a building: system size (kWp) and panel count, yearly production, how much of it the building uses itself (power sent to the grid earns nothing), the share of its yearly need supplied that way, battery size, cost, yearly saving, payback years and CO2 avoided. The building type sets the tariff and when the building uses power, so always pass buildingType when you know it. For the selected building, use the exact values given in the app state. Use backupHours 4 unless the user asks for another backup time. Only for points in or near Kalimantan Timur.",
    input_schema: {
      type: "object",
      properties: {
        lat: latParam("the building"),
        lng: lngParam("the building"),
        roofAreaM2: { type: "number", description: "Roof area in m2 (the building footprint), more than 0." },
        kwhYear: { type: "number", description: "Electricity the building uses per year in kWh, more than 0." },
        backupHours: { type: "number", minimum: 0, maximum: 72, description: "Hours of battery backup; 0 means no battery." },
        buildingType: {
          type: "string",
          enum: [...BUILDING_TYPES],
          description: "The building type (from the app state or estimate_building_at's buildingType). Without it the building is priced as an unknown type.",
        },
      },
      required: ["lat", "lng", "roofAreaM2", "kwhYear", "backupHours"],
    },
  },
  run: async (deps, i) => {
    // "Rumah Sakit" or "rumah sakit" from Claude reads as the id rumah_sakit.
    const type = typeof i.buildingType === "string" ? i.buildingType.trim().toLowerCase().replace(/\s+/g, "_") : i.buildingType;
    const parsed = parseSolarInput({ ...i, buildingType: type === null || type === "" ? undefined : type });
    if ("problem" in parsed) return parsed;
    const far = kaltimPoint(parsed.input.lng, parsed.input.lat);
    if (far) return far;
    const sim = await simulateSolarAt(deps, parsed.input);
    if (sim.kWp <= 0) {
      return { result: { kWp: 0, note: "Atap terlalu kecil untuk dipasangi panel surya.", assumptions: sim.assumptions } };
    }
    return {
      result: {
        input: parsed.input,
        kWp: sim.kWp,
        systemText: estimated(`${fmtNumber(sim.kWp, 1)} kWp, ${fmtNumber(sim.panels)} panel`),
        productionText: estimated(`${fmtKwh(sim.kwhYear)} per tahun`),
        coverageText: estimated(`${percent(sim.coveragePct, 0)} kebutuhan listrik setahun dipasok panel yang dipakai langsung`),
        selfUseText: estimated(`${fmtKwh(sim.selfUseKwh)} per tahun`),
        exportText: estimated(`${fmtKwh(sim.exportKwh)} per tahun, masuk jaringan tanpa imbalan`),
        batteryText:
          sim.batteryKwh > 0
            ? estimated(`${fmtNumber(sim.batteryKwh, 1)} kWh untuk ${fmtNumber(parsed.input.backupHours)} jam cadangan`)
            : "tanpa baterai",
        costText: estimated(fmtRupiah(sim.costRp)),
        savingText: estimated(`${fmtRupiah(sim.savingRpYear)} per tahun`),
        paybackText: estimated(`${fmtNumber(sim.paybackYears, 1)} tahun`),
        paybackPanelText: estimated(`${fmtNumber(sim.paybackPanelYears, 1)} tahun`),
        co2AvoidedText: estimated(`${fmtKg(sim.co2AvoidedKgYear)} CO2 per tahun, dari listrik yang dipakai sendiri`),
        peakSunHoursText: `${fmtNumber(sim.peakSunHours, 1)} jam matahari puncak per hari`,
        assumptions: sim.assumptions,
      },
    };
  },
};
