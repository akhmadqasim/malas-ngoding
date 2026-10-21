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
import { basemapLight, lightPresetFor } from "../src/web/map/effects.ts";
import { GLOBE_LABEL_ZOOM, LANDED_LABEL_ZOOM } from "../src/web/map/regionLabels.ts";

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
async function flipSwitch(page: Page, name: string) {
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
 * cards or the map tools (fix round 1, Important 5).
 */
async function regionClearOfChrome(page: Page, id: string) {
  const covered = await page.evaluate(async (id) => {
    const map = (window as MapWindow).__malasMap!;
    const fc = (await (await fetch("/api/regions")).json()) as { features: { properties: { id: string }; geometry: { type: string; coordinates: unknown } }[] };
    const g = fc.features.find((f) => f.properties.id === id)!.geometry;
    const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as number[][][][];
    const rects = [".sheet", ".legend", ".controls", ".map-tools"].flatMap((sel) => {
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
  }, id);
  check(covered.hits === 0, `the selected ${id} is framed clear of the sheet, dock and tools (${covered.hits} of ${covered.total} outline points covered${covered.where ? ` by ${covered.where}` : ""})`);
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

const browser = await launchBrowser();

try {
  console.log(`viewport ${VIEW_W}x${VIEW_H}`);
  const page = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1 });
  listen(page, consoleProblems);

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
    const plants = map?.queryRenderedFeatures({ layers: ["plants"] }) ?? [];
    return { regions: ids.size, plants: plants.length };
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

  // Layout: the sheet and every card of the bottom dock inside the viewport, none overlapping another, nothing
  // cut off, the right edge free for the chat button.
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
      sheetScroll: (() => {
        const el = document.querySelector<HTMLElement>(".sheet__scroll")!;
        return el.scrollHeight - el.clientHeight;
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
  check(layout.sheetScroll <= 1, `all ten regions fit in the sheet without scrolling (hidden ${layout.sheetScroll}px)`);
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

  // Plants: a dot's tooltip names the plant, its fuel and its capacity; plants that would overlap on screen
  // merge into one marker whose tooltip lists them all.
  await page.keyboard.press("Shift");
  await page.evaluate((view) => (window as MapWindow).__malasMap!.jumpTo(view), KALTIM_VIEW);
  await waitForMapIdle(page);
  await page.waitForTimeout(800);
  const markers = await page.evaluate(() => {
    const map = (window as MapWindow).__malasMap!;
    type Marker = { geometry: { coordinates: [number, number] }; properties: Record<string, unknown> };
    const at = (f: Marker) => map.project(f.geometry.coordinates);
    // Markers fade in and out by zoom (plantGroups.ts); only one fully shown at this zoom counts.
    const z = map.getZoom();
    const full = (f: Marker) => Number(f.properties.appear) + 0.5 <= z && z <= Number(f.properties.split) - 0.5;
    const pick = (layer: string) => (map.queryRenderedFeatures({ layers: [layer] }) as unknown as Marker[]).find(full);
    const one = pick("plants");
    const many = pick("plant-clusters");
    return {
      one: one && { ...at(one), name: String(one.properties.name) },
      many: many && { ...at(many), count: Number(many.properties.count) },
    };
  });
  if (markers.one) {
    await page.mouse.move(markers.one.x, markers.one.y, { steps: 3 });
    await page.waitForTimeout(500);
    const text = (await page.locator(".map-popup").textContent()) ?? "";
    check(text.includes(markers.one.name) && /\d MW/.test(text) && /Batu bara|Gas|Surya|Diesel|Air|Biomassa|Lainnya/.test(text), `hovering a plant shows its name, fuel and MW (${text.replace(/\s+/g, " ").trim().slice(0, 80)})`);
  } else check(false, "a single plant marker is on screen at the province view");
  if (markers.many) {
    await page.mouse.move(markers.many.x, markers.many.y, { steps: 3 });
    await page.waitForTimeout(600);
    const listed = await page.locator(".map-popup .plant-list li").count();
    check(listed === markers.many.count && markers.many.count > 1, `a cluster's tooltip lists all ${markers.many.count} of its plants (listed ${listed})`);
  } else check(false, "overlapping plants merge into a cluster marker at the province view");
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
