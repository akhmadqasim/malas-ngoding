/**
 * Browser smoke check of the running app. Start `bun dev` first, then run `bun run smoke`.
 *
 * It opens the app in Chromium, lets the intro play (basemap names on the globe), checks the regions,
 * plants, layout, the region names across the whole idle sway (CO2 and kWh), the sway keeping its arc
 * after a gesture near north, the basemap names after the intro, the hover preview, click,
 * metric switch, picking from the list and coming back (mouse and keyboard, focus back on the row), the
 * plant and cluster tooltips, the map tools (keyboard, tooltips, north, back to the province), the Mapbox
 * wordmark and attribution, the rain reveal and overcast
 * tint at building zoom, the Cahaya light switch and the "Coba lagi" failure path, and exits non-zero on
 * any failed check, console error or console warning (known Mapbox warnings are listed, not counted).
 *
 * Options (env):
 * - BASE_URL (default http://localhost:3000)
 * - SMOKE_VIEWPORT=1366x768 (default 1600x900)
 * - SMOKE_SCREENSHOT=1 overwrites docs/technical/screens/map.png and rain.png (the committed shots)
 * - SMOKE_SHOTS=<dir> also saves every intermediate screenshot there
 * - SMOKE_HEADED=1 to watch it, SMOKE_GL=swiftshader for software WebGL, CHROMIUM_PATH to pick a browser
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ConsoleMessage, Page } from "playwright";
import { launchBrowser } from "./chromium.ts";
import { KALTIM_VIEW, SWAY_DEG } from "../src/web/map/camera.ts";
import { pvFromForecast, summariseDays } from "../src/shared/pvForecast.ts";
import { basemapLight, lightPresetFor } from "../src/web/map/effects.ts";
import { GLOBE_LABEL_ZOOM, LANDED_LABEL_ZOOM } from "../src/web/map/regionLabels.ts";
import { FLATTEN } from "../src/web/map/columns.ts";

const BASE_URL = Bun.env.BASE_URL ?? "http://localhost:3000";
const SCREENS = "docs/technical/screens";
const SAVE_SCREENS = Bun.env.SMOKE_SCREENSHOT === "1";
const SHOTS = Bun.env.SMOKE_SHOTS;
const [VIEW_W, VIEW_H] = (Bun.env.SMOKE_VIEWPORT ?? "1600x900").split("x").map(Number) as [number, number];

/**
 * Console warnings that come from Mapbox GL JS 3.33 itself, not from our code. They are listed (not
 * hidden): the run prints every one it ignored.
 * - Its worker logs the first one once when the Standard basemap's own fence and hedge layer is drawn
 *   (zoom 16 and closer). Mapbox joins the layer id and its import scope with an invisible separator
 *   (U+001F), hence the [^ ]*.
 * - Its tile cache logs the second one when a tile download is cut off by a camera jump while the
 *   response is being stored. It happens now and then; we do not use the Cache API ourselves.
 */
const KNOWN_UPSTREAM_WARNINGS = [
  /^line-progress evaluation for gate-fence-hedge[^ ]*basemap requires enabling 'lineMetrics'/,
  /^Failed to execute 'put' on 'Cache': Cache\.put\(\) encountered a network error$/,
];
const ignoredWarnings: string[] = [];

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function screen(page: Page, file: string) {
  if (!SAVE_SCREENS) return;
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: join(SCREENS, file) });
  console.log(`saved ${SCREENS}/${file}`);
}

type MapWindow = Window & { __malasMap?: import("mapbox-gl").Map };

/**
 * Hover and recede states of two regions, the basemap light and labels, the rain colour, whether the rain
 * haze is in the map's fog, the overcast tint, and which region labels are drawn.
 */
const mapState = (page: Page) =>
  page.evaluate(() => {
    const map = (window as MapWindow).__malasMap!;
    const fs = (id: string) => map.getFeatureState({ source: "regions", id }) ?? {};
    const haze = getComputedStyle(document.documentElement).getPropertyValue("--color-rain-haze").trim();
    const labels = map.getLayer("region-labels") ? map.queryRenderedFeatures({ layers: ["region-labels"] }) : [];
    return {
      paser: fs("paser"),
      samarinda: fs("samarinda"),
      preset: map.getConfigProperty("basemap", "lightPreset") as string,
      theme: map.getConfigProperty("basemap", "theme") as string,
      placeLabels: map.getConfigProperty("basemap", "showPlaceLabels") as boolean,
      rainColor: map.getRain()?.color as string | undefined,
      haze: Boolean(haze) && JSON.stringify(map.getFog() ?? {}).includes(haze),
      overcast: Number(getComputedStyle(document.querySelector(".overcast")!).opacity),
      regionLabels: new Set(labels.map((f) => (f as unknown as { properties?: { id?: string } }).properties?.id)).size,
    };
  });

/**
 * Resolves once the map has no pending tiles or camera moves, or after `capMs`. The cap matters at
 * building zoom, where tiles stream in for a long time in headless Chromium.
 */
const waitForMapIdle = (page: Page, capMs = 30_000) =>
  page.evaluate(
    (cap) =>
      new Promise<void>((resolve) => {
        const map = (window as unknown as { __malasMap?: import("mapbox-gl").Map }).__malasMap;
        if (!map) return resolve();
        if (map.loaded() && !map.isMoving()) return resolve();
        setTimeout(resolve, cap);
        map.once("idle", () => resolve());
      }),
    capMs,
  );

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
const intersects = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

/**
 * The screen box of every symbol Mapbox placed (its collision index: the very boxes it keeps apart), with
 * the region each one names, and the boxes of the panels. These are Mapbox internals, so a version
 * that moves them fails the check loudly instead of passing it silently.
 */
/** The cards of the bottom dock (legend, map controls): checked for layout, and no region name may hide under one. */
const DOCK_CARDS = [".legend", ".controls"];
/** Every panel over the map, the map tools included: no region name may hide under one. */
const PANELS = [".sheet", ...DOCK_CARDS, ".map-tools"];

const labelLayout = (page: Page) =>
  page.evaluate((panels) => {
    const map = (window as MapWindow).__malasMap!;
    type Grid = { boxKeys: unknown[]; bboxes: ArrayLike<number> };
    const internals = map as unknown as { style?: { placement?: { collisionIndex?: { grid?: Grid } } } };
    const grid = internals.style?.placement?.collisionIndex?.grid;
    if (!grid) return null;
    // The grid reaches 100 px past each edge of the viewport (CollisionIndex viewportPadding).
    const PAD = 100;
    const boxes = Array.from({ length: grid.boxKeys.length }, (_, i) => {
      const [x1, y1, x2, y2] = [0, 1, 2, 3].map((k) => grid.bboxes[4 * i + k]! - PAD) as [number, number, number, number];
      const named = map.queryRenderedFeatures([(x1 + x2) / 2, (y1 + y2) / 2], { layers: ["region-labels"] });
      const ids = [...new Set(named.map((f) => (f as unknown as { properties?: { id?: string } }).properties?.id))];
      return { x1, y1, x2, y2, id: ids.length === 1 ? (ids[0] ?? null) : null };
    });
    const rect = (sel: string) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return { x1: r.left, y1: r.top, x2: r.right, y2: r.bottom };
    };
    return { boxes, panels: panels.map(rect) };
  }, PANELS);

/** The four largest regions: their names must never yield (controller ruling, fix round 4). */
const MAJOR_NAMES = ["samarinda", "kutai-kartanegara", "balikpapan", "kutai-timur"];

/**
 * Turns the province view through the whole idle sway, and 2 degrees past each end, one degree at a time,
 * and checks the region names at every bearing: the four largest always shown, no name touching another
 * or hiding under a panel, and no name flickering (a name that has to yield fades out once and back once).
 */
async function swaySweep(page: Page, label: string, regionIds: string[]) {
  const rest = KALTIM_VIEW.bearing;
  const bearings = Array.from({ length: 2 * (SWAY_DEG + 2) + 1 }, (_, i) => rest - SWAY_DEG - 2 + i);
  const placed: string[][] = [];
  const missing: string[] = [];
  const touching: string[] = [];
  const hidden: string[] = [];
  for (const bearing of bearings) {
    await page.keyboard.press("Shift"); // an input, so the real sway does not start during the sweep
    await page.evaluate(
      async (view) => {
        const map = (window as MapWindow).__malasMap!;
        map.jumpTo(view);
        const start = performance.now();
        while (!map.areTilesLoaded() && performance.now() - start < 5000) await new Promise((r) => setTimeout(r, 50));
      },
      { ...KALTIM_VIEW, bearing },
    );
    await page.waitForTimeout(650); // Mapbox places symbols again at most every 300 ms
    const layout = await labelLayout(page);
    if (!layout) {
      check(false, `${label}: the Mapbox collision index is readable`);
      return;
    }
    const ids = layout.boxes.flatMap((b) => (b.id ? [b.id] : []));
    placed.push(ids);
    for (const id of MAJOR_NAMES) if (!ids.includes(id)) missing.push(`${id} at ${bearing}°`);
    layout.boxes.forEach((a, i) =>
      layout.boxes.slice(i + 1).forEach((b) => {
        if (intersects(a, b)) touching.push(`${a.id ?? "?"}/${b.id ?? "?"} at ${bearing}°`);
      }),
    );
    for (const b of layout.boxes) if (layout.panels.some((p) => intersects(b, p))) hidden.push(`${b.id ?? "?"} at ${bearing}°`);
  }
  const flicker = regionIds.filter((id) => {
    const shown = placed.map((ids) => ids.includes(id));
    const flips = shown.flatMap((s, i) => (i > 0 && s !== shown[i - 1] ? [i] : []));
    return flips.length > 2 || flips.some((f, k) => k > 0 && f - flips[k - 1]! < 3);
  });
  const span = `${bearings[0]}° to ${bearings.at(-1)}°`;
  const fewest = Math.min(...placed.map((ids) => ids.length));
  check(missing.length === 0, `${label}: the four largest regions keep their names from ${span} (${missing.join(", ") || `fewest names at any bearing: ${fewest} of ${regionIds.length}`})`);
  check(touching.length === 0, `${label}: no name touches another (${touching.join(", ") || "none"})`);
  check(hidden.length === 0, `${label}: no name hides under a panel (${hidden.join(", ") || "none"})`);
  check(flicker.length === 0, `${label}: no name flickers on and off during the sway (${flicker.join(", ") || "none"})`);
}

/**
 * Flips the switch with this accessible name the way a user does: by clicking its visible label. HeroUI's
 * switch is a visually hidden `role="switch"` input inside that label, so the role and name are still
 * what the locator finds, and the check below confirms the state really changed.
 */
/** The dock's disclosure: the layer switches, the fuel key, Cahaya and Hujan sit behind it. */
const DOCK_TRIGGER = "Lapisan dan tampilan";

/** Opens the dock's disclosure if it is closed (a check that needs one of its controls calls this first). */
async function openDock(page: Page) {
  const trigger = page.getByRole("button", { name: DOCK_TRIGGER });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
    await page.locator(".controls").waitFor({ state: "visible", timeout: 2000 });
    await page.waitForTimeout(300); // the panel's height transition
  }
}

async function flipSwitch(page: Page, name: string) {
  await openDock(page);
  const input = page.getByRole("switch", { name });
  const before = await input.isChecked();
  await input.locator("xpath=ancestor::label[1]").click();
  await page.waitForFunction(
    ({ name, before }) => {
      const el = [...document.querySelectorAll<HTMLInputElement>('[role="switch"]')].find((e) => e.closest("label")?.textContent?.trim() === name);
      return el !== undefined && el.checked !== before;
    },
    { name, before },
    { timeout: 2000 },
  );
}

/** Samples the map bearing every frame for `ms`, or until `until` (a bearing test) holds; returns what it saw. */
const watchBearing = (page: Page, ms: number, until?: { above: number }) =>
  page.evaluate(
    ({ ms, above }) =>
      new Promise<{ min: number; max: number; last: number; reached: boolean }>((resolve) => {
        const map = (window as MapWindow).__malasMap!;
        const start = performance.now();
        let min = Infinity;
        let max = -Infinity;
        const tick = () => {
          const b = map.getBearing();
          min = Math.min(min, b);
          max = Math.max(max, b);
          const reached = above !== null && b > above;
          if (reached || performance.now() - start > ms) return resolve({ min, max, last: b, reached });
          requestAnimationFrame(tick);
        };
        tick();
      }),
    { ms, above: until?.above ?? null },
  );

/**
 * The idle sway passes within 7 degrees of north. A wheel zoom there must not snap the camera to north
 * (Mapbox `bearingSnap`), and the next sway must stay on the same arc around the resting bearing, where
 * the region names are known to hold.
 */
