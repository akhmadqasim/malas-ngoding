/**
 * Browser smoke check of the running app. Start `bun dev` first, then run `bun run smoke`.
 *
 * It opens the app in Chromium, lets the intro play, checks the regions, plants, layout, the hover
 * preview, click, metric switch, the rain reveal and overcast tint at building zoom, the Cahaya light
 * switch and the "Coba lagi" failure path, and exits non-zero on any failed check, console error or
 * console warning (known Mapbox warnings are listed, not counted).
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
import { lightPresetFor } from "../src/web/map/effects.ts";

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
  await page.waitForTimeout(3000);
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

  // Layout: both panels inside the viewport, no overlap, nothing cut off, right edge free for the chat button.
  const layout = await page.evaluate(() => {
    const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    const legend = document.querySelector<HTMLElement>(".legend")!;
    const sheet = box(".sheet");
    const leg = box(".legend");
    return {
      sheet: { left: sheet.left, right: sheet.right, top: sheet.top, bottom: sheet.bottom },
      legend: { left: leg.left, right: leg.right, top: leg.top, bottom: leg.bottom },
      legendOverflow: legend.scrollWidth - legend.clientWidth,
      sheetScroll: (() => {
        const el = document.querySelector<HTMLElement>(".sheet__scroll")!;
        return el.scrollHeight - el.clientHeight;
      })(),
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
  const { sheet, legend, vw, vh } = layout;
  check(sheet.left >= 0 && sheet.top >= 0 && sheet.bottom <= vh - 30, `region sheet fits the viewport (bottom ${Math.round(sheet.bottom)} of ${vh})`);
  check(legend.left > sheet.right || legend.top > sheet.bottom, "legend does not overlap the region sheet");
  check(legend.right <= vw - 80 && legend.bottom <= vh, `legend leaves the right edge free (right ${Math.round(legend.right)} of ${vw})`);
  check(layout.legendOverflow <= 1, `legend content does not overflow (by ${layout.legendOverflow}px)`);
  check(layout.sheetScroll <= 1, `all ten regions fit in the sheet without scrolling (hidden ${layout.sheetScroll}px)`);
  await shot(page, "2-overview");
  await screen(page, "map.png");

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
  check((await page.locator(".meter__name").textContent()) === "Paser", "the legend needle reads the hovered region");
  const hover = await mapState(page);
  check(hover.paser.hover === true && hover.samarinda.recede === true && hover.paser.recede === false, "hover lifts the region and the others recede");
  await shot(page, "3-hover");
  await page.mouse.click(point.x, point.y - 20);
  await page.getByRole("button", { name: "Semua wilayah" }).waitFor({ timeout: 5000 });
  check(true, "clicking a region opens its detail panel");
  await page.waitForTimeout(2600);
  await waitForMapIdle(page);
  await shot(page, "4-region");

  await page.getByRole("radio", { name: "Listrik" }).click();
  await page.waitForTimeout(1800);
  check((await page.locator(".meter__unit").textContent())?.startsWith("kWh per tahun") === true, "the legend follows the kWh metric");
  await shot(page, "5-kwh");
  await page.getByRole("radio", { name: "Emisi CO2" }).click();
  await page.getByRole("button", { name: "Semua wilayah" }).click();
  await page.waitForTimeout(400);
  check((await mapState(page)).samarinda.recede !== true, "nothing recedes once the pointer has left the regions");
  await page.waitForTimeout(2600);
  await waitForMapIdle(page);
  await shot(page, "6-back");

  // Rain: switched on at the province view it stays invisible (density 0) and the legend explains why.
  await page.getByRole("switch", { name: "Hujan" }).click();
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
  check(day.preset === "day" && day.theme === "monochrome", `Siang: day light on the neutral basemap (${day.preset}, ${day.theme})`);
  check(day.haze && !night.haze, "Siang: the rain falls through a haze inside the map; Malam: no haze");
  check(day.rainColor !== night.rainColor, "Siang and Malam use their own drop colour");
  await shot(page, "7-rain-siang");
  const auto = await lightTo("Otomatis");
  check(auto.preset === lightPresetFor(new Date()), `Otomatis follows WITA time (${auto.preset})`);
  await page.getByRole("switch", { name: "Hujan" }).click();
  await page.waitForTimeout(300);
  check(!(await mapState(page)).haze, "switching the rain off clears the haze");
  // Close it so its idle orbit does not keep streaming city tiles in the background during the next check.
  await page.close();

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
