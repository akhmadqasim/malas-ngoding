/**
 * Browser smoke check of the running app. Start `bun dev` first, then run `bun scripts/smoke.ts`.
 *
 * It opens the app in Chromium, lets the intro play, waits for the map to go idle, hovers and clicks
 * a region, saves `docs/technical/screens/map.png`, and exits non-zero on any console error.
 *
 * Options (env): BASE_URL (default http://localhost:3000), SMOKE_HEADED=1 to watch it,
 * SMOKE_SHOTS=<dir> to also save the intermediate screenshots, CHROMIUM_PATH to pick a browser.
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

const BASE_URL = Bun.env.BASE_URL ?? "http://localhost:3000";
const OUT = "docs/technical/screens/map.png";
const SHOTS = Bun.env.SMOKE_SHOTS;

/** Newest Chromium already installed by Playwright, so the check never has to download a browser. */
function findChromium(): string | undefined {
  if (Bun.env.CHROMIUM_PATH) return Bun.env.CHROMIUM_PATH;
  const root = join(Bun.env.LOCALAPPDATA ?? join(Bun.env.HOME ?? "", ".cache"), "ms-playwright");
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    for (const exe of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const p = join(root, d, exe);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** Resolves once the map has no pending tiles or camera moves. */
const waitForMapIdle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const map = (window as unknown as { __malasMap?: import("mapbox-gl").Map }).__malasMap;
        if (!map) return resolve();
        if (map.loaded() && !map.isMoving()) return resolve();
        map.once("idle", () => resolve());
      }),
  );

const failures: string[] = [];
const consoleErrors: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch({
  executablePath: findChromium(),
  headless: !Bun.env.SMOKE_HEADED,
  // Hardware WebGL by default; SMOKE_GL=swiftshader forces software rendering (slow, but works without a GPU).
  args:
    Bun.env.SMOKE_GL === "swiftshader"
      ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
      : ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=default"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

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

  const columns = await page.evaluate(() => {
    const map = (window as unknown as { __malasMap?: import("mapbox-gl").Map }).__malasMap;
    const feats = map?.queryRenderedFeatures({ layers: ["regions-extrusion"] }) ?? [];
    const ids = new Set(feats.map((f) => (f as unknown as { properties?: { id?: string } }).properties?.id));
    const plants = map?.queryRenderedFeatures({ layers: ["plants"] }) ?? [];
    return { regions: ids.size, plants: plants.length };
  });
  check(columns.regions === 10, `10 regions rendered (got ${columns.regions})`);
  check(columns.plants > 0, `plants rendered (got ${columns.plants})`);
  await shot(page, "2-overview");

  mkdirSync("docs/technical/screens", { recursive: true });
  await page.screenshot({ path: OUT });
  console.log(`saved ${OUT}`);

  // Hover and click Paser through the map, not the panel. It is the southernmost region, so no other
  // column stands in front of it, and it has no power plant marker on top.
  const point = await page.evaluate(() => {
    const map = (window as unknown as { __malasMap?: import("mapbox-gl").Map }).__malasMap!;
    const p = map.project([116.05, -1.75]);
    return { x: p.x, y: p.y };
  });
  await page.mouse.move(point.x, point.y - 20, { steps: 4 });
  await page.waitForTimeout(500);
  const tooltip = await page.locator(".map-tooltip").isVisible();
  check(tooltip, "hovering a region shows its tooltip");
  await page.mouse.click(point.x, point.y - 20);
  await page.getByRole("button", { name: "Semua wilayah" }).waitFor({ timeout: 5000 });
  check(true, "clicking a region opens its detail panel");
  await page.waitForTimeout(2800);
  await waitForMapIdle(page);
  await shot(page, "3-region");

  await page.getByRole("radio", { name: "Listrik" }).click();
  await page.waitForTimeout(1800);
  await shot(page, "4-kwh");
  await page.getByRole("button", { name: "Semua wilayah" }).click();
  await page.waitForTimeout(2600);
  await shot(page, "5-back");
} catch (err) {
  failures.push(err instanceof Error ? err.message : String(err));
  console.error(err);
} finally {
  await browser.close();
}

if (consoleErrors.length) {
  console.log("\nConsole errors:");
  for (const e of consoleErrors) console.log(`  ${e}`);
}
const failed = failures.length > 0 || consoleErrors.length > 0;
console.log(failed ? `\nSMOKE FAILED (${failures.length} checks, ${consoleErrors.length} console errors)` : "\nSMOKE PASSED");
process.exit(failed ? 1 : 0);