async function swayKeepsItsArc(page: Page) {
  const rest = KALTIM_VIEW.bearing;
  const lo = rest - SWAY_DEG - 0.3;
  const hi = rest + SWAY_DEG + 0.3;
  // Wait for the sway (20 s idle) to swing up to about -2 degrees, its end nearest north.
  const up = await watchBearing(page, 50_000, { above: rest + SWAY_DEG - 0.8 });
  check(up.reached, `the idle sway swings up to ${(rest + SWAY_DEG).toFixed(0)}° (got to ${up.max.toFixed(1)}°)`);
  if (!up.reached) return;
  // A wheel zoom right there: the pointer on the map stops the sway, the wheel zooms a little.
  await page.mouse.move(VIEW_W * 0.62, VIEW_H * 0.45);
  const before = await page.evaluate(() => (window as MapWindow).__malasMap!.getBearing());
  await page.mouse.wheel(0, -120);
  const after = await watchBearing(page, 2000);
  check(
    Math.abs(after.min - before) < 0.5 && Math.abs(after.max - before) < 0.5,
    `a wheel zoom at ${before.toFixed(1)}° does not snap the camera to north (bearing ${after.min.toFixed(1)}° to ${after.max.toFixed(1)}°)`,
  );
  // Idle again: the next sway carries on around the resting bearing, inside the arc the smoke sweeps.
  await page.mouse.move(40, VIEW_H - 10);
  const resumed = await page.evaluate(
    (b) =>
      new Promise<boolean>((resolve) => {
        const map = (window as MapWindow).__malasMap!;
        const start = performance.now();
        const tick = () => {
          if (Math.abs(map.getBearing() - b) > 0.05) return resolve(true);
          if (performance.now() - start > 30_000) return resolve(false);
          requestAnimationFrame(tick);
        };
        tick();
      }),
    after.last,
  );
  // 20 s: from near its north end back past the middle toward the far end.
  const next = await watchBearing(page, 20_000);
  check(
    resumed && next.min >= lo && next.max <= hi,
    `the next sway stays on its arc, ${(rest - SWAY_DEG).toFixed(0)}° to ${(rest + SWAY_DEG).toFixed(0)}° (${resumed ? `${next.min.toFixed(1)}° to ${next.max.toFixed(1)}°` : "it never started"})`,
  );
}

/**
 * After "Hadapkan ke utara" the province view rests at 0°, outside the arc the region names are swept on.
 * Idle, the sway must glide back to that arc and swing on it, never around 0° (fix round 1, Important 6).
 */
async function swayReturnsToItsArc(page: Page) {
  const rest = KALTIM_VIEW.bearing;
  await page.mouse.move(VIEW_W - 10, 10); // off the map's regions, onto the empty top-right corner
  await page.mouse.move(40, VIEW_H - 60);
  // 20 s idle, then a glide of about 14° at the sway's speed.
  const back = await page.evaluate(
      ({ edge }) =>
        new Promise<boolean>((resolve) => {
          const map = (window as MapWindow).__malasMap!;
          const start = performance.now();
          const tick = () => {
            if (map.getBearing() <= edge) return resolve(true);
            if (performance.now() - start > 45_000) return resolve(false);
            requestAnimationFrame(tick);
          };
          tick();
        }),
      { edge: rest + SWAY_DEG + 0.05 },
  );
  const swing = await watchBearing(page, 10_000);
  check(
    back && swing.min >= rest - SWAY_DEG - 0.3 && swing.max <= rest + SWAY_DEG + 0.3,
    `after a turn to north the idle sway glides back to its arc around ${rest}° (${back ? `${swing.min.toFixed(1)}° to ${swing.max.toFixed(1)}°` : "it never came back"})`,
  );
}

/**
 * A selected region is framed beside the chrome: no part of its outline sits under the sheet, the dock
 * cards or the map tools (fix round 1, Important 5), nor under any `extra` panel (the open chat card).
 * With `id` "*" every region's outline is checked (the province view).
 */
async function regionClearOfChrome(page: Page, id: string, extra: string[] = []) {
  const covered = await page.evaluate(async ([id, selectors]) => {
    const map = (window as MapWindow).__malasMap!;
    const fc = (await (await fetch("/api/regions")).json()) as { features: { properties: { id: string }; geometry: { type: string; coordinates: unknown } }[] };
    const polys = fc.features
      .filter((f) => id === "*" || f.properties.id === id)
      .flatMap(({ geometry: g }) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as number[][][][]);
    const rects = selectors.flatMap((sel) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r ? [{ sel, r }] : [];
    });
    const hits: string[] = [];
    let total = 0;
    for (const poly of polys)
      for (const [lng, lat] of poly[0]!) {
        total++;
        const p = map.project([lng!, lat!]);
        const under = rects.find(({ r }) => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom);
        if (under) hits.push(under.sel);
      }
    return { total, hits: hits.length, where: [...new Set(hits)].join(", ") };
  }, [id, [".sheet", ".legend", ".controls", ".map-tools", ...extra]] as const);
  const what = id === "*" ? "the whole province" : `the selected ${id}`;
  const by = ["the sheet", "dock and tools", ...(extra.length ? ["the chat"] : [])].join(", ");
  check(covered.hits === 0, `${what} is framed clear of ${by} (${covered.hits} of ${covered.total} outline points covered${covered.where ? ` by ${covered.where}` : ""})`);
}

/** The hover preview as the map and the panels show it: lifted and faded columns, list row, needle, tooltip. */
const previewState = (page: Page, regionIds: string[]) =>
  page.evaluate((ids) => {
    const map = (window as MapWindow).__malasMap!;
    const states = ids.map((id) => ({ id, ...(map.getFeatureState({ source: "regions", id }) as { hover?: boolean; fade?: number }) }));
    return {
      lifted: states.filter((s) => s.hover).map((s) => s.id),
      faded: states.filter((s) => (s.fade ?? 0) > 0.01).length,
      activeRow: document.querySelector(".ranking__row[data-active] .ranking__name")?.textContent ?? null,
      needle: document.querySelector(".gauge__name")?.textContent ?? null,
      tooltip: document.querySelector(".map-tooltip") !== null,
    };
  }, regionIds);

/**
 * Points at a region in the list (pointer or keyboard focus), picks it, then goes back with "Semua
 * wilayah" the same way. The preview must show while pointing and be gone after coming back.
 */
async function pickFromList(page: Page, how: "mouse" | "keyboard", region: { id: string; name: string }, regionIds: string[]) {
  const row = page.locator(".ranking__row", { has: page.locator(".ranking__name", { hasText: new RegExp(`^${region.name}$`) }) });
  if (how === "mouse") {
    await row.hover();
  } else {
    await page.mouse.move(VIEW_W - 120, 90); // off the regions, so only the keyboard points
    await row.focus();
  }
  await page.waitForTimeout(500);
  const pointing = await previewState(page, regionIds);
  check(
    pointing.lifted.join() === region.id && pointing.faded === regionIds.length - 1 && pointing.needle === region.name && !pointing.tooltip,
    `${how}: pointing at ${region.name} in the list lifts it, fades the others and swings the needle, with no tooltip`,
  );
  if (how === "mouse") await row.click();
  else await page.keyboard.press("Enter");
  const back = page.getByRole("button", { name: "Semua wilayah" });
  await back.waitFor({ timeout: 5000 });
  await page.waitForTimeout(2600);
  if (how === "mouse") {
    await back.click();
  } else {
    await back.focus();
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(1500); // the columns rise again and their colour comes back
  if (how === "keyboard") {
    // "Semua wilayah" went away with the detail view; focus must land on the row just left, not on <body>.
    const focused = await page.evaluate(() => document.activeElement?.closest(".ranking__row")?.querySelector(".ranking__name")?.textContent ?? document.activeElement?.tagName ?? null);
    check(focused === region.name, `keyboard: after going back, focus returns to the ${region.name} row (focus on ${focused ?? "nothing"})`);
  }
  const after = await previewState(page, regionIds);
  check(
    after.lifted.length === 0 && after.faded === 0 && after.activeRow === null && after.needle === null,
    `${how}: after picking ${region.name} from the list and going back, no preview is left (lifted ${after.lifted.join() || "none"}, faded ${after.faded}, row ${after.activeRow ?? "none"}, needle ${after.needle ?? "none"})`,
  );
}

/**
 * "Lewati intro" during the flight: the most common first action. The camera eases off the globe while
 * tiles are half built; the page must stay free of console warnings (it once logged 12 WebGL
 * GL_INVALID_OPERATION warnings here, from the plant markers).
 */
async function skipIntroIsClean(browser: Awaited<ReturnType<typeof launchBrowser>>) {
  const page = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1 });
  const problems: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    const type = msg.type();
    if ((type === "error" || type === "warning") && !KNOWN_UPSTREAM_WARNINGS.some((re) => re.test(msg.text()))) problems.push(msg.text().slice(0, 140));
  });
  page.on("pageerror", (err) => problems.push(err.message));
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const skip = page.getByRole("button", { name: "Lewati intro" });
  await skip.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200); // well into the flight, still on the globe
  await skip.click();
  await page.locator(".ui-layer").waitFor({ timeout: 20_000 });
  await waitForMapIdle(page, 15_000);
  await page.waitForTimeout(2500);
  const landed = await page.evaluate(() => (window as MapWindow).__malasMap!.getZoom());
  check(Math.abs(landed - KALTIM_VIEW.zoom) < 0.05, `"Lewati intro" lands on the province view (zoom ${landed.toFixed(2)})`);
  check(problems.length === 0, `"Lewati intro" during the flight logs no console warning or error (${problems.length ? problems.slice(0, 2).join("; ") : "none"})`);
  await page.close();
}

/** A plant pin fully shown at this zoom, where it is drawn and where its column's top is on screen. */
interface PinOnScreen {
  name: string;
  kind: string;
  count: number;
  column: string;
  /** The plant's ground point on screen. */
  x: number;
  y: number;
  /** Screen y of its column's top above the plant (the ground point on the ground). */
  topY: number;
  /** Screen y range where the pointer finds this pin, scanning up from the ground point; null if nowhere. */
  hit: [number, number] | null;
  /** The column height the pin layer stands on (its symbol-z-offset at the province view) and the column's own. */
  liftH: number;
  columnH: number;
}

/**
 * Every plant pin fully shown at this zoom (plantGroups.ts fades them in and out), with where the pointer
 * finds it. The pins are lifted onto the column tops, so they are found by scanning up from the ground point.
 */
function pinsOnScreen(page: Page): Promise<PinOnScreen[]> {
  return page.evaluate(
    ({ flatten }) => {
      const map = (window as MapWindow).__malasMap!;
      const layers = map.getStyle().layers.flatMap((l) => (l.id.startsWith("plants-") ? [l.id] : []));
      if (!layers.length) return [];
      const z = map.getZoom();
      type Pin = { layer: { id: string }; geometry: { coordinates: [number, number] }; properties: Record<string, unknown> };
      const full = (f: Pin) => Number(f.properties.appear) + 0.5 <= z && z <= Number(f.properties.split) - 0.5;
      // The flattening of a column at this zoom (columns.ts FLATTEN; no region is selected here).
      let share = flatten.at(-1)![1];
      for (let i = 0; i < flatten.length; i++) {
        const [z1, k1] = flatten[i]!;
        if (z > z1) continue;
        if (i === 0) share = k1;
        else {
          const [z0, k0] = flatten[i - 1]!;
          share = k0 + ((k1 - k0) * (z - z0)) / (z1 - z0);
        }
        break;
      }
      const transform = (map as unknown as { transform: { locationPoint3D: (l: unknown, altitude: number) => { x: number; y: number } } }).transform;
      const seen = new Set<unknown>();
      const pins = (map.queryRenderedFeatures({ layers }) as unknown as Pin[]).filter((f) => full(f) && !seen.has(f.properties.node) && seen.add(f.properties.node));
      return pins.flatMap((f) => {
        const ground = map.project(f.geometry.coordinates);
        if (ground.x < 0 || ground.y < 0 || ground.x > innerWidth || ground.y > innerHeight) return [];
        const column = String(f.properties.column);
        const columnH = column === "ground" ? 0 : Number(map.getFeatureState({ source: "regions", id: column })?.h ?? 0);
        const lift = map.getPaintProperty(f.layer.id, "symbol-z-offset") as unknown;
        // ["interpolate", ["linear"], ["zoom"], 6.6, h, ...] or 0.
        const liftH = Array.isArray(lift) ? Number(lift[4]) : Number(lift);
        const top = transform.locationPoint3D(map.unproject(ground), columnH * share);
        let hit: [number, number] | null = null;
        for (let dy = 0; dy <= 260; dy += 1) {
          const y = ground.y - dy;
          const under = map.queryRenderedFeatures([ground.x, y], { layers }) as unknown as Pin[];
          if (!under.some((u) => u.properties.node === f.properties.node)) continue;
          hit = hit ? [hit[0], y] : [y, y];
        }
        return [
          {
            name: String(f.properties.name ?? ""),
            kind: String(f.properties.kind),
            count: Number(f.properties.count),
            column,
            x: ground.x,
            y: ground.y,
            topY: top.y,
            hit,
            liftH,
            columnH,
          },
        ];
      });
    },
    { flatten: FLATTEN },
  );
}

