# Malas Ngoding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Bun + React web app showing a 3D, animated, clickable energy digital twin of Kalimantan Timur: regions, buildings, grid mix, CO2, solar simulation, weather-aware PV forecast, government recommendations, and an AI chat that drives the map.

**Architecture:** One Bun process (`Bun.serve`) serves `/api/*` JSON/SSE routes and the React SPA through Bun HTML imports. Pure calculation modules live in `src/shared/` and are used by the server and tests. Postgres + PostGIS (Docker, port 5433) stores regions, plants, factors and caches for external APIs (Mapbox Tilequery, NASA POWER, Open-Meteo, Claude).

**Tech Stack:** Bun 1.4, TypeScript, React 19, Mapbox GL JS v3 (style `mapbox://styles/mapbox/standard`), Motion for React (`motion/react`), Recharts, Zustand, Tailwind CSS v4 via `bun-plugin-tailwind`, `@anthropic-ai/sdk`, Postgres 17 + PostGIS 3.5 (`postgis/postgis:17-3.5`), `Bun.sql`.

**Spec:** `docs/specs/malas-ngoding.md` (read it before any task; its decision log is binding).

## Global Constraints

- Bun for everything: `bun install`, `bun test`, `bun run`. No Node-only tooling, no Vite, no Express.
- Before using any Bun, Mapbox GL JS, Motion or Anthropic SDK API, check current docs via Context7 (`/oven-sh/bun`, `/websites/mapbox_mapbox-gl-js`, Motion, Anthropic SDK). For Anthropic code, load the `claude-api` skill first.
- Postgres host port **5433**; never touch the existing container on 5432.
- Env keys: `MAPBOX_TOKEN`, `ANTHROPIC_API_KEY`, `DATABASE_URL` (default `postgres://malas:malas@localhost:5433/malas_ngoding`). Never print or commit `.env`.
- Anthropic model id: `claude-sonnet-5-5`. No rate limit. Max 8 tool-loop iterations per user message, `max_tokens` 2048.
- API routes `/api/...`, no version prefix. JSON errors: `{ "error": string }` with a proper status code.
- UI text in Bahasa Indonesia; code, identifiers and comments in English. Every estimated number shows the label "perkiraan".
- Number format: Indonesian locale (`id-ID`), e.g. `12.345 kWh`, `Rp 23,7 jt`.
- Commits: `type(scope): desc`, lower case, conventional types (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `style`). One commit per task step that says commit. **No `Co-Authored-By` or any AI attribution.** Branch `main` only.
- Values from `docs/research/*.md`; any value without a source is stored with `source: "asumsi"`.

## Review Focus

1. Building with no POI nearby or Tilequery failing: the panel must still render using the footprint fallback type (test in Task 4).
2. External API down or slow (NASA POWER, Open-Meteo, Tilequery, Anthropic): serve cache if present, else a friendly Indonesian message; never a blank panel or unhandled promise (tests in Tasks 4, 5, 8).
3. Click on a building outside Kaltim or in water: response says `region: null` and the panel shows "Di luar Kalimantan Timur", still estimating with the Kaltim grid factor (test in Task 4).
4. Chat names a region by alias or loose spelling ("Kukar", "balikpapan", "Kota Samarinda"): resolves to the right region id (test in Task 8).
5. Extreme footprints (under 10 m2 or over 50,000 m2): clamp area to [10, 50000] m2 and floors to [1, 40], no NaN or absurd numbers (test in Task 3).

---

## File Structure

```
package.json  bunfig.toml  tsconfig.json  docker-compose.yml  Dockerfile  README.md  CLAUDE.md
.claude/rules/{conventions.md,data.md}
db/migrations/001_init.sql
data/seed/{regions.geojson,regions.json,plants.json,grid.json,building-types.json,equivalents.json,solar-costs.json}
scripts/{migrate.ts,seed.ts,warm.ts,setup.ts,build-boundaries.ts}
src/shared/{types.ts,format.ts,estimate.ts,emissions.ts,equivalents.ts,solar.ts,pvForecast.ts,regionAlias.ts}
src/server/{index.ts,env.ts,db.ts,http.ts}
src/server/routes/{config.ts,regions.ts,plants.ts,grid.ts,buildings.ts,solar.ts,weather.ts,recommendations.ts,chat.ts}
src/server/services/{tilequery.ts,nasaPower.ts,openMeteo.ts,claude.ts,chatTools.ts,cache.ts}
src/web/{index.html,main.tsx,App.tsx,styles.css,api.ts,store.ts}
src/web/map/{MapView.tsx,regionsLayer.ts,plantsLayer.ts,buildings.ts,effects.ts,actions.ts,camera.ts}
src/web/panels/{RegionPanel.tsx,BuildingPanel.tsx,EnergyTab.tsx,EmissionTab.tsx,SolarTab.tsx,WeatherTab.tsx,RecommendationPanel.tsx,MethodologyPanel.tsx,Legend.tsx}
src/web/chat/{ChatPanel.tsx,useChat.ts}
src/web/components/{AnimatedNumber.tsx,Badge.tsx,Intro.tsx}
tests/shared/*.test.ts  tests/server/*.test.ts
docs/technical/{architecture.md,erd.md,flows.md,demo-script.md}
```

