/**
 * Browser check of the Surya and Cuaca tabs through the dev-only harness (scripts/tabs-harness), until the
 * building panel mounts them in the app. Start the app first (`bun dev`), then
 * `BASE_URL=http://localhost:<PORT> bun scripts/tabs-check.ts`.
 *
 * It renders both tabs for a fixture building at 1366x768 and 1600x900, by day and by night, and checks:
 * the simulation shows, the numbers count smoothly when the backup slider moves, a smaller roof gives fewer
 * kWp, the Cuaca tab forecasts the same panels, the hourly chart reads out the hour under the pointer, rain
 * hours are shaded and a rainy day says how much it costs, and both tabs recover from a failed request
 * with "Coba lagi". Exits non-zero on a failed check or any console error or warning.
 *
 * Options (env): BASE_URL (default http://localhost:3000), TABS_SHOTS (default .superpowers/shots/solar-weather-tabs),
 * TABS_SCREENSHOT=1 also writes docs/technical/screens/solar.png.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page, Route } from "playwright";
import { launchBrowser } from "./chromium.ts";
import { startHarness } from "./tabs-harness/server.ts";

const BASE_URL = Bun.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = Bun.env.TABS_SHOTS ?? ".superpowers/shots/solar-weather-tabs";
const VIEWPORTS = [
  [1366, 768],
  [1600, 900],
] as const;

const failures: string[] = [];
const consoleProblems: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const harness = startHarness(0, BASE_URL);
const HARNESS = harness.url.href.replace(/\/$/, "");
mkdirSync(SHOTS, { recursive: true });
const browser = await launchBrowser();

async function open(theme: "day" | "night", tab: "surya" | "cuaca", size: readonly [number, number] = [1600, 900], type = "kantor"): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") consoleProblems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => consoleProblems.push(`pageerror: ${err.message}`));
  await page.goto(`${HARNESS}/?theme=${theme}&tab=${tab}&type=${type}`);
  return page;
}

/** The value text of a fact row in the Surya tab, by its label. */
const fact = (page: Page, label: string) =>
  page.locator(".sw-fact", { has: page.locator(".sw-fact__label", { hasText: label }) }).locator(".sw-fact__number").textContent();
/** "1.234,5" to 1234.5 (the first number in a text). */
const num = (text: string | null) => Number((text ?? "").match(/[\d.]+(,\d+)?/)?.[0]?.replaceAll(".", "").replace(",", ".") ?? Number.NaN);

/** Waits for the Surya numbers to settle (the count-up takes 0.9 s). */
const settle = (page: Page) => page.waitForTimeout(1300);

async function shotsFor(theme: "day" | "night") {
  for (const size of VIEWPORTS) {
    for (const tab of ["surya", "cuaca"] as const) {
      const page = await open(theme, tab, size);
      await page.locator(tab === "surya" ? ".sw-cover" : ".sw-days__row").first().waitFor({ timeout: 30_000 });
      await settle(page);
      const name = `${size[0]}x${size[1]}-${theme}-${tab}`;
      await page.screenshot({ path: join(SHOTS, `${name}.png`) });
      // The lower part of the tab, scrolled inside the panel.
      await page.locator(".harness__scroll").evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(SHOTS, `${name}-bottom.png`) });
      const overflow = await page.locator(".harness__scroll").evaluate((el) => el.scrollWidth - el.clientWidth);
      check(overflow <= 0, `${name}: nothing overflows the panel sideways (by ${overflow}px)`);
      if (tab === "surya" && size[0] === 1600 && theme === "night" && Bun.env.TABS_SCREENSHOT === "1") {
        await page.locator(".harness__scroll").evaluate((el) => el.scrollTo(0, 0));
        await page.waitForTimeout(500);
        mkdirSync("docs/technical/screens", { recursive: true });
        await page.screenshot({ path: "docs/technical/screens/solar.png" });
        console.log("saved docs/technical/screens/solar.png");
      }
      await page.close();
    }
  }
}

/**
 * The Surya tab for a house, an office, a mall and a government office, by night and by day: each names its
 * own PLN tariff class and daytime share, and the ring never claims more than that share.
 */