/**
 * The pins stand on their columns: each pin layer is lifted to its column's height, and on screen the point
 * of every pin sits on the top of its column (within 4 px), so no wall or rim runs through its head.
 */
async function pinsStandOnColumns(page: Page, label: string) {
  const pins = await pinsOnScreen(page);
  const onColumns = pins.filter((p) => p.column !== "ground" && p.columnH > 0);
  check(onColumns.length >= 3, `${label}: plant pins stand on the columns (${onColumns.length} of ${pins.length} on screen)`);
  const offLift = onColumns.filter((p) => Math.abs(p.liftH - p.columnH) > 2).map((p) => `${p.name || `group of ${p.count}`} ${p.liftH.toFixed(0)}/${p.columnH.toFixed(0)} m`);
  check(offLift.length === 0, `${label}: every pin is lifted to its own column's height (${offLift.slice(0, 3).join("; ") || "all"})`);
  const off = onColumns
    .filter((p) => !p.hit || Math.abs(p.hit[0] - p.topY) > 4)
    .map((p) => `${p.name || `group of ${p.count}`}: point at ${p.hit ? p.hit[0].toFixed(0) : "nowhere"}, top at ${p.topY.toFixed(0)}`);
  check(off.length === 0, `${label}: the point of every pin is on its column's top (${off.slice(0, 3).join("; ") || "all"})`);
}

const failures: string[] = [];
const consoleProblems: string[] = [];
/** The last check that ran, so a console problem says roughly where it happened. */
let lastCheck = "page load";
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
  lastCheck = what;
};
const listen = (page: Page, sink: string[]) => {
  page.on("console", (msg: ConsoleMessage) => {
    const type = msg.type();
    if (type !== "error" && type !== "warning") return;
    if (type === "warning" && KNOWN_UPSTREAM_WARNINGS.some((re) => re.test(msg.text()))) {
      ignoredWarnings.push(msg.text().replaceAll(String.fromCharCode(0x1f), " "));
      return;
    }
    sink.push(`${type} (after "${lastCheck}"): ${msg.text()}`);
  });
  page.on("pageerror", (err) => sink.push(`pageerror (after "${lastCheck}"): ${err.message}`));
};

/** WITA date of an instant ("2026-10-21"). */
function witaDateText(ms: number): string {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
}

/** How many /api/weather calls the stub answered: a check that expects a refetch can see one happened. */
let weatherStubHits = 0;

/**
 * Answers every /api/weather call of the page with a fixed three-day forecast (a sun curve from 06.00 to
 * 18.00 WITA), so the real weather at the view centre cannot switch the rain on in the middle of the rain
 * checks (auto rain, map/autoRain.ts). "rain" rains every hour; "stale" is a cached rainy forecast from
 * days ago, which auto rain must ignore. It starts four days back, so its last hour is a full day old: from
 * three days back, its last hour was 23.00 yesterday, within the 2 hours a stale forecast still counts
 * for (STALE_GAP_MS) between midnight and 01.00 WITA, and the check failed then.
 */
async function stubWeather(page: Page, sky: "dry" | "rain" | "stale") {
  await page.unroute("**/api/weather?*");
  const raining = sky !== "dry";
  const start = Date.parse(`${witaDateText(Date.now() - (sky === "stale" ? 4 * 86_400_000 : 0))}T00:00:00+08:00`);
  const forecast = Array.from({ length: 72 }, (_, i) => {
    const hour = i % 24;
    const sun = Math.max(0, Math.sin((Math.PI * (hour - 6)) / 12));
    return {
      time: `${witaDateText(start + i * 3600_000)}T${String(hour).padStart(2, "0")}:00`,
      ghiWm2: Math.round((raining ? 250 : 850) * sun),
      cloudPct: raining ? 100 : 10,
      precipMm: raining ? 3 : 0,
      weatherCode: raining ? 63 : 1,
    };
  });
  const gap = (t: string) => Math.abs(Date.parse(`${t}:00+08:00`) - Date.now());
  const now = forecast.reduce((a, b) => (gap(b.time) < gap(a.time) ? b : a));
  await page.route("**/api/weather?*", (route) => {
    weatherStubHits++;
    const kWp = Number(new URL(route.request().url()).searchParams.get("kWp")) || 0;
    const hours = pvFromForecast(forecast, kWp);
    return route.fulfill({
      json: {
        hours,
        days: summariseDays(hours),
        current: { raining, cloudPct: now.cloudPct, precipMm: now.precipMm, isDay: now.ghiWm2 > 0 },
        stale: sky === "stale",
      },
    });
  });
}

/** Rain drawn on the map, the Hujan switch, the note under it and the overcast tint. */
const rainShown = (page: Page) =>
  page.evaluate(() => ({
    rain: (window as MapWindow).__malasMap!.getRain() != null,
    switchOn: [...document.querySelectorAll<HTMLInputElement>('[role="switch"]')].some((el) => el.closest("label")?.textContent?.trim() === "Hujan" && el.checked),
    note: document.querySelector(".layer__hint")?.textContent ?? null,
    overcast: Number(getComputedStyle(document.querySelector(".overcast")!).opacity),
  }));

/** Jumps the camera to building zoom over a place, which counts as a big move for auto rain. */
async function jumpClose(page: Page, center: [number, number]) {
  await page.mouse.move(VIEW_W / 2, VIEW_H / 2); // restarts the idle wait, so the sway stays off
  await page.evaluate((c) => (window as MapWindow).__malasMap!.jumpTo({ center: c, zoom: 16.6, pitch: 62, bearing: -24 }), center);
  await waitForMapIdle(page, 12_000);
  await page.waitForTimeout(1200); // the forecast answer, then the tint fades in
}

/**
 * Live rain (Task 9): in auto mode the map rains when the forecast says it rains at the view centre now.
 * Starts with the rain switch off (auto) at building zoom. A stale forecast that is days old is ignored;
 * a fresh rainy one turns rain, tint, switch and note on; switching off while it really rains keeps it off.
 */
async function autoRainChecks(page: Page) {
  await stubWeather(page, "stale");
  const hitsBefore = weatherStubHits;
  await jumpClose(page, [116.8473, -1.2654]); // Balikpapan
  const stale = await rainShown(page);
  check(weatherStubHits > hitsBefore, `a big camera move asks for the weather again (${weatherStubHits - hitsBefore} request(s))`);
  check(!stale.rain && !stale.switchOn, `auto rain ignores a forecast that is days old (rain ${stale.rain ? "on" : "off"})`);
  await stubWeather(page, "rain");
  await jumpClose(page, [117.4949, 0.1335]); // Bontang
  const wet = await rainShown(page);
  check(wet.rain && wet.switchOn && wet.overcast > 0.05, `auto rain: it rains at the view centre, so the map rains (rain ${wet.rain ? "on" : "off"}, tint ${wet.overcast.toFixed(2)})`);
  check(wet.note === "Sedang hujan di sini menurut prakiraan Open-Meteo.", `the note says the rain is live (${wet.note ?? "none"})`);
  await shot(page, "7-rain-live");
  await flipSwitch(page, "Hujan");
  await page.waitForTimeout(600);
  const off = await rainShown(page);
  check(
    !off.rain && !off.switchOn && off.note === "Efek hujan mati sampai hujan di sini reda.",
    `switching rain off while it really rains keeps it off for this shower (rain ${off.rain ? "on" : "off"}, note ${off.note ?? "none"})`,
  );
  await stubWeather(page, "dry");
}

/** The number in a text, read the Indonesian way ("1.234,5" is 1234.5). */
const idNumber = (text: string | null) => Number((text ?? "").match(/[\d.]+(,\d+)?/)?.[0]?.replaceAll(".", "").replace(",", ".") ?? Number.NaN);

/**
 * The Surya and Cuaca tabs in the real building panel (Task 9): the backup slider counts the battery up
 * smoothly, Cuaca forecasts the panels Surya sized, rain hours are shaded and a rainy day says what rain
 * costs against a clear sky, and a failed simulation offers "Coba lagi". Opens a building in central
 * Samarinda and closes the panel again at the end.
 */
async function solarPanelChecks(page: Page) {
  await page.evaluate((view) => (window as MapWindow).__malasMap!.jumpTo(view), samarindaClose());
  await waitForMapIdle(page, 15_000);
  await page.waitForTimeout(800);
  const found = await buildingsOnScreen(page);
  if (!found.length) {
    check(false, "panel: a building to open for the Surya and Cuaca tabs");
    return;
  }
  await page.mouse.click(found[0]!.x, found[0]!.y);
  await waitForPanelReady(page);
  const suryaTab = page.getByRole("tab", { name: "Surya" });
  await suryaTab.click();
  await page.locator(".sw-cover").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1300);
  const fact = (label: string) =>
    page.locator(".sw-fact", { has: page.locator(".sw-fact__label", { hasText: label }) }).locator(".sw-fact__number").textContent();
  const batteryBefore = idNumber(await fact("Baterai"));
  await page.getByRole("slider").focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  const seen = new Set<string>();
  const until = Date.now() + 1400;
  while (Date.now() < until) {
    seen.add((await fact("Baterai")) ?? "");
    await page.waitForTimeout(40);
  }
  check(
    seen.size >= 4 && idNumber(await fact("Baterai")) > batteryBefore,
    `panel: the battery counts up smoothly with the backup slider (${seen.size} values on the way)`,
  );
  const kWp = idNumber(await fact("Kapasitas panel"));
  await page.mouse.move(VIEW_W * 0.45, 12);
  await shot(page, "9-panel-surya");
  await screen(page, "solar.png");

  await stubWeather(page, "rain");
  await page.getByRole("tab", { name: "Cuaca" }).click();
  await page.locator(".sw-chart__line").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(900);
  const title = await page.locator("#pv-chart-title").textContent();
  check(idNumber(title?.replace(/^\D+/, "") ?? null) === kWp, `panel: Cuaca forecasts the panels Surya sized (${title})`);
  check((await page.locator(".sw-chart__rain").count()) >= 1, "panel: rain hours are shaded in the hourly chart");
  const drop = await page.locator(".sw-days__drop").first().textContent();
  check(/^produksi turun \d+% karena hujan$/.test(drop ?? ""), `panel: a rainy day says what rain costs against a clear sky (${drop})`);
  await shot(page, "9-panel-cuaca");
  await stubWeather(page, "dry");

  const logged = consoleProblems.length;
  await page.route("**/api/solar/simulate", (route) => route.fulfill({ status: 503, json: { error: "Layanan sedang tidak tersedia." } }));
  await page.getByRole("tab", { name: "Surya" }).click();
  const alert = page.locator(".sw-tab__failure");
  const failed = await alert.waitFor({ timeout: 10_000 }).then(() => true, () => false);
  await page.unroute("**/api/solar/simulate");
  // Chromium logs the 503 sent on purpose above as a failed resource: that one is ours, not a problem.
  for (let i = consoleProblems.length - 1; i >= logged; i--) if (/status of 503/.test(consoleProblems[i]!)) consoleProblems.splice(i, 1);
  check(failed, "panel: a failed simulation says so and offers Coba lagi");
  if (failed) {
    await alert.getByRole("button", { name: "Coba lagi" }).click();
    check(await page.locator(".sw-cover").waitFor({ timeout: 20_000 }).then(() => true, () => false), "panel: Coba lagi brings the simulation back");
  }
  await page.getByRole("tab", { name: "Energi" }).click();
  await page.locator(".building-panel__close").click();
  await page.locator(".building-panel").waitFor({ state: "detached", timeout: 3000 });
}

const browser = await launchBrowser();