## Shared types (`src/shared/types.ts`, created in Task 3, used everywhere)

```ts
export type BuildingType = "rumah" | "ruko" | "kantor" | "pemerintahan" | "sekolah" | "kampus" | "rumah_sakit" | "hotel" | "mal" | "ibadah" | "gudang" | "industri";
export type FuelType = "batubara" | "gas" | "diesel" | "surya" | "air" | "biomassa" | "lainnya";
export interface GridMix { year: number; factorKgPerKwh: number; shares: Record<FuelType, number>; fuelFactors: Record<FuelType, number>; source: string }
export interface BuildingInput { featureId: string; lng: number; lat: number; footprintM2: number; heightM: number | null; poiClass?: string | null; poiType?: string | null; typeOverride?: BuildingType; floorsOverride?: number }
export interface BuildingEstimate { featureId: string; type: BuildingType; typeSource: "poi" | "footprint" | "user"; floors: number; floorAreaM2: number; kwhYear: number; kwhMonth: number; co2KgYear: number; bySource: { fuel: FuelType; kwh: number; co2Kg: number }[]; equivalents: Equivalent[]; region: { id: string; name: string } | null; assumptions: string[] }
export interface Equivalent { key: "mobil_km" | "motor_km" | "pohon" | "charge_hp" | "penerbangan"; label: string; value: number; unit: string }
export interface SolarInput { roofAreaM2: number; kwhYear: number; peakSunHours: number; backupHours: number; tariffRpPerKwh: number; costRpPerKwp: number; gridFactorKgPerKwh: number }
export interface SolarResult { kWp: number; panels: number; kwhYear: number; coveragePct: number; batteryKwh: number; costRp: number; savingRpYear: number; paybackYears: number; co2AvoidedKgYear: number }
export interface PvHour { time: string; ghiWm2: number; cloudPct: number; precipMm: number; weatherCode: number; pvKwh: number }
export interface RegionSummary { id: string; name: string; kind: "kabupaten" | "kota"; kwhYear: number; co2KgYear: number; population: number | null; customers: number | null; electrificationPct: number | null; villagesNoPln: number | null; estimated: boolean }
```

---

### Task 1: Scaffold, server shell, Docker database

**Files:**
- Create: `package.json`, `bunfig.toml`, `tsconfig.json`, `docker-compose.yml`, `src/server/{index.ts,env.ts,http.ts}`, `src/web/{index.html,main.tsx,App.tsx,styles.css}`, `CLAUDE.md`, `.claude/rules/conventions.md`, `README.md` (skeleton)
- Test: `tests/server/health.test.ts`

**Interfaces:**
- Produces: `createServer(opts: { port: number; deps: AppDeps }): Server` in `src/server/index.ts` (start only when `import.meta.main`); `AppDeps` interface (grows in later tasks, start with `{}`); `json(data, status = 200): Response` and `error(message: string, status: number): Response` in `http.ts`; `env` object in `env.ts` with `mapboxToken`, `anthropicApiKey`, `databaseUrl`, `port` (default 3000).
- Scripts in package.json: `dev` (`bun --hot src/server/index.ts`), `start`, `test`, `migrate`, `seed`, `warm`, `setup`, `typecheck` (`tsc --noEmit`).