async function typeShots() {
  const expected = {
    rumah: ["R-1/TR 1.300 VA", 40, "setiap hari"],
    kantor: ["B-2/TR", 85, "sekitar 250 hari setahun"],
    mal: ["B-3/TM", 70, "setiap hari"],
    pemerintahan: ["P-1/TR", 85, "sekitar 250 hari setahun"],
    sekolah: ["S)", 85, "sekitar 200 hari setahun"],
  } as const;
  for (const [type, [golongan, share, days]] of Object.entries(expected)) {
    for (const theme of ["night", "day"] as const) {
      const page = await open(theme, "surya", [1600, 900], type);
      await page.locator(".sw-cover").waitFor({ timeout: 30_000 });
      await settle(page);
      await page.screenshot({ path: join(SHOTS, `type-${type}-${theme}.png`) });
      const notes = (await page.locator(".sw-tab__note").allTextContents()).join(" | ");
      const cover = num(await page.locator(".sw-cover__figure").textContent());
      if (theme === "night") {
        check(notes.includes(`golongan ${golongan}`), `${type}: the tariff line names ${golongan}`);
        check(notes.includes(`${share}%`) && cover <= share, `${type}: the ring stays within the ${share}% daytime share (${cover}%)`);
        check(notes.includes("Permen ESDM 2/2024"), `${type}: says export earns nothing`);
        check(notes.includes(days), `${type}: names its operating days (${days})`);
        if (type === "sekolah") check(cover < 60, `sekolah: open about 200 days, so the ring shows about half, not 85% (${cover}%)`);
      }
      await page.locator(".harness__scroll").evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(SHOTS, `type-${type}-${theme}-bottom.png`) });
      await page.close();
    }
  }
}

/** A forecast with rain on the second afternoon, built from the real answer so the times are current. */
async function rainyForecast(route: Route) {
  const res = await route.fetch();
  const body = (await res.json()) as {
    hours: { time: string; precipMm: number; weatherCode: number; pvKwh: number; ghiWm2: number; cloudPct: number }[];
    days: { date: string; pvKwh: number; rainy: boolean; maxPrecipMm: number }[];
    current: { raining: boolean };
  };
  const wetDate = body.days[1]!.date;
  const isWet = (t: string) => t.startsWith(wetDate) && Number(t.slice(11, 13)) >= 11;
  for (const h of body.hours) {
    if (isWet(h.time)) Object.assign(h, { precipMm: 4, weatherCode: 63, cloudPct: 100, pvKwh: h.pvKwh * 0.2, ghiWm2: h.ghiWm2 * 0.2 });
    else Object.assign(h, { precipMm: 0, weatherCode: 1 });
  }
  body.days = body.days.map((d) => {
    const hours = body.hours.filter((h) => h.time.startsWith(d.date));
    return { ...d, pvKwh: hours.reduce((s, h) => s + h.pvKwh, 0), rainy: d.date === wetDate, maxPrecipMm: d.date === wetDate ? 4 : 0 };
  });
  await route.fulfill({ response: res, json: body });
}

