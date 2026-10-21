import { fmtNumber } from "../../../shared/format.ts";
import type { BuildingType } from "../../../shared/types.ts";
import { inRange, kaltimPoint, latParam, lngParam, point, REGION_PARAM, region, type ServerTool } from "./common.ts";
import type { PlaceHit } from "./placeSearch.ts";

// find_places: places of a kind (schools, hospitals, ...) in a region or near a point, from the Mapbox
// Search Box category search. The places found are marked on the map at once (a `mark_places` action), so
// Claude only has to pick one to select.

interface Category {
  /** Mapbox canonical category id. */
  id: string;
  /** What the user calls it, in Indonesian. */
  label: string;
  /** Mapbox categories that share the id but are not what people mean (a driving school is no school building). */
  exclude?: string[];
  /** Our building type for such a place, passed to the building panel so a school opens as a school. */
  type?: BuildingType;
}

const CATEGORIES = {
  school: { id: "school", label: "sekolah", type: "sekolah", exclude: ["driving_school", "language_school", "music_school"] },
  university: { id: "university", label: "kampus", type: "kampus" },
  hospital: { id: "hospital", label: "rumah sakit", type: "rumah_sakit" },
  government_office: { id: "government", label: "kantor pemerintahan", type: "pemerintahan" },
  office: { id: "office", label: "kantor", type: "kantor" },
  mosque: { id: "mosque", label: "masjid", type: "ibadah" },
  church: { id: "church", label: "gereja", type: "ibadah" },
  place_of_worship: { id: "place_of_worship", label: "tempat ibadah", type: "ibadah" },
  hotel: { id: "hotel", label: "hotel", type: "hotel" },
  shopping_mall: { id: "shopping_mall", label: "mal", type: "mal" },
  // A market hall is a row of shops; "ruko" has the closest electricity use.
  market: { id: "market", label: "pasar", type: "ruko" },
  factory: { id: "factory", label: "pabrik", type: "industri" },
  warehouse: { id: "warehouse", label: "gudang", type: "gudang" },
  // A fuel station has no type of its own; the building panel guesses it from the footprint.
  gas_station: { id: "gas_station", label: "SPBU" },
} satisfies Record<string, Category>;
type CategoryKey = keyof typeof CATEGORIES;
const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
/** Asked from Mapbox in region mode, so enough remain after dropping the places outside the region. */
const SEARCH_SIZE = 25;
const SEARCH_DOWN =
  "Pencarian tempat dari Mapbox sedang tidak bisa dipakai. Sampaikan ke pengguna bahwa tempatnya belum bisa dicari sekarang.";

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function distanceText(m: number): string {
  return m < 1000 ? `${fmtNumber(Math.round(m / 10) * 10)} m dari titik itu` : `${fmtNumber(m / 1000, 1)} km dari titik itu`;
}

export const findPlaces: ServerTool = {
  definition: {
    name: "find_places",
    description:
      "Find places of one kind (schools, hospitals, offices, mosques, hotels, malls and more) in a kabupaten/kota or near a point, from the Mapbox map's place search. Give either region or lng and lat. Returns up to limit places with name, address, lng and lat, numbered from 1 (nearest to the region's centre or the point first). The places found are marked on the map automatically. To show one building, call select_building_at with its lng and lat (the first place unless the user wants another). The list comes from map data and can be incomplete; say so if it matters.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: CATEGORY_KEYS,
          description: "The kind of place. school covers all school levels, university covers campuses.",
        },
        region: REGION_PARAM,
        lng: lngParam("the point to search near"),
        lat: latParam("the point to search near"),
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: `How many places, default ${DEFAULT_LIMIT}.` },
      },
      required: ["category"],
    },
  },
  run: async (deps, i, emit) => {
    const key = typeof i.category === "string" ? i.category.trim().toLowerCase() : "";
    if (!Object.hasOwn(CATEGORIES, key)) {
      return { problem: `category harus salah satu dari: ${CATEGORY_KEYS.join(", ")}.` };
    }
    const category: Category = CATEGORIES[key as CategoryKey];
    const limit = inRange(i.limit, 1, Number.MAX_SAFE_INTEGER) ? Math.min(MAX_LIMIT, Math.floor(i.limit)) : DEFAULT_LIMIT;

    // Where to search: a region (its label point, then only the places inside it) or a point.
    let near: [number, number];
    let regionId: string | null = null;
    let nearText: string;
    if (i.region !== undefined && i.region !== null && i.region !== "") {
      const r = region(i.region);
      if ("problem" in r) return r;
      const at = await deps.db.regionLabelPoint(r.id);
      const summary = await deps.db.regionById(r.id);
      if (!at || !summary) return { problem: `Data wilayah ${r.id} belum ada.` };
      near = at;
      regionId = r.id;
      nearText = summary.name;
    } else if (i.lng !== undefined || i.lat !== undefined) {
      const p = point(i);
      if ("problem" in p) return p;
      const far = kaltimPoint(p.lng, p.lat);
      if (far) return far;
      near = [p.lng, p.lat];
      nearText = `titik lng ${p.lng}, lat ${p.lat}`;
    } else {
      return { problem: "Isi region (nama kabupaten/kota) atau lng dan lat untuk tempat mencari." };
    }

    let hits: PlaceHit[];
    try {
      hits = await deps.places({ category: category.id, near, limit: regionId ? SEARCH_SIZE : limit, exclude: category.exclude });
    } catch (err) {
      console.warn("chat place search failed:", err instanceof Error ? err.message : "unknown error");
      return { problem: SEARCH_DOWN };
    }

    const located = await Promise.all(hits.map(async (h) => ({ hit: h, where: await deps.db.regionAt(h.lng, h.lat) })));
    const kept = (regionId ? located.filter((p) => p.where?.id === regionId) : located).slice(0, limit);
    if (kept.length === 0) return { problem: `Tidak ditemukan ${category.label} di ${nearText} dalam data peta Mapbox.` };

    const places = kept.map(({ hit, where }, n) => ({
      n: n + 1,
      name: hit.name,
      address: hit.address,
      lng: round6(hit.lng),
      lat: round6(hit.lat),
      region: where?.name ?? "Di luar Kalimantan Timur",
      ...(regionId || hit.distanceM === null ? {} : { distanceText: distanceText(hit.distanceM) }),
    }));
    emit({
      name: "mark_places",
      input: {
        label: category.label,
        places: places.map((p) => ({ name: p.name, lng: p.lng, lat: p.lat, ...(category.type ? { type: category.type } : {}) })),
      },
    });
    return {
      result: {
        category: category.label,
        near: nearText,
        places,
        note: `${places.length} tempat sudah ditandai di peta. Sumber: pencarian tempat Mapbox; datanya bisa belum lengkap.`,
      },
    };
  },
};