- [ ] **Step 1: Failing test** `GET /api/health` returns 200 `{ ok: true, name: "Malas Ngoding" }`; `GET /` returns HTML containing `<div id="root">`; unknown `/api/x` returns 404 `{ error }`. Start the server on port 0 in the test.
- [ ] **Step 2: Run** `bun test tests/server/health.test.ts`, expect FAIL.
- [ ] **Step 3: Implement** server with `Bun.serve({ routes: { "/api/health": ..., "/*": indexHtml }, development: { hmr: true, console: true } })`, Tailwind plugin in `bunfig.toml` under `[serve.static] plugins = ["bun-plugin-tailwind"]`. App renders a dark full-screen placeholder "Malas Ngoding".
- [ ] **Step 4: docker-compose** service `db` image `postgis/postgis:17-3.5`, port `5433:5432`, user/password/db `malas`/`malas`/`malas_ngoding`, named volume `malas_ngoding_pg`, healthcheck `pg_isready`. Run `docker compose up -d` and wait until healthy.
- [ ] **Step 5: Run** `bun test` and `bun run typecheck`, expect PASS.
- [ ] **Step 6: CLAUDE.md** (short: commands, pointer to rules and spec) and `.claude/rules/conventions.md` (commit format, language rules, port 5433, no attribution).
- [ ] **Step 7: Commit** `chore(repo): scaffold bun server, react shell and postgis compose`.

### Task 2: Schema, seed data, region lookup

**Files:**
- Create: `db/migrations/001_init.sql`, `src/server/db.ts`, `scripts/{migrate.ts,build-boundaries.ts,seed.ts}`, `data/seed/*.json`, `data/seed/regions.geojson`, `.claude/rules/data.md`
- Test: `tests/server/db.test.ts` (skips with a clear message if DB is unreachable)

**Interfaces:**
- Produces in `db.ts`: `sql` (a `Bun.sql` instance from `env.databaseUrl`); `regionAt(lng: number, lat: number): Promise<{ id: string; name: string } | null>`; `listRegions(): Promise<RegionSummary[]>`; `regionGeoJSON(): Promise<FeatureCollection>` (properties = RegionSummary fields); `getGridMix(): Promise<GridMix>`; `listPlants(): Promise<FeatureCollection>` (properties: `name, fuel, capacityMw, status, approx, source`); `getBuildingTypes(): Promise<Record<BuildingType, { intensityKwhM2Year: number; typicalFloors: number; source: string }>>`.
- Tables: `regions(id text pk, name, kind, geom geometry(MultiPolygon,4326), centroid geometry(Point,4326), kwh_year, population, customers, electrification_pct, villages_no_pln, estimated bool, source)`, `power_plants(id serial, name, fuel, capacity_mw, status, geom Point, approx bool, source)`, `grid_mix(year, fuel, share, fuel_factor, grid_factor, source)`, `building_types(type pk, intensity_kwh_m2_year, typical_floors, source)`, `equivalents(key pk, label, kg_co2_per_unit, unit, source)`, `building_estimates(feature_id pk, input jsonb, result jsonb, created_at)`, `poi_cache(key pk, payload jsonb, fetched_at)`, `solar_climatology(key pk, lat, lng, psh_by_month jsonb, psh_year, fetched_at)`, `weather_cache(key pk, payload jsonb, fetched_at)`, `recommendations(region_id pk, content jsonb, model, generated_at)`, `chat_sessions(id uuid pk, created_at)`, `chat_messages(id serial, session_id fk, role, content jsonb, created_at)`, `schema_migrations(name pk)`. GIST indexes on geometry columns.

- [ ] **Step 1: Seed data.** Build `data/seed/*.json` from `docs/research/*.md` JSON blocks: 10 regions (ids: `paser, kutai-barat, kutai-kartanegara, kutai-timur, berau, penajam-paser-utara, mahakam-ulu, balikpapan, samarinda, bontang`), plants (≥10), grid mix + fuel factors, building types (all 12 `BuildingType` values; missing ones as `asumsi`), equivalents, solar costs/tariff. Every record has `source`.
- [ ] **Step 2: Boundaries.** `scripts/build-boundaries.ts` downloads the ADM2 GeoJSON named in `docs/research/solar-weather-boundaries.md`, keeps the 10 Kaltim regions (match by name, mapping table in the script), simplifies to keep the file under 2 MB (use PostGIS `ST_SimplifyPreserveTopology` during seed or a tolerance in the script), writes `data/seed/regions.geojson`. Commit the output so setup works offline.
- [ ] **Step 3: Failing tests:** after migrate+seed, `listRegions()` has length 10; `regionAt(117.1466, -0.4998)` → `{ id: "samarinda" }`; `regionAt(116.8312, -1.2717)` → `balikpapan`; `regionAt(106.8, -6.2)` (Jakarta) → `null`; `getGridMix()` shares sum to 1 ± 0.01; `listPlants().features.length >= 10`.
- [ ] **Step 4: Implement** migrate (applies `db/migrations/*.sql` once each, tracked in `schema_migrations`), seed (idempotent upserts), and the `db.ts` functions. `kwh_year` for regions from research; `co2KgYear = kwhYear × grid factor` computed in SQL view or in `listRegions`.
- [ ] **Step 5: Run** `bun run migrate && bun run seed && bun test tests/server/db.test.ts`, expect PASS.
- [ ] **Step 6: Commit** `feat(db): add postgis schema, kaltim seed data and region lookup`.