try {
  console.log(`viewport ${VIEW_W}x${VIEW_H}`);
  const page = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1 });
  listen(page, consoleProblems);
  await stubWeather(page, "dry");

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Malas Ngoding" }).waitFor({ timeout: 15_000 });
  check(true, "intro title shows");

  await page.getByRole("button", { name: "Lewati intro" }).waitFor({ timeout: 30_000 });
  check(true, "intro flight starts");
  const globe = await page.evaluate(() => {
    const map = (window as MapWindow).__malasMap!;
    return { zoom: map.getZoom(), placeLabels: map.getConfigProperty("basemap", "showPlaceLabels") as boolean };
  });
  check(
    globe.placeLabels === globe.zoom < GLOBE_LABEL_ZOOM,
    `the globe names its geography until the columns take over at zoom ${GLOBE_LABEL_ZOOM} (zoom ${globe.zoom.toFixed(1)}, place names ${globe.placeLabels ? "on" : "off"})`,
  );
  await page.waitForTimeout(800);
  await shot(page, "1-intro-globe");
  await page.waitForTimeout(2200);
  await shot(page, "1-intro");

  await page.locator(".ui-layer").waitFor({ timeout: 40_000 });
  check(true, "intro ends and the panels appear");
  await waitForMapIdle(page);
  await page.waitForTimeout(2500); // regions finish rising, counters finish counting
  await waitForMapIdle(page);

  const fonts = await page.evaluate(() => ({
    sans: document.fonts.check("14px 'IBM Plex Sans Variable'"),
    serif: document.fonts.check("500 28px 'IBM Plex Serif'"),
  }));
  check(fonts.sans && fonts.serif, "IBM Plex Sans and Plex Serif are loaded");

  const columns = await page.evaluate(() => {
    const map = (window as unknown as { __malasMap?: import("mapbox-gl").Map }).__malasMap;
    const feats = map?.queryRenderedFeatures({ layers: ["regions-extrusion"] }) ?? [];
    const ids = new Set(feats.map((f) => (f as unknown as { properties?: { id?: string } }).properties?.id));
    const pinLayers = map?.getStyle().layers.flatMap((l) => (l.id.startsWith("plants-") ? [l.id] : [])) ?? [];
    const plants = (map?.queryRenderedFeatures({ layers: pinLayers }) ?? []).filter((f) => (f as unknown as { properties?: { kind?: string } }).properties?.kind === "plant");
    return { regions: ids.size, plants: pinLayers.length ? plants.length : 0 };
  });
  check(columns.regions === 10, `10 regions rendered (got ${columns.regions})`);
  check(columns.plants > 0, `plants rendered (got ${columns.plants})`);
  const overview = await mapState(page);
  check(overview.regionLabels === 10, `all 10 region names stand on their columns (got ${overview.regionLabels})`);
  check(overview.placeLabels === false, "no basemap place names over the columns at the province view");
  // After the intro a small zoom-out keeps the basemap names off the standing columns; well out they return.
  const placeLabelsAt = (zoom: number) =>
    page.evaluate(
      ({ view, zoom }) => {
        const map = (window as MapWindow).__malasMap!;
        map.jumpTo({ ...view, zoom });
        return map.getConfigProperty("basemap", "showPlaceLabels") as boolean;
      },
      { view: KALTIM_VIEW, zoom },
    );
  const smallOut = await placeLabelsAt(5.1);
  const farOut = await placeLabelsAt(LANDED_LABEL_ZOOM - 0.2);
  check(!smallOut && farOut, `after the intro, place names stay off the columns at zoom 5.1 (${smallOut ? "on" : "off"}) and return below zoom ${LANDED_LABEL_ZOOM} (${farOut ? "on" : "off"})`);
  await page.evaluate((view) => (window as MapWindow).__malasMap!.jumpTo(view), KALTIM_VIEW);
  await waitForMapIdle(page);
  await page.waitForTimeout(800);

  // The dock, closed (a new session): the metric switch and the legend meter only, the controls behind one
  // disclosure. Opened, the controls card stands beside the legend, no taller than it, the fuel key under
  // Pembangkit only while the plants are on; the open state is remembered for the session.
  const closedDock = await page.evaluate(() => {
    // A folded panel keeps its children's boxes (hidden="until-found", content-visibility: hidden), so
    // visibility is asked of the browser itself.
    const shown = (el: Element | null | undefined) => Boolean(el?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
    const visible = (sel: string) => shown(document.querySelector(sel));
    return {
      legend: visible(".legend"),
      metric: document.querySelectorAll('.legend [role="radio"]').length,
      ramp: visible(".legend .gauge__ramp") && visible(".legend .gauge__ticks") && /perkiraan/.test(document.querySelector(".legend .gauge__unit")?.textContent ?? ""),
      controls: visible(".controls"),
      switches: [...document.querySelectorAll<HTMLElement>('[role="switch"]')].filter((el) => shown(el.closest("label"))).length,
    };
  });
  check(
    closedDock.legend && closedDock.metric === 2 && closedDock.ramp && !closedDock.controls && closedDock.switches === 0,
    `a new session shows the metric switch and the legend meter, with the layers, light and rain folded away (metric ${closedDock.metric}, controls ${closedDock.controls}, switches in view ${closedDock.switches})`,
  );
  const trigger = page.getByRole("button", { name: DOCK_TRIGGER });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const openedDock = await page.evaluate(() => {
    const r = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
    return {
      legend: r(".legend"),
      controls: r(".controls"),
      remembered: sessionStorage.getItem("malas:dock-open"),
      fuelKey: document.querySelectorAll(".controls .fuel-key li").length,
    };
  });
  check(
    (await trigger.getAttribute("aria-expanded")) === "true" && !!openedDock.controls && openedDock.controls.width > 0,
    "the disclosure opens with the keyboard and shows the map controls",
  );
  check(
    !!openedDock.legend && !!openedDock.controls && openedDock.controls.top >= openedDock.legend.top - 0.5 && Math.abs(openedDock.controls.bottom - openedDock.legend.bottom) <= 1,
    `the open controls stand beside the legend on its bottom edge, no taller than it (legend top ${Math.round(openedDock.legend?.top ?? 0)}, controls top ${Math.round(openedDock.controls?.top ?? 0)})`,
  );
  check(openedDock.remembered === "1", `the open dock is remembered for the session (${openedDock.remembered})`);
  check(openedDock.fuelKey > 0, `the plant fuel key sits under Pembangkit while the plants are on (${openedDock.fuelKey} fuels)`);
  await flipSwitch(page, "Pembangkit");
  const keyWhenOff = await page.locator(".controls .fuel-key").count();
  await flipSwitch(page, "Pembangkit");
  check(keyWhenOff === 0 && (await page.locator(".controls .fuel-key li").count()) === openedDock.fuelKey, `with the plants off the fuel key goes, and comes back with them (${keyWhenOff} while off)`);

  // Layout, with the dock open (its largest): the sheet and every card of the bottom dock inside the
  // viewport, none overlapping another, nothing cut off, the right edge free for the chat button.
  const layout = await page.evaluate((cards) => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    return {
      sheet: box(document.querySelector(".sheet")!),
      tools: document.querySelector(".map-tools") ? box(document.querySelector(".map-tools")!) : null,
      dock: cards.map((sel) => {
        const el = document.querySelector<HTMLElement>(sel);
        return el ? { sel, ...box(el), overflow: el.scrollWidth - el.clientWidth } : { sel, missing: true as const };
      }),
      // How far the ten regions and the sheet's foot reach below the visible part of the sheet. The grid
      // mix and equivalents (EmissionContext) come after the foot and may scroll.
      sheetScroll: (() => {
        const el = document.querySelector<HTMLElement>(".sheet__scroll")!;
        const foot = el.querySelector<HTMLElement>(".sheet__foot") ?? el;
        return Math.max(0, Math.round(foot.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom));
      })(),
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  }, DOCK_CARDS);
  const { sheet, vw, vh } = layout;
  check(sheet.left >= 0 && sheet.top >= 0 && sheet.bottom <= vh - 30, `region sheet fits the viewport (bottom ${Math.round(sheet.bottom)} of ${vh})`);
  for (const card of layout.dock) {
    if ("missing" in card) {
      check(false, `${card.sel} is on the page`);
      continue;
    }
    const others = layout.dock.filter((o) => o !== card && !("missing" in o)) as (typeof card)[];
    check(card.left > sheet.right || card.top > sheet.bottom, `${card.sel} does not overlap the region sheet`);
    check(
      others.every((o) => !intersects({ x1: card.left, y1: card.top, x2: card.right, y2: card.bottom }, { x1: o.left, y1: o.top, x2: o.right, y2: o.bottom })),
      `${card.sel} does not overlap another dock card`,
    );
    check(card.left >= 0 && card.top >= 0 && card.right <= vw - 80 && card.bottom <= vh, `${card.sel} fits and leaves the right edge free (right ${Math.round(card.right)} of ${vw})`);
    check(card.overflow <= 1, `${card.sel} content does not overflow (by ${card.overflow}px)`);
  }
  check(
    layout.tools !== null &&
      layout.tools.right <= vw && layout.tools.bottom <= vh && layout.tools.left >= vw - 80 &&
      [sheet, ...layout.dock].every((p) => "missing" in p || !intersects({ x1: p.left, y1: p.top, x2: p.right, y2: p.bottom }, { x1: layout.tools!.left, y1: layout.tools!.top, x2: layout.tools!.right, y2: layout.tools!.bottom })),
    `the map tools sit in the free right edge and touch no panel (${layout.tools ? `left ${Math.round(layout.tools.left)} of ${vw}` : "missing"})`,
  );
  check(layout.sheetScroll <= 1, `all ten regions and the sheet foot fit without scrolling (hidden ${layout.sheetScroll}px)`);
  await shot(page, "2-overview");
  await screen(page, "map.png");

  // The idle sway: the region names must hold over every bearing it reaches, for both metrics. The pointer
  // rests on the sheet's title, so no hover preview runs meanwhile.
  const regionList = ((await (await fetch(new URL("/api/regions", BASE_URL))).json()) as { features: { properties: { id: string; name: string } }[] }).features.map(
    (f) => f.properties,
  );
  const regionIds = regionList.map((r) => r.id);
  await page.mouse.move(sheet.left + 30, sheet.top + 20);
  await swaySweep(page, "sway, CO2", regionIds);
  await shot(page, "2-sway-end");
  await page.getByRole("radio", { name: "Listrik" }).click();
  await page.waitForTimeout(2200); // the columns sink and rise; the names follow
  await swaySweep(page, "sway, kWh", regionIds);
  await page.getByRole("radio", { name: "Emisi CO2" }).click();
  await page.keyboard.press("Shift");
  await page.evaluate((view) => (window as MapWindow).__malasMap!.jumpTo(view), KALTIM_VIEW);
  await page.waitForTimeout(2200);
  await swayKeepsItsArc(page);
  await page.keyboard.press("Shift");
  await page.evaluate((view) => (window as MapWindow).__malasMap!.jumpTo(view), KALTIM_VIEW);
  await page.waitForTimeout(1200);

  // The plant pins stand on the column tops: at the province view, at the pitch-60 hero view at both ends
  // of the sway, and while a column is lifted by a hover in the list (the pins follow every frame).
  await pinsStandOnColumns(page, "province view");
  for (const bearing of [KALTIM_VIEW.bearing - SWAY_DEG, KALTIM_VIEW.bearing + SWAY_DEG]) {
    await page.keyboard.press("Shift");
    await page.evaluate((view) => (window as MapWindow).__malasMap!.jumpTo(view), { ...KALTIM_VIEW, pitch: 60, bearing });
    await waitForMapIdle(page);
    await page.waitForTimeout(700);
    await pinsStandOnColumns(page, `pitch 60, bearing ${bearing}°`);
  }
  await page.keyboard.press("Shift");
  await page.evaluate((view) => (window as MapWindow).__malasMap!.jumpTo(view), KALTIM_VIEW);
  await page.waitForTimeout(700);
  await page.locator(".ranking__row", { has: page.locator(".ranking__name", { hasText: /^Samarinda$/ }) }).hover();
  await page.waitForTimeout(700);
  await pinsStandOnColumns(page, "Samarinda lifted by a hover in the list");
  await page.mouse.move(sheet.left + 30, sheet.top + 20);
  await page.waitForTimeout(700);

  // Hover and click Paser through the map, not the panel. It is the southernmost region, so no other
  // column stands in front of it, and it has no power plant marker on top.
  const point = await page.evaluate(() => {
    const map = (window as unknown as { __malasMap?: import("mapbox-gl").Map }).__malasMap!;
    const p = map.project([116.05, -1.75]);
    return { x: p.x, y: p.y };
  });
  await page.mouse.move(point.x, point.y - 20, { steps: 4 });
  await page.waitForTimeout(600);
  check(await page.locator(".map-tooltip").isVisible(), "hovering a region shows its tooltip");
  check((await page.locator(".gauge__name").textContent()) === "Paser", "the legend needle reads the hovered region");
  const hover = await mapState(page);
  check(
    hover.paser.hover === true && Number(hover.samarinda.fade) > 0.5 && !hover.paser.fade,
    `hover lifts the region and the others fade back (Samarinda fade ${Number(hover.samarinda.fade ?? 0).toFixed(2)})`,
  );
  await shot(page, "3-hover");
  await page.mouse.click(point.x, point.y - 20);
  await page.getByRole("button", { name: "Semua wilayah" }).waitFor({ timeout: 5000 });
  check(true, "clicking a region opens its detail panel");
  await page.waitForTimeout(2600);
  await waitForMapIdle(page);
  await shot(page, "4-region");
  await regionClearOfChrome(page, "paser");
  // The region's grid mix and equivalents are folded under one row; the key figures stay in view.
  const more = page.getByRole("button", { name: "Asal listrik dan pembanding emisi" });
  // A folded panel keeps its children's boxes (hidden="until-found"), so the browser is asked directly.
  const contextShown = () =>
    page.evaluate(() => Boolean(document.querySelector(".sheet .context")?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })));
  const folded = (await more.getAttribute("aria-expanded")) === "false" && !(await contextShown());
  check(folded && (await page.locator(".sheet .readout").first().isVisible()) && (await page.locator(".sheet .facts").isVisible()), "the region's grid mix and equivalents start folded, the key figures in view");
  await more.click();
  await page.waitForTimeout(500);
  const context = (await page.locator(".sheet .context").textContent().catch(() => null)) ?? "";
  check(
    (await contextShown()) && /Asal listrik Kaltim/.test(context) && /Batu bara/.test(context) && (await page.locator(".sheet .equivalents__row").count()) >= 3,
    "opening it shows the grid mix by fuel and the equivalents",
  );
  await more.click();
  await page.waitForTimeout(400);

  await page.getByRole("radio", { name: "Listrik" }).click();
  await page.waitForTimeout(1800);
  check((await page.locator(".gauge__unit").textContent())?.startsWith("kWh per tahun") === true, "the legend follows the kWh metric");
  await shot(page, "5-kwh");
  await page.getByRole("radio", { name: "Emisi CO2" }).click();
  await page.getByRole("button", { name: "Semua wilayah" }).click();
  await page.waitForTimeout(1500);
  const backFromMap = await previewState(page, regionIds);
  check(
    backFromMap.lifted.length === 0 && backFromMap.faded === 0 && !backFromMap.tooltip,
    `back from a region picked on the map: nothing stays lifted or faded (lifted ${backFromMap.lifted.join() || "none"}, faded ${backFromMap.faded})`,
  );
  await page.waitForTimeout(1100);
  await waitForMapIdle(page);
  await shot(page, "6-back");

  // Picking from the list: the clicked row disappears with the list, so it never sees the pointer leave.
  await pickFromList(page, "mouse", regionList.find((r) => r.id === "paser")!, regionIds);
  await shot(page, "6-back-list-mouse");
  await pickFromList(page, "keyboard", regionList.find((r) => r.id === "berau")!, regionIds);
  await shot(page, "6-back-list-keyboard");
  await recommendationsAndMethodology(page);

  // Plants: a pin's tooltip names the plant, its fuel and its capacity; plants that would overlap on screen
  // merge into one group pin whose tooltip lists them all. The pointer goes to the pin's head, up on its
  // column, and the tooltip opens beside the pin, never over its head.
  await page.keyboard.press("Shift");
  await page.evaluate((view) => (window as MapWindow).__malasMap!.jumpTo(view), KALTIM_VIEW);
  await waitForMapIdle(page);
  await page.waitForTimeout(800);
  const pins = (await pinsOnScreen(page)).filter((p) => p.hit);
  /** Hovers a pin's head; returns the tooltip text and whether the tooltip leaves the head in view. */
  const hoverHead = async (pin: PinOnScreen) => {
    const head = { x: pin.x, y: pin.hit![1] + 3 };
    await page.mouse.move(head.x, head.y, { steps: 3 });
    await page.waitForTimeout(600);
    const text = (await page.locator(".map-popup").textContent().catch(() => null)) ?? "";
    const box = await page.locator(".map-popup").boundingBox().catch(() => null);
    const clear = !!box && !(head.x > box.x && head.x < box.x + box.width && head.y > box.y && head.y < box.y + box.height);
    return { text, clear };
  };
  const singles = pins.filter((p) => p.kind === "plant");
  let single: { pin: PinOnScreen; text: string; clear: boolean } | null = null;
  // A pin's head may sit behind a nearer pin; the first few are tried until one is the topmost.
  for (const pin of singles.slice(0, 4)) {
    const seen = await hoverHead(pin);
    single = { pin, ...seen };
    if (seen.text.includes(pin.name)) break;
  }
  if (single) {
    const { pin, text, clear } = single;
    check(
      text.includes(pin.name) && /\d MW/.test(text) && /Batu bara|Gas|Surya|Diesel|Air|Biomassa|Lainnya/.test(text),
      `hovering a plant pin's head shows its name, fuel and MW (${text.replace(/\s+/g, " ").trim().slice(0, 80)})`,
    );
    check(clear, `the plant tooltip opens beside the pin, not over its head (${pin.name})`);
  } else check(false, "a single plant pin is on screen at the province view");
  const many = pins.find((p) => p.kind === "group");
  if (many) {
    const { clear } = await hoverHead(many);
    const listed = await page.locator(".map-popup .plant-list li").count();
    check(listed === many.count && many.count > 1, `a group pin's tooltip lists all ${many.count} of its plants (listed ${listed})`);
    check(clear, "the group tooltip opens beside the pin, not over its head");
    // A click on the group zooms in until its plants have parted.
    await page.mouse.click(many.x, many.hit![1] + 3);
    await page.waitForTimeout(1400);
    const zoomed = await page.evaluate(() => (window as MapWindow).__malasMap!.getZoom());
    check(zoomed > KALTIM_VIEW.zoom + 0.5, `clicking a group pin zooms in until its plants part (zoom ${zoomed.toFixed(2)})`);
    await page.keyboard.press("Shift");
    await page.evaluate((view) => (window as MapWindow).__malasMap!.jumpTo(view), KALTIM_VIEW);
    await waitForMapIdle(page);
  } else check(false, "overlapping plants merge into a group pin at the province view");
  await page.mouse.move(sheet.left + 30, sheet.top + 20);

  // Map tools: our own group, each tool with a tooltip on keyboard focus; north, then back to the province.
  await page.getByRole("button", { name: "Perbesar" }).focus();
  await page.keyboard.press("ArrowDown");
  const tip = page.getByRole("tooltip");
  // The previous tool's tooltip fades out while the next one fades in: wait until one is left.
  await page.waitForFunction(() => document.querySelectorAll('[role="tooltip"]').length === 1, undefined, { timeout: 3000 }).catch(() => {});
  check((await tip.textContent().catch(() => null)) === "Perkecil", "arrow keys move through the map tools and each one shows its tooltip");
  await page.getByRole("button", { name: "Hadapkan ke utara" }).click();
  await page.waitForTimeout(1500);
  const north = await page.evaluate(() => (window as MapWindow).__malasMap!.getBearing());
  check(Math.abs(north) < 0.5, `the compass turns the map to north (bearing ${north.toFixed(1)}°)`);
  await swayReturnsToItsArc(page);
  await page.getByRole("button", { name: "Kembali ke seluruh Kalimantan Timur" }).click();
  await page.waitForTimeout(2600);
  const home = await page.evaluate(() => {
    const map = (window as MapWindow).__malasMap!;
    return { bearing: map.getBearing(), zoom: map.getZoom() };
  });
  check(
    Math.abs(home.bearing - KALTIM_VIEW.bearing) < 0.5 && Math.abs(home.zoom - KALTIM_VIEW.zoom) < 0.05,
    `the province tool flies back to the overview (bearing ${home.bearing.toFixed(1)}°, zoom ${home.zoom.toFixed(2)})`,
  );
  const attribution = await page.evaluate(() => {
    const visible = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      const r = el?.getBoundingClientRect();
      return Boolean(el && r && r.width > 0 && r.bottom <= window.innerHeight && getComputedStyle(el).visibility !== "hidden");
    };
    return { logo: visible(".mapboxgl-ctrl-logo"), text: document.querySelector(".mapboxgl-ctrl-attrib")?.textContent ?? "", shown: visible(".mapboxgl-ctrl-attrib") };
  });
  check(attribution.logo && attribution.shown && attribution.text.includes("Mapbox") && attribution.text.includes("OpenStreetMap"), "the Mapbox wordmark and the full attribution are on screen");

  // Rain: switched on at the province view it stays invisible (density 0) and the legend explains why.
  await flipSwitch(page, "Hujan");
  await page.waitForTimeout(400);
  check(await page.locator(".layer__hint").isVisible(), "the rain hint shows while the view is too far out");
  const rainAt = (zoom: number) =>
    page.evaluate((z) => {
      const map = (window as unknown as { __malasMap?: import("mapbox-gl").Map }).__malasMap!;
      const density = map.getRain()?.density;
      if (!Array.isArray(density)) return typeof density === "number" ? density : -1;
      const [, , , z0, v0, z1, v1] = density as [string, unknown, unknown, number, number, number, number];
      return z <= z0 ? v0 : z >= z1 ? v1 : v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
    }, zoom);
  const provinceZoom = await page.evaluate(() => (window as unknown as { __malasMap?: import("mapbox-gl").Map }).__malasMap!.getZoom());
  check((await rainAt(provinceZoom)) === 0, `no rain at the province view (zoom ${provinceZoom.toFixed(1)})`);
  check((await rainAt(16.5)) > 0, "rain is on at building zoom");

  // Jump close over Samarinda: buildings, rain, and the hint goes away. Moving the pointer first restarts
  // the 20 s idle-orbit wait, so the camera holds still for the screenshot.
  await page.mouse.move(VIEW_W / 2, VIEW_H / 2);
  await page.evaluate(() => {
    const map = (window as unknown as { __malasMap?: import("mapbox-gl").Map }).__malasMap!;
    map.jumpTo({ center: [117.1475, -0.4955], zoom: 16.6, pitch: 62, bearing: -24, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
  });
  await waitForMapIdle(page, 12_000);
  await page.waitForTimeout(1500);
  check(!(await page.locator(".layer__hint").isVisible()), "the rain hint hides at building zoom");
  await page.waitForTimeout(500); // the tint fades in
  const autoRain = await mapState(page);
  check(autoRain.overcast > 0.05, `the overcast tint is on while it rains up close (opacity ${autoRain.overcast.toFixed(2)})`);
  check(autoRain.placeLabels === true, "basemap place names are back at building zoom");
  await shot(page, "7-rain");
  await screen(page, "rain.png");

  // The Cahaya switch: Siang and Malam pin the light, rain, haze and tint follow; Otomatis goes back to WITA time.
  const lightTo = async (label: string) => {
    await openDock(page);
    await page.getByRole("radio", { name: label }).click();
    await waitForMapIdle(page, 12_000);
    await page.waitForTimeout(600);
    return mapState(page);
  };
  const night = await lightTo("Malam");
  check(night.preset === "night" && night.theme === "faded", `Malam: night light on the navy basemap (${night.preset}, ${night.theme})`);
  await shot(page, "7-rain-malam");
  const day = await lightTo("Siang");
  check(day.preset === "day" && day.theme === "faded", `Siang: day light on the muted basemap (${day.preset}, ${day.theme})`);
  check(day.haze && !night.haze, "Siang: the rain falls through a haze inside the map; Malam: no haze");
  check(day.rainColor !== night.rainColor, "Siang and Malam use their own drop colour");
  await shot(page, "7-rain-siang");
  const auto = await lightTo("Otomatis");
  check(auto.preset === basemapLight(lightPresetFor(new Date())), `Otomatis follows WITA time (${lightPresetFor(new Date())}, basemap light ${auto.preset})`);
  await flipSwitch(page, "Hujan");
  await page.waitForTimeout(300);
  check(!(await mapState(page)).haze, "switching the rain off clears the haze");
  await autoRainChecks(page);
  await chatChecks(page);
  await buildingChecks(page);
  await solarPanelChecks(page);
  await buildingHeapSoak(page);
  // Close it so its idle orbit does not keep streaming city tiles in the background during the next check.
  await page.close();

  await skipIntroIsClean(browser);

  // Failure path: Mapbox rejects the token. The app must show the Indonesian card, not hang or throw.
  const failPage = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1 });
  const failErrors: string[] = [];
  failPage.on("pageerror", (err) => failErrors.push(err.message));
  await failPage.route("**/api/config", (route) => route.fulfill({ json: { mapboxToken: "pk.eyJ1IjoiZmFrZSIsImEiOiJmYWtlIn0.ZmFrZQ" } }));
  await failPage.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const alert = failPage.getByRole("alert");
  await alert.waitFor({ timeout: 20_000 });
  check((await alert.textContent())?.includes("Coba lagi") === true, "a rejected Mapbox token shows the 'Coba lagi' card");
  check(!(await failPage.locator(".mapboxgl-control-container").isVisible()), "the dead map controls hide behind the card");
  await failPage.waitForTimeout(700); // the intro title finishes fading out
  await shot(failPage, "8-failure");
  // "Coba lagi" with a working token brings the map back.
  await failPage.unroute("**/api/config");
  await failPage.getByRole("button", { name: "Coba lagi" }).click();
  await failPage.locator(".ui-layer").waitFor({ timeout: 60_000 });
  check(true, "'Coba lagi' recovers once the token works");
  check(failErrors.length === 0, `no uncaught errors on the failure path (${failErrors.join("; ") || "none"})`);
  await failPage.close();
  await recommendationsFailure();
} catch (err) {
  failures.push(err instanceof Error ? err.message : String(err));
  console.error(err);
} finally {
  await browser.close();
}

