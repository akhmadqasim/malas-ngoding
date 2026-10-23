import { launchBrowser } from "./chromium.ts";
import { mkdirSync } from "node:fs";
import type { PemdaHomes, PemdaSummary } from "../src/shared/auth.ts";

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" || (message.type() === "warning" && /building-design|city-architecture|pemda-installed|\[peta\]/.test(message.text()))) errors.push(message.text());
  });
  await page.addInitScript(() => sessionStorage.setItem("malas:landing-seen", "1"));
  await page.goto("http://localhost:3000/?cahaya=day");
  await page.getByRole("button", { name: "Lewati intro" }).click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.getByRole("button", { name: "Masuk sebagai pemda demo" }).click();
  await page.getByRole("region", { name: "Dasbor pemerintah daerah" }).waitFor();
  await page.getByRole("button", { name: "Adopsi PLTS warga", exact: true }).click();
  const summary = await (await page.request.get("http://localhost:3000/api/pemda/summary")).json() as PemdaSummary;
  const homes = await (await page.request.get("http://localhost:3000/api/pemda/homes")).json() as PemdaHomes;
  const installed = homes.features.filter(f => f.properties.installed);
  if (!installed.length) throw new Error("Seed demo installations before this check");
  await page.waitForFunction(count => {
    const source = (window as any).__malasMap?.getSource("pemda-homes");
    return source?._data.features.length === count && source._data.features.every((f: any) => f.properties.installed);
  }, installed.length);
  let target = installed[0]!;
  let renderedPanels = 0;
  const candidates = [...installed].sort((a, b) => Number(b.properties.regionId === "samarinda") - Number(a.properties.regionId === "samarinda"));
  for (const candidate of candidates.slice(0, 8)) {
    target = candidate;
    await page.evaluate(at => {
      const map = (window as any).__malasMap;
      map.stop(); map.jumpTo({ center: at, zoom: 19.3, pitch: 55 });
    }, target.geometry.coordinates);
    await page.waitForTimeout(1600);
    renderedPanels = await page.evaluate(() => (window as any).__malasMap.getSource("pemda-installed-pv")?._data.features.length ?? 0);
    if (renderedPanels) break;
  }
  await page.waitForTimeout(1000);
  mkdirSync("output", { recursive: true });
  await page.screenshot({ path: "output/government-installed-solar.png" });
  const point = await page.evaluate(at => {
    const p = (window as any).__malasMap.project(at);
    return { x: p.x, y: p.y };
  }, target.geometry.coordinates);
  await page.mouse.click(point.x, point.y);
  await page.locator(".pemda-home-popup").waitFor();
  await page.screenshot({ path: "output/government-solar-details.png" });
  await page.locator("#pemda-home-filter").selectOption("interested");
  await page.waitForFunction(() => {
    const map = (window as any).__malasMap;
    return !map.getLayer("pemda-installed-pv") && map.getSource("pemda-homes")._data.features.every((f: any) => f.properties.interested && !f.properties.installed);
  });
  await page.locator("#pemda-home-filter").selectOption("all");
  await page.waitForFunction(count => (window as any).__malasMap.getSource("pemda-homes")._data.features.length === count, homes.features.length);
  console.log(JSON.stringify({ installed: summary.totals.installed, consentingInstallations: installed.length, totalConsenting: homes.features.length, renderedPanels, errors }));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
