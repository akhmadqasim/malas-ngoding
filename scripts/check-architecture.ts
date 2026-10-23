import { launchBrowser } from "./chromium.ts";
import { mkdirSync } from "node:fs";

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" || (message.type() === "warning" && /city-architecture|\[peta\]/.test(message.text()))) errors.push(message.text());
  });
  await page.addInitScript(() => sessionStorage.setItem("malas:landing-seen", "1"));
  await page.goto("http://localhost:3000/?cahaya=day");
  await page.getByRole("button", { name: "Lewati intro" }).click({ timeout: 30_000 });
  await page.waitForFunction(() => Boolean((window as any).__malasSelectBuildingAt), { timeout: 30_000 });
  await page.evaluate(() => {
    const map = (window as any).__malasMap;
    map.stop();
    map.jumpTo({ center: [117.15, -0.5], zoom: 17.8, pitch: 60 });
  });
  await page.waitForFunction(() => (window as any).__malasMap.queryRenderedFeatures({ layers: ["city-architecture"] }).length > 20);
  await page.waitForTimeout(2000);
  mkdirSync("output", { recursive: true });
  await page.screenshot({ path: "output/architecture-day.png" });
  const state = await page.evaluate(() => {
    const map = (window as any).__malasMap;
    const features = map.queryRenderedFeatures({ target: { layerId: "city-architecture" } });
    const canvas = map.getCanvas();
    const f = features.find((f: any) => {
      if (f.geometry.type !== "Polygon") return false;
      const ring = f.geometry.coordinates[0];
      const at = ring.slice(0, -1).reduce((a: number[], p: number[]) => [a[0]! + p[0]! / (ring.length - 1), a[1]! + p[1]! / (ring.length - 1)], [0, 0]);
      const point = map.project(at);
      return point.x > 420 && point.x < canvas.clientWidth - 400 && point.y > 250 && point.y < 600;
    });
    if (!f) throw new Error("No visible building found");
    const ring = f.geometry.coordinates[0].slice(0, -1);
    const at = ring.reduce((a: number[], p: number[]) => [a[0]! + p[0]! / ring.length, a[1]! + p[1]! / ring.length], [0, 0]);
    return { at, count: features.length, roofs: map.getLayoutProperty("city-architecture", "building-roof-shape") };
  });
  await page.evaluate(async at => await (window as any).__malasSelectBuildingAt(at), state.at);
  await page.locator(".building-panel").waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => {
    const map = (window as any).__malasMap;
    return map.queryRenderedFeatures({ layers: ["city-architecture"] }).some((f: any) => map.getFeatureState(f).select);
  });
  await page.screenshot({ path: "output/architecture-selected.png" });
  console.log("Selected building; testing mosque design");
  await page.evaluate(async at => await (window as any).__malasSelectBuildingAt(at, { type: "ibadah", name: "Masjid — uji model ilustratif" }), state.at);
  await page.locator(".building-type__trigger").click();
  await page.getByRole("option", { name: "Tempat ibadah", exact: true }).click();
  console.log("Selected worship type");
  await page.waitForFunction(() => (window as any).__malasMap.getLayoutProperty("building-design", "model-id") === "mosque-roof");
  await page.waitForTimeout(1500);
  await page.evaluate(() => (window as any).__malasMap.easeTo({ zoom: 19.2, duration: 0 }));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "output/architecture-mosque-design.png" });
  console.log("Mosque model rendered; testing warehouse");
  await page.evaluate(async at => await (window as any).__malasSelectBuildingAt(at, { type: "gudang", name: "Gudang — uji model ilustratif" }), state.at);
  await page.locator(".building-type__trigger").click();
  await page.getByRole("option", { name: "Gudang", exact: true }).click();
  console.log("Selected warehouse type");
  await page.waitForFunction(() => !(window as any).__malasMap.getLayer("building-design"));
  await page.evaluate(() => (window as any).__malasMap.easeTo({ zoom: 19.2, duration: 0 }));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "output/architecture-warehouse-design.png" });
  await page.getByRole("tab", { name: "Surya", exact: true }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "output/architecture-solar.png" });
  await page.evaluate(() => (window as any).__malasMap.setConfigProperty("basemap", "lightPreset", "night"));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "output/architecture-night.png" });
  console.log(JSON.stringify({ buildings: state.count, errors, screenshots: "output/architecture-*.png" }));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