if (ignoredWarnings.length) {
  console.log(`\nIgnored ${ignoredWarnings.length} known Mapbox warning(s):`);
  for (const w of new Set(ignoredWarnings)) console.log(`  ${w}`);
}
if (consoleProblems.length) {
  console.log("\nConsole errors and warnings:");
  for (const e of consoleProblems) console.log(`  ${e}`);
}
const failed = failures.length > 0 || consoleProblems.length > 0;
console.log(failed ? `\nSMOKE FAILED (${failures.length} checks, ${consoleProblems.length} console problems)` : "\nSMOKE PASSED");
process.exit(failed ? 1 : 0);

// ---------- Recommendations and methodology (lane recs-ui) ----------

/** The open region's recommendations: who wrote them, and every item's priority and category. */
function recsState(page: Page) {
  return page.evaluate(() => ({
    source: document.querySelector(".recs__source")?.textContent ?? "",
    metas: [...document.querySelectorAll(".rec__meta")].map((m) => m.textContent ?? ""),
    expanded: [...document.querySelectorAll(".rec__trigger")].map((t) => t.getAttribute("aria-expanded") === "true"),
  }));
}

/** Shows the recommendations section in the sheet's own scroll area. */
function scrollToRecs(page: Page) {
  return page.locator(".recs").evaluate((el) => el.scrollIntoView({ block: "start" }));
}