try {
  // --- Surya: the simulation, the slider, the roof ---
  const page = await open("night", "surya");
  await page.locator(".sw-cover__figure").waitFor({ timeout: 30_000 });
  await settle(page);
  const cover = await page.locator(".sw-cover__figure").textContent();
  check(/^\d+%$/.test(cover ?? ""), `Surya shows the share of the need the panels cover (${cover})`);
  check((await page.locator(".sw-fact").count()) === 6, "Surya lists kWp, battery, cost, saving, payback and CO2 avoided");
  check((await page.locator(".sw-chart__bar").count()) === 12, "the sun chart has 12 months");
  const kwpBefore = num(await fact(page, "Kapasitas panel"));
  const batteryBefore = num(await fact(page, "Baterai"));
  const costBefore = num(await fact(page, "Biaya pasang"));

  // Four steps up on the backup slider by keyboard; sample the battery figure while it counts.
  await page.getByRole("slider").focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  check((await page.locator(".slider__output").textContent()) === "8 jam", "the backup slider reads 8 jam after four steps");
  check((await page.getByRole("slider").getAttribute("aria-valuetext")) === "8 jam", "screen readers hear 8 jam too");
  const seen = new Set<string>();
  const until = Date.now() + 1400;
  while (Date.now() < until) {
    seen.add((await fact(page, "Baterai")) ?? "");
    await page.waitForTimeout(40);
  }
  const batteryAfter = num(await fact(page, "Baterai"));
  check(seen.size >= 4, `the battery figure counts smoothly to its new value (${seen.size} distinct values on the way)`);
  check(Math.abs(batteryAfter / batteryBefore - 2) < 0.02, `twice the backup hours, twice the battery (${batteryBefore} to ${batteryAfter} kWh)`);
  check(num(await fact(page, "Biaya pasang")) > costBefore, "more battery costs more");

  // A small roof: fewer kWp.
  const roof = page.getByRole("textbox", { name: /Luas atap/ });
  await roof.fill("40");
  await roof.press("Enter");
  await settle(page);
  const kwpSmall = num(await fact(page, "Kapasitas panel"));
  check(kwpSmall < kwpBefore, `a 40 m² roof holds fewer panels (${kwpBefore} to ${kwpSmall} kWp)`);
  await page.screenshot({ path: join(SHOTS, "check-surya-small-roof.png") });

  // The Cuaca tab forecasts the same panels.
  await page.getByRole("tab", { name: "Cuaca" }).click();
  await page.locator(".sw-days__row").first().waitFor({ timeout: 30_000 });
  const title = await page.locator("#pv-chart-title").textContent();
  check(num(title) === kwpSmall, `Cuaca forecasts the panels Surya simulated (${title})`);
  await page.close();

  // --- Cuaca: the chart reads out the hour under the pointer ---
  const wx = await open("night", "cuaca");
  await wx.locator(".sw-chart__line").waitFor({ timeout: 30_000 });
  await wx.waitForTimeout(800);
  const summary = await wx.locator(".sw-chart__reading").textContent();
  check(/^\d+ jam ke depan: [\d.,]+ kWh/.test(summary ?? ""), `the chart summarises the next hours (${summary})`);
  check((await wx.locator(".sw-days__row").count()) >= 3, "the forecast lists at least three days");
  const box = (await wx.locator(".sw-chart__svg").boundingBox())!;
  await wx.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await wx.waitForTimeout(200);
  const reading = await wx.locator(".sw-chart__reading").textContent();
  check(/\d{2}\.00: [\d,]+ kWh/.test(reading ?? ""), `pointing at the chart reads out that hour (${reading})`);
  check((await wx.locator(".sw-chart__cursor").count()) === 1, "a crosshair marks the hour");
  await wx.screenshot({ path: join(SHOTS, "check-cuaca-hover.png") });
  await wx.close();

  // --- Cuaca with rain: shaded hours and the cost of the rain ---
  const wet = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  wet.on("pageerror", (err) => consoleProblems.push(`pageerror: ${err.message}`));
  await wet.route("**/api/weather?*", rainyForecast);
  await wet.goto(`${HARNESS}/?theme=day&tab=cuaca`);
  await wet.locator(".sw-chart__line").waitFor({ timeout: 30_000 });
  await wet.waitForTimeout(900);
  check((await wet.locator(".sw-chart__rain").count()) >= 1, "rain hours are shaded in the chart");
  const wetRow = wet.locator(".sw-days__row", { has: wet.locator(".sw-days__sky", { hasText: /^Hujan$/ }) }).first();
  const drop = await wetRow.locator(".sw-days__drop").textContent().catch(() => null);
  check(/^produksi turun \d+% karena hujan$/.test(drop ?? ""), `the rainy day says what rain costs against a clear sky (${drop})`);
  const allDrops = await wet.locator(".sw-days__drop").count();
  check(allDrops === (await wet.locator(".sw-days__row").count()), `every day, the best one too, is measured against a clear sky (${allDrops} lines)`);
  await wet.screenshot({ path: join(SHOTS, "check-cuaca-rain-day.png") });
  await wet.locator(".harness__scroll").evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await wet.waitForTimeout(400);
  await wet.screenshot({ path: join(SHOTS, "check-cuaca-rain-day-bottom.png") });
  await wet.close();

  // --- Failures: one sentence and "Coba lagi", then recovery ---
  for (const [tab, path, ready] of [
    ["surya", "**/api/solar/simulate", ".sw-cover"],
    ["cuaca", "**/api/weather?*", ".sw-days__row"],
  ] as const) {
    const p = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    p.on("pageerror", (err) => consoleProblems.push(`pageerror: ${err.message}`));
    await p.route(path, (route) => route.fulfill({ status: 503, json: { error: "Layanan sedang tidak tersedia." } }));
    await p.goto(`${HARNESS}/?theme=night&tab=${tab}`);
    const alert = p.getByRole("alert");
    await alert.waitFor({ timeout: 20_000 });
    check((await alert.textContent())?.includes("Layanan sedang tidak tersedia.") === true, `${tab}: a failed request says what failed`);
    await p.screenshot({ path: join(SHOTS, `check-${tab}-failure.png`) });
    await p.unroute(path);
    await p.getByRole("button", { name: "Coba lagi" }).click();
    await p.locator(ready).first().waitFor({ timeout: 20_000 });
    check(true, `${tab}: "Coba lagi" recovers`);
    await p.close();
  }

  await shotsFor("night");
  await shotsFor("day");
  await typeShots();
} catch (err) {
  failures.push(err instanceof Error ? err.message : String(err));
  console.error(err);
} finally {
  await browser.close();
  harness.stop(true);
}

// A failed request logs a 503 resource error in the console on purpose (the failure checks); nothing else may.
const unexpected = consoleProblems.filter((p) => !/status of 503/.test(p));
if (unexpected.length) {
  console.log("\nConsole errors and warnings:");
  for (const p of unexpected) console.log(`  ${p}`);
}
const failed = failures.length > 0 || unexpected.length > 0;
console.log(failed ? `\nTABS CHECK FAILED (${failures.length} checks, ${unexpected.length} console problems)` : `\nTABS CHECK PASSED (shots in ${SHOTS})`);
process.exit(failed ? 1 : 0);