### Task 3: Shared calculation modules

**Files:**
- Create: `src/shared/{types.ts,format.ts,estimate.ts,emissions.ts,equivalents.ts,solar.ts,pvForecast.ts,regionAlias.ts}`
- Test: `tests/shared/{estimate,emissions,equivalents,solar,pvForecast,regionAlias,format}.test.ts`

**Interfaces (all pure, no I/O):**
- `inferType(poiClass: string | null | undefined, poiType: string | null | undefined, footprintM2: number): { type: BuildingType; source: "poi" | "footprint" }` — map: `education/School→sekolah`, `education/College|University→kampus`, `medical/Hospital|Clinic→rumah_sakit`, `lodging/*→hotel`, `store_like/Mall|Department Store→mal`, `store_like/*|food_and_drink/*|commercial_services/*→ruko`, `general/Government→pemerintahan`, `religion/*→ibadah`, `industrial/*→industri`, `general/Office|commercial_services/Office→kantor`; else footprint `< 250 → rumah`, `< 2000 → ruko`, else `gudang`.
- `estimateFloors(type, heightM: number | null, typicalFloors: number, floorHeightM = 3.5): number` — if `heightM` is null or ≤ 3 use `typicalFloors`, else `round(heightM / floorHeightM)`; clamp [1, 40].
- `estimateBuilding(input: BuildingInput, ctx: { types: Record<BuildingType,{intensityKwhM2Year:number;typicalFloors:number}>; grid: GridMix; equivalents: EquivalentFactor[]; region: {id:string;name:string}|null }): BuildingEstimate` — clamp footprint to [10, 50000]; overrides win and set `typeSource: "user"`; `assumptions` lists Indonesian sentences for each fallback used.
- `co2BySource(kwh: number, grid: GridMix): { fuel: FuelType; kwh: number; co2Kg: number }[]` — `kwh × share × fuelFactor`, then scale so the sum equals `kwh × grid.factorKgPerKwh`; drop zero shares; sort by co2 desc.
- `toEquivalents(co2Kg: number, factors: EquivalentFactor[]): Equivalent[]` with `EquivalentFactor = { key; label; kgCo2PerUnit; unit }`.
- `simulateSolar(input: SolarInput): SolarResult` — `usableRoof = roofAreaM2 × 0.6`; `maxKwp = usableRoof / 5.5` (≈5.5 m2 per kWp); `neededKwp = kwhYear / (peakSunHours × 365 × 0.78)`; `kWp = min(maxKwp, neededKwp)` rounded up to 0.5; `panels = ceil(kWp / 0.55)`; `kwhYear(pv) = kWp × psh × 365 × 0.78`; `batteryKwh = (kwhYear/365/24) × backupHours / 0.9`; `costRp = kWp × costRpPerKwp + batteryKwh × batteryRpPerKwh` (battery price from `solar-costs.json`, pass in via `costRpPerKwp`'s sibling field `batteryRpPerKwh` — add it to `SolarInput`); `savingRpYear = min(pvKwh, kwhYear) × tariff`; `paybackYears = costRp / savingRpYear`; `co2AvoidedKgYear = min(pvKwh, kwhYear) × gridFactor`. Return 0s (not NaN/Infinity) when inputs are 0.
- `pvFromForecast(hours: { time: string; ghiWm2: number; cloudPct: number; precipMm: number; weatherCode: number }[], kWp: number, pr = 0.78): PvHour[]` — `pvKwh = kWp × (ghiWm2 / 1000) × pr` per hour. `summariseDays(hours: PvHour[]): { date: string; pvKwh: number; rainy: boolean; maxPrecipMm: number }[]` (rainy if any hour `precipMm ≥ 0.5` or weather code in 51–67, 80–82, 95–99).
- `resolveRegion(text: string): string | null` — normalise (lower case, strip "kabupaten", "kab.", "kota", punctuation) and match names plus aliases `kukar→kutai-kartanegara`, `kubar→kutai-barat`, `kutim→kutai-timur`, `ppu→penajam-paser-utara`, `mahulu→mahakam-ulu`, `bpp→balikpapan`, `smd→samarinda`.
- `format.ts`: `fmtNumber(n, digits = 0)`, `fmtKwh(n)`, `fmtKg(n)` (switch to ton ≥ 1000), `fmtRupiah(n)` (`Rp 23,7 jt`, `Rp 1,2 M`), all `id-ID`.

- [ ] **Step 1: Failing tests** with exact cases: `inferType("education","School",400)` → `sekolah/poi`; `inferType(null,null,120)` → `rumah/footprint`; `inferType(null,null,1200)` → `ruko`; `inferType(null,null,8000)` → `gudang`; `estimateFloors("hotel",3,6)` → 6; `estimateFloors("kantor",35,4)` → 10; footprint 2 m2 clamps to 10; footprint 900000 clamps to 50000; `co2BySource` sum equals `kwh × factor` within 1e-6; `simulateSolar` with zero roof returns all zeros and finite payback 0; a 100 m2 roof, 3600 kWh/yr, psh 4.5 → kWp 2.5 (needed 2.81 kWh… compute and pin the exact numbers in the test from the formula); `pvFromForecast` with ghi 800, kWp 2 → 1.248 kWh; `resolveRegion("Kab. Kukar")` → `kutai-kartanegara`, `resolveRegion("Kota Samarinda")` → `samarinda`, `resolveRegion("jakarta")` → null; `fmtRupiah(23_700_000)` → `"Rp 23,7 jt"`.
- [ ] **Step 2: Run** `bun test tests/shared`, expect FAIL.
- [ ] **Step 3: Implement** the modules.
- [ ] **Step 4: Run** `bun test tests/shared`, expect PASS; `bun run typecheck` clean.
- [ ] **Step 5: Commit** `feat(shared): add estimate, emission, solar and forecast calculations`.

### Task 4: Data APIs and building estimate

**Files:**
- Create: `src/server/routes/{config,regions,plants,grid,buildings}.ts`, `src/server/services/{tilequery.ts,cache.ts}`
- Modify: `src/server/index.ts` (register routes, extend `AppDeps`)
- Test: `tests/server/{regions,buildings}.test.ts`

**Interfaces:**
- `AppDeps` gains `db: { regionAt; listRegions; regionGeoJSON; getGridMix; listPlants; getBuildingTypes; getEquivalents; cacheGet(table, key); cacheSet(table, key, payload) }` and `poi: (lng, lat) => Promise<{ class: string; type: string; name: string | null; distanceM: number } | null>`. Tests pass fakes.
- `GET /api/config` → `{ mapboxToken }`.
- `GET /api/regions` → region FeatureCollection; `GET /api/regions/:id` → `RegionSummary` + `{ centroid: [lng, lat] }` or 404.
- `GET /api/plants` → FeatureCollection. `GET /api/grid` → `GridMix`.
- `POST /api/buildings/estimate` body `BuildingInput` → `BuildingEstimate`. Flow: validate (numbers finite, lng/lat in range) else 400; cache hit by `featureId` + overrides; else `poi(lng, lat)` (nearest POI within 25 m via Tilequery `mapbox.mapbox-streets-v8`, layer `poi_label`, cached in `poi_cache` by rounded coords; on fetch error return null), `regionAt`, `estimateBuilding`, store in `building_estimates`.

- [ ] **Step 1: Failing tests:** regions list returns 10 features with `kwhYear > 0`; `/api/regions/nope` → 404 `{error}`; estimate with a fake POI `education/School` → `type: "sekolah"`, `typeSource: "poi"`; estimate when `poi` throws → 200 with `typeSource: "footprint"` (Review Focus 1); estimate with Jakarta coords → `region: null` and an assumption mentioning "di luar Kalimantan Timur" (Review Focus 3); invalid body (`lng: "x"`) → 400; second identical call hits cache (fake `poi` called once).
- [ ] **Step 2: Run** and see FAIL. **Step 3: Implement.** **Step 4: Run** `bun test`, PASS.
- [ ] **Step 5: Commit** `feat(api): add region, plant, grid and building estimate endpoints`.

### Task 5: Solar and weather APIs

**Files:**
- Create: `src/server/routes/{solar,weather}.ts`, `src/server/services/{nasaPower,openMeteo}.ts`
- Test: `tests/server/{solar,weather}.test.ts`

**Interfaces:**
- `AppDeps` gains `nasa: (lat, lng) => Promise<{ pshByMonth: number[]; pshYear: number }>` (NASA POWER climatology `ALLSKY_SFC_SW_DWN`, kWh/m2/day = PSH; cache in `solar_climatology` by lat/lng rounded to 0.1) and `meteo: (lat, lng) => Promise<ForecastHour[]>` (Open-Meteo hourly `shortwave_radiation,cloud_cover,precipitation,weather_code`, `forecast_days=7`, `timezone=Asia/Makassar`; cache 1 hour in `weather_cache` by coords rounded to 0.05).
- `POST /api/solar/simulate` body `{ lat, lng, roofAreaM2, kwhYear, backupHours }` → `SolarResult & { peakSunHours, pshByMonth }`. Uses tariff, costs and grid factor from seed.
- `GET /api/weather?lat&lng&kWp` → `{ hours: PvHour[]; days: ReturnType<typeof summariseDays>; current: { raining: boolean; cloudPct: number; precipMm: number; isDay: boolean }; stale: boolean }`.
- Failure policy (Review Focus 2): if the upstream fails and a cache row exists (any age) return it with `stale: true`; if no cache, NASA falls back to a seed PSH of 4.2 with an assumption note, weather returns 503 `{ error: "Prakiraan cuaca sedang tidak tersedia" }`.

- [ ] **Step 1: Failing tests** with fakes: simulate returns finite numbers and `peakSunHours` from fake NASA; NASA throwing → uses 4.2 and includes the note; weather with fake hours marks rainy days; weather upstream throwing with stale cache → `stale: true`; without cache → 503.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(api): add solar simulation and weather-aware pv forecast`.

### Task 6: Map core, regions, plants, intro and ambience

**Files:**
- Create: `src/web/{api.ts,store.ts}`, `src/web/map/{MapView.tsx,regionsLayer.ts,plantsLayer.ts,effects.ts,camera.ts}`, `src/web/panels/{RegionPanel.tsx,Legend.tsx}`, `src/web/components/{AnimatedNumber.tsx,Intro.tsx,Badge.tsx}`
- Modify: `src/web/App.tsx`, `src/web/styles.css`

**Interfaces:**
- `store.ts` (Zustand): `{ map: mapboxgl.Map | null; selectedRegionId: string | null; selectedBuilding: BuildingEstimate | null; metric: "co2" | "kwh"; layers: { regions: boolean; plants: boolean; buildings: boolean }; rain: "auto" | "on" | "off"; panelTab: "energi" | "emisi" | "surya" | "cuaca"; chatOpen: boolean }` plus setters.
- `api.ts`: typed fetch helpers for every endpoint in Tasks 4–5, 7, 8.
- `camera.ts`: `flyToRegion(map, centroid, opts?)`, `introFlight(map): Promise<void>` (globe at zoom 2 → Kaltim zoom ~6.3, pitch 55, ~6 s, user can skip), `startIdleOrbit(map)` / `stopIdleOrbit()` (slow bearing rotation after 20 s idle, stops on interaction).
- `regionsLayer.ts`: `addRegions(map, fc, metric)`, `setRegionMetric(map, metric)` — `fill-extrusion` with height scaled from the metric and animated by transitioning `fill-extrusion-height` from 0 on load; colour ramp by intensity; hover via feature-state; click selects region.
- `plantsLayer.ts`: `addPlants(map, fc)` — circles or extruded hexagon footprints coloured by fuel (batubara dark grey/red, gas orange, diesel brown, surya yellow, air blue, biomassa green), sized by MW, pulse animation, popup with name/fuel/MW.
- `effects.ts`: `applyLightPreset(map, date)` (`dawn` 05–07, `day` 07–17, `dusk` 17–19, `night` otherwise, WITA), `setRainEffect(map, on: boolean)` via `map.setRain` with the zoom-based reveal from the Mapbox example.

- [ ] **Step 1:** Load the `frontend-design:frontend-design` skill and pick a visual direction (dark-first, energetic accent, Plus Jakarta Sans or similar via CSS, glass panels). Record the choice in the spec decision log.
- [ ] **Step 2:** Implement the map (`mapbox://styles/mapbox/standard`, terrain via `mapbox-dem`, globe projection), intro, regions, plants, legend, region panel (stats with `AnimatedNumber`, metric switch co2/kWh, "perkiraan" badges), light preset, idle orbit. Token from `/api/config`.
- [ ] **Step 3: Browser check** (`bun dev`, open `http://localhost:3000` with the claude-in-chrome tools or Playwright): intro plays, 10 regions rise, hover and click work, plants show, no console errors. Save a screenshot to `docs/technical/screens/map.png`.
- [ ] **Step 4: Commit** `feat(map): add 3d kaltim map with animated regions, plants and intro`.

### Task 7: Building selection and building panel

**Files:**
- Create: `src/web/map/buildings.ts`, `src/web/panels/{BuildingPanel.tsx,EnergyTab.tsx,EmissionTab.tsx}`
- Modify: `src/web/App.tsx`, `src/web/store.ts`

**Interfaces:**
- `buildings.ts`: `enableBuildingInteraction(map, onSelect: (input: BuildingInput) => void)` using `map.addInteraction` on featureset `{ featuresetId: "buildings", importId: "basemap" }` for hover (`highlight`) and click (`select`), basemap config `colorBuildingHighlight`, `colorBuildingSelect`, `show3dLandmarks: false`. Build `BuildingInput` from the clicked feature: `featureId` (feature id or rounded centroid key), centroid, footprint area (geodesic polygon area; implement a small spherical area helper in `src/shared/estimate.ts` as `polygonAreaM2(coords: number[][][]): number` with a unit test), `heightM` from properties.
- `selectBuildingAt(map, lng, lat): Promise<boolean>` (used by chat): fly to the point at zoom 17.5, wait for idle, `queryRenderedFeatures` on the buildings featureset at the projected point, select it, call `onSelect`; returns false if none.
- BuildingPanel: slides in from the right (Motion), header with type badge (editable select) and floors stepper (override triggers re-estimate), tabs Energi / Emisi / Surya / Cuaca. Energi: kWh/yr, kWh/month, floor area, region, assumptions list. Emisi: total CO2, donut of `bySource`, equivalents as animated cards with icons.

- [ ] **Step 1: Unit test** `polygonAreaM2` on a 0.001° square near the equator ≈ 12,364 m2 ± 1%.
- [ ] **Step 2: Implement** and make the unit test pass.
- [ ] **Step 3: Browser check:** zoom into Samarinda, click 3 different buildings (a school, a mall, a house), panel shows sensible type and numbers, override type recomputes, no console errors. Screenshot `docs/technical/screens/building.png`.
- [ ] **Step 4: Commit** `feat(buildings): add clickable buildings with energy and emission panel`.

### Task 8: AI chat that drives the map

**Files:**
- Create: `src/server/services/{claude.ts,chatTools.ts}`, `src/server/routes/chat.ts`, `src/web/chat/{ChatPanel.tsx,useChat.ts}`, `src/web/map/actions.ts`
- Test: `tests/server/chat.test.ts`

**Interfaces:**
- Load the `claude-api` skill before writing this task.
- `POST /api/chat` body `{ sessionId: string; message: string; context: { selectedRegionId: string | null; selectedBuilding: BuildingEstimate | null; view: { center: [number, number]; zoom: number } } }` → `text/event-stream` with events `text` (`{ delta }`), `action` (`{ name, input }`), `done`, `error` (`{ message }`).
- Server tools (executed on server, results fed back to Claude): `get_region_stats({ region })` (uses `resolveRegion`), `list_regions()`, `get_grid_mix()`, `estimate_building_at({ lng, lat })` (POI lookup + estimate with a default 150 m2 footprint flagged as assumption), `simulate_solar({ lat, lng, roofAreaM2, kwhYear, backupHours })`, `get_weather({ lat, lng })`, `get_recommendations({ region })`.
- Client action tools (server emits an `action` event and returns `{ ok: true }` to Claude immediately): `fly_to_region({ region })`, `fly_to({ lng, lat, zoom })`, `select_building_at({ lng, lat })`, `toggle_layer({ layer: "regions"|"plants"|"buildings", visible })`, `set_metric({ metric })`, `set_rain({ mode: "auto"|"on"|"off" })`, `open_tab({ tab })`.
- System prompt (Indonesian): role as the Malas Ngoding energy assistant for Kaltim; explain for laypeople; numbers only from tools; say "perkiraan" for estimates; use map actions to show what it talks about; short answers.
- Persist each user and assistant message in `chat_messages`; load the last 20 messages of the session as history.
- `actions.ts`: `runAction(action, map, store)` executing the client tools.
- ChatPanel: floating button bottom-right, panel with streaming text (markdown), suggested prompts ("Wilayah mana emisinya paling tinggi?", "Tunjukkan gedung sekolah di Samarinda", "Kalau gedung ini pakai panel surya?", "Besok hujan? Berapa listrik suryanya?"), shows action chips when the AI moves the map.

- [ ] **Step 1: Failing tests** with a fake Anthropic client: a tool_use `fly_to_region({region:"Kukar"})` emits `action` with `{ region: "kutai-kartanegara" }` (Review Focus 4); a tool loop stops after 8 iterations with an `error`-free `done`; Anthropic throwing → `error` event with an Indonesian message (Review Focus 2); messages are persisted.
- [ ] **Step 2–4:** FAIL, implement (streaming via `client.messages.stream` with tools, manual tool loop), PASS.
- [ ] **Step 5: Browser check:** ask the four suggested prompts; the map moves and selects; answers stream. Screenshot `docs/technical/screens/chat.png`.
- [ ] **Step 6: Commit** `feat(chat): add claude chat that answers with data and drives the map`.

### Task 9: Solar and weather tabs, live rain

**Files:**
- Create: `src/web/panels/{SolarTab.tsx,WeatherTab.tsx}`
- Modify: `src/web/map/effects.ts`, `src/web/App.tsx`

**Interfaces:**
- SolarTab: inputs roof area (prefilled = footprint), backup hours slider (0–12, default 4); calls `/api/solar/simulate`; shows kWp, panels, production vs demand bar, coverage ring, battery kWh, cost, payback, CO2 avoided, monthly PSH chart; animated transitions on change.
- WeatherTab: calls `/api/weather` with the simulated kWp (default 1 kWp); hourly PV area chart for 72 h with rain hours shaded, daily cards with rain icons and "produksi turun X% karena hujan" vs the clear-sky best day.
- Rain `auto`: every 10 minutes and after big camera moves, fetch weather for the view centre; `setRainEffect(map, current.raining)`. Manual toggle in the legend.

- [ ] **Step 1:** Implement both tabs and auto rain.
- [ ] **Step 2: Browser check:** solar numbers change smoothly with the slider; weather chart renders; forcing rain on shows the effect. Screenshot `docs/technical/screens/solar.png`.
- [ ] **Step 3: Commit** `feat(solar): add solar simulation and weather forecast tabs with live rain`.

### Task 10: Government recommendations and methodology

**Files:**
- Create: `src/server/routes/recommendations.ts`, `src/web/panels/{RecommendationPanel.tsx,MethodologyPanel.tsx}`, `scripts/warm.ts`
- Test: `tests/server/recommendations.test.ts`

**Interfaces:**
- `GET /api/recommendations/:regionId` → `{ regionId, items: { title: string; category: "energi_terbarukan" | "efisiensi" | "tata_ruang" | "akses_listrik" | "kebijakan"; body: string; impact: string; priority: 1|2|3 }[]; model: string | null; generatedAt: string }` from cache; if missing, generate with Claude (JSON output via a tool or structured prompt, Indonesian, grounded in the region's stats, plants within the region via `ST_Contains`, PSH, villages without power) and store; on Claude failure return rule-based items (e.g. high `villagesNoPln` → PLTS komunal; high coal share → PLTS atap gedung pemerintah; high kWh per capita → efisiensi) with `model: null`.
- `POST /api/recommendations/:regionId/refresh` regenerates.
- `scripts/warm.ts`: for all regions, warm NASA climatology at the centroid and recommendations (skip AI part if no key).
- RecommendationPanel inside RegionPanel ("Rekomendasi untuk Pemerintah"), cards by category with priority. MethodologyPanel: formulas, factors table with sources from `/api/grid` and building types, "asumsi" rows highlighted.

- [ ] **Step 1: Failing tests:** cached content returned without calling Claude; Claude failure → rule-based items with `model: null`; unknown region → 404.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(recommendations): add ai government recommendations and methodology panel`.

### Task 11: Setup, docs, final check, push

**Files:**
- Create: `scripts/setup.ts`, `Dockerfile`, `docs/technical/{architecture.md,erd.md,flows.md,demo-script.md}`
- Modify: `README.md`, `docs/specs/malas-ngoding.md` (decision log)

- [ ] **Step 1:** `bun run setup` = migrate → seed → warm. README (Bahasa Indonesia): what it is, requirements (Bun, Docker), `.env` from `.env.example`, `docker compose up -d`, `bun install`, `bun run setup`, `bun dev`, tests, data sources, team placeholders.
- [ ] **Step 2:** Technical docs (Bahasa Indonesia): architecture diagram (Mermaid), ERD (Mermaid `erDiagram` from the migration), flowcharts (building click, solar simulation, chat tool loop), app workflow, demo script (5-minute path for the live demo with fallbacks).
- [ ] **Step 3:** Dockerfile (`oven/bun`, `bun install --production`, `bun run start`). Do not deploy.
- [ ] **Step 4: Full check:** fresh `docker compose down -v && docker compose up -d && bun run setup`, `bun test` all PASS, `bun run typecheck` clean, browser run of the demo script with no console errors.
- [ ] **Step 5: Commit** `docs(repo): add setup script, technical docs and demo script`.
- [ ] **Step 6: Push:** `gh repo create akhmadqasim/malas-ngoding --private --source . --push` (repo private; decision log notes it must be made public before 25 Oct). No PR.