function pickRegionRow(page: Page, name: string) {
  return page.locator(".ranking__row", { has: page.locator(".ranking__name", { hasText: new RegExp(`^${name}$`) }) }).click();
}

/** Light switch, then a quiet map for the shot. */
async function lightFor(page: Page, label: "Siang" | "Malam" | "Otomatis") {
  await openDock(page);
  await page.getByRole("radio", { name: label }).click();
  await waitForMapIdle(page, 12_000);
  await page.waitForTimeout(600);
}

/**
 * The region detail's "Rekomendasi untuk pemerintah daerah": the slow first answer (progress line and
 * skeleton, no spinner), the rule-based label, AI items with model and date, priority and category on
 * every item, opening an item with the keyboard; then the methodology sheet from "Tentang peta ini" (grid
 * factors, asumsi rows, CC BY 3.0 IGO), by day and by night. Starts and ends on the overview.
 */
async function recommendationsAndMethodology(page: Page) {
  // A slow answer from the rules: the loading view shows, then the "berbasis aturan" label.
  await page.route("**/api/recommendations/**", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { model: string | null };
    await new Promise((r) => setTimeout(r, 2500));
    await route.fulfill({ response: res, json: { ...body, model: null } });
  });
  await pickRegionRow(page, "Kutai Barat");
  await page.locator(".recs__loading").waitFor({ timeout: 2000 });
  await page.waitForTimeout(1200);
  await scrollToRecs(page);
  const loading = await page.evaluate(() => ({
    progress: document.querySelector(".recs [role=progressbar]") !== null,
    rows: document.querySelectorAll(".recs__skeleton-item").length,
    spinner: document.querySelector(".recs [class*=spinner]") !== null,
    note: document.querySelector(".recs__note")?.textContent ?? "",
  }));
  check(
    loading.progress && loading.rows === 3 && !loading.spinner && loading.note.includes("8 sampai 10 detik"),
    "recommendations: a slow first answer shows a progress line and skeleton rows, no spinner",
  );
  await shot(page, "9-recs-loading");
  await page.locator(".recs__list").waitFor({ timeout: 10_000 });
  check((await recsState(page)).source.startsWith("Berbasis aturan"), "recommendations: rule-based items (model null) say 'Berbasis aturan'");
  await page.unroute("**/api/recommendations/**");
  await page.getByRole("button", { name: "Semua wilayah" }).click();
  await page.waitForTimeout(1500);

  // The server's own answer: Claude's items (cached by `bun run warm`, else written now, 8 to 10 s) name the
  // model and the date; without an API key the rules answer. Then priority and category on every item.
  await pickRegionRow(page, "Samarinda");
  await page.locator(".recs__list").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2600);
  const recs = await recsState(page);
  const byAi = /^Ditulis AI \(claude-[\w.-]+\) pada \d{1,2} \w+ \d{4}/.test(recs.source);
  check(
    byAi || recs.source.startsWith("Berbasis aturan"),
    `recommendations: the items say who wrote them (${byAi ? "AI, with the model and the date" : "berbasis aturan"})`,
  );
  check(
    recs.metas.length >= 3 &&
      recs.metas.length <= 6 &&
      recs.metas.every((m) => /^Prioritas [123], (energi terbarukan|efisiensi energi|tata ruang|akses listrik|kebijakan)$/.test(m)),
    `recommendations: ${recs.metas.length} items, each with its priority and category`,
  );
  check(recs.expanded[0] === true && recs.expanded.slice(1).every((e) => !e), "recommendations: the most urgent item is open, the rest closed");
  const second = page.locator(".rec__trigger").nth(1);
  await second.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  check(
    (await second.getAttribute("aria-expanded")) === "true" && (await page.locator(".rec").nth(1).locator(".rec__impact-label").isVisible()),
    "recommendations: Enter opens an item and shows its expected impact",
  );
  await scrollToRecs(page);
  for (const light of ["Siang", "Malam"] as const) {
    await lightFor(page, light);
    await shot(page, `9-recs-${light.toLowerCase()}`);
  }

  // Methodology: from "Tentang peta ini", a side sheet over the map.
  await page.getByRole("button", { name: "Tentang peta ini" }).click();
  await page.getByRole("button", { name: "Cara menghitung dan sumber data" }).click();
  const sheet = page.locator(".methodology");
  await sheet.waitFor({ timeout: 3000 });
  await page.locator(".methodology__table").first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
  const method = await sheet.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      text: el.textContent ?? "",
      assumptions: el.querySelectorAll("tr[data-assumption]").length,
      inside: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      dialog: el.getAttribute("role") === "dialog",
    };
  });
  check(method.dialog && method.inside, "methodology: opens as a dialog inside the viewport");
  check(
    method.text.includes("1,14 kg CO2/kWh, dipakai") &&
      method.text.includes("0,87 kg CO2/kWh") &&
      method.text.includes("Sistem Mahakam") &&
      method.text.includes("data 2019"),
    "methodology: names the official 1,14 factor (Sistem Mahakam, 2019) it uses and the 0,87 mix average",
  );
  check(method.text.includes("CC BY 3.0 IGO") && method.text.includes("geoBoundaries"), "methodology: credits geoBoundaries under CC BY 3.0 IGO");
  check(method.assumptions > 0, `methodology: ${method.assumptions} asumsi rows are marked`);
  await shot(page, "9-method-malam");
  await page.keyboard.press("Escape");
  await page.locator(".drawer__backdrop").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  check((await sheet.count()) === 0, "methodology: Escape closes the sheet");
  // The sheet is modal, so the light switch waits until it is closed.
  await page.keyboard.press("Escape");
  await lightFor(page, "Siang");
  await page.getByRole("button", { name: "Tentang peta ini" }).click();
  await page.getByRole("button", { name: "Cara menghitung dan sumber data" }).click();
  await page.locator(".methodology__table").first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await shot(page, "9-method-siang");
  await page.locator(".methodology__body").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(300);
  await shot(page, "9-method-sources");
  await page.keyboard.press("Escape");
  await page.locator(".drawer__backdrop").waitFor({ state: "detached", timeout: 3000 });
  await page.keyboard.press("Escape");
  await page.locator(".map-about").waitFor({ state: "detached", timeout: 3000 });
  // Focus went back to "Tentang peta ini"; leave no tool focused (its tooltip would stay up for later checks).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await lightFor(page, "Otomatis");
  // Back with the keyboard, as the list checks before this one left it: later checks expect keyboard
  // focus (the map tools show their tooltips right away only then).
  await page.mouse.move(VIEW_W - 120, 90); // off the regions, so only the keyboard points
  await page.getByRole("button", { name: "Semua wilayah" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
}

/**
 * A failed recommendations request: one sentence and "Coba lagi", which then loads the items. Own page,
 * because the browser logs a failed request as a console error.
 */
async function recommendationsFailure() {
  const p = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  p.on("pageerror", (err) => errors.push(err.message));
  await p.route("**/api/recommendations/**", (route) => route.abort("failed"));
  await p.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await p.getByRole("button", { name: "Lewati intro" }).click({ timeout: 30_000 });
  await p.locator(".ui-layer").waitFor({ timeout: 40_000 });
  await p.waitForTimeout(1500);
  await pickRegionRow(p, "Balikpapan");
  const alert = p.locator(".recs [role=alert]");
  await alert.waitFor({ timeout: 10_000 });
  await p.waitForTimeout(2600);
  await scrollToRecs(p);
  check((await alert.textContent())?.includes("Rekomendasi belum bisa dimuat.") === true, "recommendations: a failed request says so and offers 'Coba lagi'");
  await shot(p, "9-recs-failure");
  await p.unroute("**/api/recommendations/**");
  await alert.getByRole("button", { name: "Coba lagi" }).click();
  await p.locator(".recs__list").waitFor({ timeout: 60_000 });
  check(true, "recommendations: 'Coba lagi' loads the items");
  check(errors.length === 0, `recommendations: no uncaught errors on the failure path (${errors.join("; ") || "none"})`);
  await p.close();
}

// ---------- Buildings (Task 7): clickable buildings, the building panel, terrain and memory at building zoom ----------

// Functions, not constants: the checks run from the main block above, before constants down here exist.

/** The basemap's buildings featureset. */
function buildingsTarget() {
  return { featuresetId: "buildings", importId: "basemap" } as const;
}
/** Over the middle of Samarinda, close enough for single buildings. */
function samarindaClose() {
  return { center: [117.1475, -0.4955] as [number, number], zoom: 16.6, pitch: 62, bearing: -24 };
}

type PickedBuilding = { id: number; x: number; y: number; area: number; lng: number; lat: number };

/**
 * Buildings on screen in the open middle of the map (clear of the panels), with the screen point of their
 * centre and their size on screen, largest first.
 */
function buildingsOnScreen(page: Page) {
  return page.evaluate(
    ([target, w, h]) => {
      const map = (window as MapWindow).__malasMap!;
      const features = map.queryRenderedFeatures(
        [
          [w * 0.32, h * 0.25],
          [w * 0.62, h * 0.65],
        ],
        { target },
      );
      const seen = new Set<unknown>();
      const out: PickedBuilding[] = [];
      for (const f of features) {
        if (f.id === undefined || seen.has(f.id) || f.geometry.type !== "Polygon") continue;
        seen.add(f.id);
        const ring = (f.geometry.coordinates[0] ?? []).slice(0, -1) as [number, number][];
        if (ring.length < 3) continue;
        const lng = ring.reduce((a, p) => a + p[0], 0) / ring.length;
        const lat = ring.reduce((a, p) => a + p[1], 0) / ring.length;
        const pts = ring.map((p) => map.project(p));
        const area = Math.abs(pts.reduce((a, p, i) => a + p.x * pts[(i + 1) % pts.length]!.y - pts[(i + 1) % pts.length]!.x * p.y, 0)) / 2;
        const c = map.project([lng, lat]);
        // The centre must hit the building itself, in front (an L-shaped building's centre may fall outside
        // it, and a taller building nearer the camera may hide it).
        const hit = map.queryRenderedFeatures(c, { target })[0]?.id === f.id;
        if (hit && area > 150) out.push({ id: Number(f.id), x: c.x, y: c.y, area, lng, lat });
      }
      out.sort((a, b) => b.area - a.area);
      return out;
    },
    [buildingsTarget(), VIEW_W, VIEW_H] as const,
  );
}

/** Feature state of a basemap building by id, and how many buildings are selected. */
function buildingState(page: Page, id: number) {
  return page.evaluate(
    ([target, id]) => {
      const map = (window as MapWindow).__malasMap!;
      const features = map.queryRenderedFeatures({ target });
      const f = features.find((g) => g.id === id);
      const selected = new Set(features.filter((g) => map.getFeatureState(g)?.select).map((g) => g.id)).size;
      return { state: f ? (map.getFeatureState(f) ?? {}) : null, selected };
    },
    [buildingsTarget(), id] as const,
  );
}

type SelectWindow = Window & { __malasSelectBuildingAt: (lngLat: [number, number], hint?: { type?: string; name?: string }) => Promise<void> };

async function panelText(page: Page) {
  return (await page.locator(".building-panel").innerText()).replace(/\s+/g, " ");
}
/** The kWh per year in the panel's readout, read back from its id-ID text ("176.352", "5,2 juta"). */
async function readoutKwh(page: Page) {
  const t = (await page.locator(".building-panel__readout .readout__figure").innerText()).trim();
  const n = Number(t.replace(/ juta$/, "").replaceAll(".", "").replace(",", "."));
  return t.endsWith("juta") ? n * 1e6 : n;
}
/** Waits for the panel's numbers (and their count-up). */
async function waitForPanelReady(page: Page) {
  await page.locator(".building-panel__readout").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1200);
}

async function buildingChecks(page: Page) {
  const terrainAt = async (zoom: number) => {
    await page.evaluate(([view, zoom]) => (window as MapWindow).__malasMap!.jumpTo({ ...view, zoom }), [samarindaClose(), zoom] as const);
    await page.waitForTimeout(300);
    return page.evaluate(() => Boolean((window as MapWindow).__malasMap!.getTerrain()));
  };
  // Terrain goes off at building zoom (memory) and comes back on the way out, with hysteresis.
  const close = await terrainAt(16.6);
  const between = await terrainAt(13);
  const out = await terrainAt(12.5);
  const backIn = await terrainAt(13);
  const inAgain = await terrainAt(13.5);
  check(
    !close && !between && out && backIn && !inAgain,
    `terrain is off at building zoom and back below zoom 12.8, with hysteresis (16.6 ${close}, 13 ${between}, 12.5 ${out}, 13 ${backIn}, 13.5 ${inAgain})`,
  );

  await page.evaluate((view) => (window as MapWindow).__malasMap!.jumpTo(view), samarindaClose());
  await waitForMapIdle(page, 15_000);
  await page.waitForTimeout(800);
  const found = await buildingsOnScreen(page);
  check(found.length >= 3, `buildings to click in the middle of Samarinda (${found.length})`);
  if (found.length < 3) return;
  const picks = [found[0]!, found[Math.floor(found.length / 2)]!, found.at(-1)!];
  // Known points for selectBuildingAt: buildings whose centre lies inside their own footprint, whether or
  // not a taller neighbour hides that point at this pitch (which is what the footprint test is for).
  const known = await knownBuildingPoints(page);
  // A spot with no building near it (a road, a field), for the "no building there" case.
  const empty = await page.evaluate(
    ([target, w, h]) => {
      const map = (window as MapWindow).__malasMap!;
      for (let y = h * 0.25; y < h * 0.75; y += 10) {
        for (let x = w * 0.3; x < w * 0.65; x += 10) {
          const box: [[number, number], [number, number]] = [
            [x - 24, y - 24],
            [x + 24, y + 24],
          ];
          if (map.queryRenderedFeatures(box, { target }).length === 0) return map.unproject([x, y]).toArray() as [number, number];
        }
      }
      return null;
    },
    [buildingsTarget(), VIEW_W, VIEW_H] as const,
  );

  // Hover lights a building.
  await page.mouse.move(picks[0]!.x, picks[0]!.y, { steps: 3 });
  await page.waitForTimeout(400);
  check((await buildingState(page, picks[0]!.id)).state?.highlight === true, "hovering a building lights it");
  await shot(page, "9-building-hover");

  // Click three buildings: each opens the panel with a type, kWh and "perkiraan", and only it is selected.
  const kinds: string[] = [];
  for (const [i, b] of picks.entries()) {
    await page.mouse.click(b.x, b.y);
    await waitForPanelReady(page);
    const t = await panelText(page);
    const kwh = await readoutKwh(page);
    const sel = await buildingState(page, b.id);
    const kind = (await page.locator(".building-type__trigger").innerText()).trim();
    kinds.push(kind);
    check(
      kwh > 0 && /kWh per tahun, perkiraan/.test(t) && !/NaN|undefined/.test(t),
      `building ${i + 1} (${Math.round(b.area)} px on screen): the panel shows a ${kind}, ${kwh} kWh per tahun, perkiraan`,
    );
    check(sel.state?.select === true && sel.selected === 1, `building ${i + 1} is the one selected building on the map (${sel.selected} selected)`);
    if (i === 0) {
      await page.mouse.move(VIEW_W * 0.45, 12);
      await page.waitForTimeout(400);
      await shot(page, "9-building-energi");
      await screen(page, "building.png");
      // The selection stays clear by day and by night (its colours follow the ground tone).
      const colours: string[] = [];
      for (const light of ["Siang", "Malam", "Otomatis"]) {
        await openDock(page);
        await page.getByRole("radio", { name: light }).click();
        await waitForMapIdle(page, 12_000);
        await page.waitForTimeout(600);
        colours.push(await page.evaluate(() => String((window as MapWindow).__malasMap!.getConfigProperty("basemap", "colorBuildingSelect"))));
        if (light !== "Otomatis") await shot(page, `9-building-${light.toLowerCase()}`);
      }
      const still = await buildingState(page, b.id);
      check(colours[0] !== colours[1] && still.state?.select === true, `the selection colour follows the light (Siang ${colours[0]}, Malam ${colours[1]}) and the building stays selected`);
    }
  }
  console.log(`  clicked buildings: ${kinds.join(", ")}`);

  // The panel clears the dock and the map tools.
  const layout = await page.evaluate(() => {
    const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    return { panel: r(".building-panel"), dockTop: r(".dock-slot").top, toolsLeft: r(".map-tools").left };
  });
  check(
    layout.panel.bottom <= layout.dockTop + 0.5 && layout.panel.right <= layout.toolsLeft,
    `the building panel clears the dock (bottom ${Math.round(layout.panel.bottom)} ≤ ${Math.round(layout.dockTop)}) and the map tools (right ${Math.round(layout.panel.right)} ≤ ${Math.round(layout.toolsLeft)})`,
  );

  // Override the type and the floors: the numbers follow.
  const before = await readoutKwh(page);
  const current = (await page.locator(".building-type__trigger").innerText()).trim();
  const other = current === "Mal" ? "Rumah" : "Mal";
  await page.locator(".building-type__trigger").click();
  await page.getByRole("option", { name: other, exact: true }).click();
  await page.waitForTimeout(1800);
  const typed = await readoutKwh(page);
  const typedText = await panelText(page);
  const typedKind = (await page.locator(".building-type__trigger").innerText()).trim();
  check(
    typed !== before && typedKind === other && typedText.includes("Jenis pilihan Anda."),
    `choosing "${other}" re-estimates (${before} → ${typed} kWh per tahun)`,
  );
  await page.getByRole("button", { name: "Tambah lantai" }).click();
  await page.waitForTimeout(1800);
  const floored = await readoutKwh(page);
  check(floored > typed, `one more floor raises the estimate (${typed} → ${floored} kWh per tahun)`);

  // Emisi: CO2, the grid mix and the equivalents.
  await page.getByRole("tab", { name: "Emisi" }).click();
  await page.waitForTimeout(1200);
  const emisi = await panelText(page);
  const rows = await page.locator(".building-panel .equivalents__row").count();
  check(/(ton|kg) CO2 per tahun, perkiraan/.test(emisi) && emisi.includes("Batu bara") && rows >= 3, `Emisi shows the CO2, the grid mix by fuel and ${rows} equivalents`);
  await shot(page, "9-building-emisi");
  await page.getByRole("tab", { name: "Energi" }).click();

  // Clicking the open building again keeps it (no reload, the user's changes stay), and leaves the
  // keyboard on the map, where Escape closes the panel and clears the selection.
  const kept = await readoutKwh(page);
  await page.mouse.click(picks.at(-1)!.x, picks.at(-1)!.y);
  await page.waitForTimeout(300);
  const reloaded = await page.locator(".building-skeleton").count();
  check(reloaded === 0 && (await readoutKwh(page)) === kept, `clicking the open building again keeps it and the user's changes (${kept} kWh per tahun)`);
  await page.keyboard.press("Escape");
  await page.locator(".building-panel").waitFor({ state: "detached", timeout: 3000 });
  check((await buildingState(page, picks.at(-1)!.id)).selected === 0, "Escape on the map closes the panel and clears the selection");

  // The chat's select building action, from the province view: fly in, select, open.
  await page.evaluate((view) => (window as MapWindow).__malasMap!.jumpTo(view), KALTIM_VIEW);
  await page.waitForTimeout(600);
  const target = picks[1]!;
  await page.evaluate(([lng, lat]) => (window as unknown as SelectWindow).__malasSelectBuildingAt([lng, lat]), [target.lng, target.lat] as const);
  await waitForPanelReady(page);
  const landed = await page.evaluate(() => (window as MapWindow).__malasMap!.getZoom());
  const chosen = await buildingState(page, target.id);
  check(Math.abs(landed - 17.5) < 0.05 && chosen.state?.select === true, `selectBuildingAt flies in (zoom ${landed.toFixed(2)}) and selects that building`);
  await shot(page, "9-building-chat");
  // The close button gives the keyboard back to the map.
  await page.locator(".building-panel__close").click();
  await page.locator(".building-panel").waitFor({ state: "detached", timeout: 3000 });
  const focus = await page.evaluate(() => document.activeElement?.classList.contains("mapboxgl-canvas") === true);
  check(focus, "closing the panel puts the keyboard focus back on the map");

  // Known points: each selects the building whose footprint holds it.
  const hits: string[] = [];
  for (const k of known) {
    await page.evaluate((view) => (window as MapWindow).__malasMap!.jumpTo(view), KALTIM_VIEW);
    await page.evaluate(([lng, lat]) => (window as unknown as SelectWindow).__malasSelectBuildingAt([lng, lat]), [k.lng, k.lat] as const);
    const got = await buildingState(page, k.id);
    hits.push(got.state?.select === true && got.selected === 1 ? "ok" : `miss ${k.id}`);
  }
  check(known.length >= 4 && hits.every((h) => h === "ok"), `selectBuildingAt picks the building under each of ${known.length} known points (${hits.join(", ")})`);

  // A place-search hint names the place and gives the type when no POI sits at the building.
  await page.evaluate(
    ([lng, lat]) => (window as unknown as SelectWindow).__malasSelectBuildingAt([lng, lat], { type: "sekolah", name: "Sekolah uji smoke" }),
    [picks[2]!.lng, picks[2]!.lat] as const,
  );
  await waitForPanelReady(page);
  const hinted = await panelText(page);
  const named = await page.locator(".building-panel__name").innerText().catch(() => "");
  check(named === "Sekolah uji smoke" && hinted.includes("Jenis dari data tempat di peta."), `a place-search hint names the place and types it (${named}, ${(await page.locator(".building-type__trigger").innerText()).trim()})`);
  await shot(page, "9-building-hint");

  // A point with no building says so instead of showing a blank panel.
  if (empty) {
    await page.evaluate((p) => (window as unknown as SelectWindow).__malasSelectBuildingAt(p), empty);
    const none = await page.locator(".building-panel").getByText("Gedung tidak ditemukan").isVisible();
    check(none, `selectBuildingAt where there is no building says so (${empty.map((v) => v.toFixed(4)).join(", ")})`);
    await shot(page, "9-building-none");
    // A click on empty ground at building zoom closes the panel.
    const spot = await page.evaluate((p) => (window as MapWindow).__malasMap!.project(p), empty);
    await page.mouse.click(spot.x, spot.y);
    await page.locator(".building-panel").waitFor({ state: "detached", timeout: 3000 });
    check(true, "a click on empty ground at building zoom closes the panel");
  } else {
    check(false, "a spot with no building near it in the middle of Samarinda");
    await page.locator(".building-panel__close").click();
    await page.locator(".building-panel").waitFor({ state: "detached", timeout: 3000 });
  }
}

/** Up to six buildings on screen whose centre lies inside their own footprint, spread over sizes. */
function knownBuildingPoints(page: Page) {
  return page.evaluate(
    ([target, w, h]) => {
      const map = (window as MapWindow).__malasMap!;
      const inside = (pt: [number, number], ring: [number, number][]) => {
        let c = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i]!;
          const [xj, yj] = ring[j]!;
          if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
        }
        return c;
      };
      const features = map.queryRenderedFeatures(
        [
          [w * 0.35, h * 0.3],
          [w * 0.6, h * 0.6],
        ],
        { target },
      );
      const seen = new Set<unknown>();
      const out: { id: number; lng: number; lat: number }[] = [];
      for (const f of features) {
        if (f.id === undefined || seen.has(f.id) || f.geometry.type !== "Polygon") continue;
        seen.add(f.id);
        const ring = f.geometry.coordinates[0] as [number, number][];
        const pts = ring.slice(0, -1);
        const c: [number, number] = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
        if (inside(c, ring)) out.push({ id: Number(f.id), lng: c[0], lat: c[1] });
      }
      const step = Math.max(1, Math.floor(out.length / 6));
      return out.filter((_, i) => i % step === 0).slice(0, 6);
    },
    [buildingsTarget(), VIEW_W, VIEW_H] as const,
  );
}

/**
 * Pans and zooms around Samarinda at building zoom for about a minute and checks the page's JS heap stays
 * bounded. This is the JS heap only: the renderer and GPU processes (about 2 GB together at building zoom,
 * flat, measured in the Task 7 review; terrain off saves about 150 MB of it) are not visible from here.
 */
async function buildingHeapSoak(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const heapMb = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    return (metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0) / 1e6;
  };
  await page.evaluate((view) => (window as MapWindow).__malasMap!.jumpTo(view), samarindaClose());
  await waitForMapIdle(page, 15_000);
  const start = await heapMb();
  const SOAK_MS = 60_000;
  const t0 = Date.now();
  let peak = start;
  let step = 0;
  while (Date.now() - t0 < SOAK_MS) {
    const a = step * 0.9;
    const move = [117.1475 + 0.012 * Math.cos(a), -0.4955 + 0.012 * Math.sin(a), 15 + (step % 4) * 0.8, -24 + (step % 7) * 12] as const;
    await page.evaluate(
      ([lng, lat, zoom, bearing]) =>
        new Promise<void>((resolve) => {
          const map = (window as MapWindow).__malasMap!;
          map.once("moveend", () => resolve());
          map.easeTo({ center: [lng, lat], zoom, bearing, pitch: 60, duration: 1500 });
        }),
      move,
    );
    if (step % 5 === 4) peak = Math.max(peak, await heapMb());
    step++;
  }
  await waitForMapIdle(page, 15_000);
  const end = await heapMb();
  peak = Math.max(peak, end);
  const terrain = await page.evaluate(() => Boolean((window as MapWindow).__malasMap!.getTerrain()));
  check(
    end < 400 && end - start < 150 && !terrain,
    `JS heap soak (not GPU or renderer memory): ${step} moves at building zoom over ${Math.round((Date.now() - t0) / 1000)} s, JS heap ${start.toFixed(0)} → ${end.toFixed(0)} MB (peak ${peak.toFixed(0)} MB), terrain ${terrain ? "on" : "off"}`,
  );
  await cdp.detach();
}

/**
 * The AI chat (Task 8b), with canned answers so the check spends no tokens: the button opens the panel with
 * the suggested questions; an answer streams in, its map actions move the map and show as buttons; the
 * panel covers no dock card, not the map tools and not the building panel; an error stays in view with
 * "Coba lagi"; with the region already open the chat still selects the building; Escape closes the panel,
 * gives focus back and keeps the draft. Leaves the province view as it found it.
 */
async function chatChecks(page: Page) {
  const sse = (events: [string, unknown][]) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
  /** The panels the chat panel must never cover: the dock cards, the map tools and the building panel. */
  const chatOverlaps = () =>
    page.evaluate((panels) => {
      const p = document.querySelector(".chat__card")!.getBoundingClientRect();
      return panels.filter((sel) => {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        return Boolean(r && r.width > 0 && r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top);
      });
    }, [...DOCK_CARDS, ".map-tools", ".building-slot__panel"]);
  /** Every map tool can be pressed: the element at its centre is the tool itself. */
  const toolsReachable = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".map-tools .map-tool")].every((tool) => {
        const r = tool.getBoundingClientRect();
        return tool.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      }),
    );
  const reply = (body: string) => (route: import("playwright").Route) =>
    route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body });
  await page.evaluate((view) => (window as MapWindow).__malasMap!.jumpTo(view), KALTIM_VIEW);
  await waitForMapIdle(page, 12_000);

  const launcher = page.getByRole("button", { name: "Asisten AI", exact: true });
  check(await launcher.isVisible(), "the chat button sits in the bottom-right corner");
  await launcher.click();
  check((await launcher.getAttribute("aria-expanded")) === "true", "the chat button says the panel is open");
  const panel = page.getByRole("region", { name: "Asisten AI" });
  await panel.waitFor({ timeout: 3000 });
  const prompts = await panel.locator(".chat__prompt").count();
  check(prompts === 4, `the empty chat offers the 4 suggested questions (${prompts})`);
  await page.waitForTimeout(400); // the panel finishes sliding in
  const emptyOverlaps = await chatOverlaps();
  check(emptyOverlaps.length === 0, `the empty chat panel covers no dock card and not the map tools (${emptyOverlaps.join(", ") || "none"})`);
  check(await toolsReachable(), "every map tool can still be pressed while the chat is open");
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  check(focused === "Pertanyaan untuk asisten AI", `opening the chat puts the cursor in the question box (${focused})`);

  await page.route(
    "**/api/chat",
    reply(
      sse([
        ["action", { name: "set_metric", input: { metric: "kwh" } }],
        ["action", { name: "fly_to_region", input: { region: "samarinda" } }],
        ["text", { delta: "**Samarinda** emisinya paling tinggi, sekitar 1,6 juta ton CO2 per tahun (perkiraan).\n\n" }],
        ["text", { delta: "Berikutnya:\n- Kutai Kartanegara\n- Balikpapan" }],
        ["done", {}],
      ]),
    ),
  );
  await panel.getByRole("button", { name: "Wilayah mana emisinya paling tinggi?" }).click();
  await panel.locator(".chat-chip").first().waitFor({ timeout: 5000 });
  const answer = (await panel.locator(".chat-msg--ai").last().textContent()) ?? "";
  check(answer.includes("Samarinda emisinya paling tinggi") && !answer.includes("**"), "the answer streams in as formatted text");
  check((await panel.locator(".chat-msg--ai li").count()) === 2, "the answer's list renders as a list");
  const chips = await panel.locator(".chat-chip").allTextContents();
  check(chips.join("|") === "Warna menurut listrik|Samarinda", `the map actions show as buttons under the answer (${chips.join(", ")})`);
  await page.getByRole("button", { name: "Semua wilayah" }).waitFor({ timeout: 5000 }).catch(() => {});
  check(await page.getByRole("button", { name: "Semua wilayah" }).isVisible(), "fly_to_region selects the region (the region detail opens)");
  check((await page.getByRole("radio", { name: "Listrik" }).getAttribute("aria-checked")) === "true", "set_metric switches the columns to kWh");
  await page.waitForTimeout(2200);
  await waitForMapIdle(page, 12_000);
  await regionClearOfChrome(page, "samarinda", [".chat__card"]);
  await shot(page, "9-chat-answer");
  const answerOverlaps = await chatOverlaps();
  check(answerOverlaps.length === 0, `with an answer, the chat panel covers no dock card and not the map tools (${answerOverlaps.join(", ") || "none"})`);

  // A failed answer: the reason and "Coba lagi" scroll into view.
  await page.unroute("**/api/chat");
  await page.route("**/api/chat", reply(sse([["error", { message: "Asisten AI sedang sibuk. Coba lagi sebentar lagi." }]])));
  await panel.getByRole("textbox", { name: "Pertanyaan untuk asisten AI" }).fill("Bandingkan emisi Samarinda dan Balikpapan");
  await page.keyboard.press("Enter");
  const problem = panel.getByRole("alert");
  await problem.waitFor({ timeout: 5000 });
  check(((await problem.textContent()) ?? "").includes("sibuk"), "a failed answer says why and offers 'Coba lagi'");
  await page.waitForTimeout(300);
  const retryInView = await page.evaluate(() => {
    const log = document.querySelector(".chat__log")!.getBoundingClientRect();
    const alert = document.querySelector(".chat-msg__problem[role='alert']")!.getBoundingClientRect();
    return alert.top >= log.top - 1 && alert.bottom <= log.bottom + 1;
  });
  check(retryInView, "the error line and its 'Coba lagi' are fully in view");
  await shot(page, "9-chat-error");
  await page.unroute("**/api/chat");

  // The review's path: Samarinda is already open, then the chat picks a school there. It must end on the
  // building, never on "Gedung tidak ditemukan", and the button may only say what happened.
  const school = { name: "Sekolah uji", lng: 117.161276, lat: -0.50273, type: "sekolah" };
  await page.route(
    "**/api/chat",
    reply(
      sse([
        ["action", { name: "fly_to_region", input: { region: "samarinda" } }],
        ["action", { name: "mark_places", input: { label: "sekolah", places: [school] } }],
        ["action", { name: "select_building_at", input: { lng: school.lng, lat: school.lat } }],
        ["text", { delta: "Ini sekolahnya." }],
        ["done", {}],
      ]),
    ),
  );
  await panel.getByRole("textbox", { name: "Pertanyaan untuk asisten AI" }).fill("Tunjukkan gedung sekolah di Samarinda");
  await page.keyboard.press("Enter");
  const settled = await page
    .waitForFunction(
      () => {
        const answers = document.querySelectorAll(".chat-msg--ai");
        const chips = [...(answers[answers.length - 1]?.querySelectorAll(".chat-chip") ?? [])].map((c) => c.textContent ?? "");
        return chips.some((c) => c.includes("Gedung dipilih") || c.includes("Gedung tidak ditemukan")) ? chips : null;
      },
      null,
      { timeout: 25_000 },
    )
    .then((h) => h.jsonValue() as Promise<string[]>)
    .catch(() => [] as string[]);
  await page.waitForTimeout(2500); // the estimate arrives and the camera settles
  const buildingText = (await page.locator(".building-panel").textContent().catch(() => "")) ?? "";
  check(
    settled.some((c) => c.includes("Gedung dipilih")) && buildingText.length > 0 && !buildingText.includes("Gedung tidak ditemukan"),
    `with the region already open, the chat selects the school's building (buttons: ${settled.join(", ") || "none"})`,
  );
  const besideOverlaps = await chatOverlaps();
  check(besideOverlaps.length === 0, `beside the building panel the chat covers nothing (${besideOverlaps.join(", ") || "none"})`);
  check(await toolsReachable(), "with the building panel and the chat open, every map tool can still be pressed");
  await shot(page, "9-chat-building");
  await page.unroute("**/api/chat");
  await page.getByRole("button", { name: "Tutup panel gedung" }).click().catch(() => {});

  // Region and province flights frame what they show clear of the open chat (final review, Important 3):
  // Berau lies on the east coast, under the chat column; "semua wilayah" puts the east of the province there.
  const askAndSettle = async (question: string, action: { name: string; input: Record<string, unknown> }) => {
    await page.route("**/api/chat", reply(sse([["action", action], ["text", { delta: "Sudah saya tampilkan di peta." }], ["done", {}]])));
    const before = await panel.locator(".chat-msg--ai").count();
    await panel.getByRole("textbox", { name: "Pertanyaan untuk asisten AI" }).fill(question);
    await page.keyboard.press("Enter");
    await page.waitForFunction((n) => document.querySelectorAll(".chat-msg--ai").length > n, before, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2600); // the region detail loads, then the 2 s flight
    await waitForMapIdle(page, 12_000);
    await page.unroute("**/api/chat");
  };
  await askAndSettle("Tunjukkan Berau", { name: "fly_to_region", input: { region: "berau" } });
  await regionClearOfChrome(page, "berau", [".chat__card"]);
  await shot(page, "9-chat-region");
  await askAndSettle("Bandingkan emisi semua wilayah", { name: "show_all_regions", input: {} });
  await regionClearOfChrome(page, "*", [".chat__card"]);
  await shot(page, "9-chat-province");

  await panel.getByRole("textbox", { name: "Pertanyaan untuk asisten AI" }).fill("Draf yang belum dikirim");
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  check(!(await panel.isVisible()), "Escape closes the chat");
  const back = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  check(back === "Asisten AI", `closing the chat gives focus back to its button (${back})`);
  await launcher.click();
  const draft = await panel.getByRole("textbox", { name: "Pertanyaan untuk asisten AI" }).inputValue();
  check(draft === "Draf yang belum dikirim", "a half-written question survives closing and opening the chat");
  await launcher.click();

  // Leave the province view as the next checks expect it.
  await page.getByRole("radio", { name: "Emisi CO2" }).click();
  const allRegions = page.getByRole("button", { name: "Semua wilayah" });
  if (await allRegions.isVisible()) await allRegions.click();
  await page.evaluate((view) => (window as MapWindow).__malasMap!.jumpTo(view), KALTIM_VIEW);
  await waitForMapIdle(page, 12_000);
  await page.evaluate(() => localStorage.removeItem("malas-ngoding.chat"));
}
