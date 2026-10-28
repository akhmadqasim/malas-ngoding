import { launchBrowser } from "./chromium.ts";
import { mkdirSync } from "node:fs";
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" || (m.type() === "warning" && /architecture|\[peta\]/.test(m.text()))) errors.push(m.text()); });
  await page.addInitScript(() => sessionStorage.setItem("malas:landing-seen", "1"));
  await page.goto("http://localhost:3000/?cahaya=day");
  await page.getByRole("button", { name: "Lewati intro" }).click({ timeout: 30000 });
  await page.waitForFunction(() => Boolean((window as any).__malasMap));
  mkdirSync("output", { recursive: true });
  const checks: unknown[] = [];
  for (const [city, lng, lat] of [["samarinda", 117.15, -0.5], ["balikpapan", 116.85, -1.27], ["bontang", 117.49, 0.13]] as const) {
    await page.evaluate(at => { const map = (window as any).__malasMap; map.stop(); map.jumpTo({ center: at, zoom: 17.6, pitch: 60 }); }, [lng, lat]);
    await page.waitForFunction(() => ((window as any).__malasMap.getSource("architecture-facades")?._data.features.length ?? 0) > 20);
    await page.waitForTimeout(1200);
    const audit = await page.evaluate(() => {
      const map = (window as any).__malasMap;
      const features = map.queryRenderedFeatures({ layers: ["city-architecture"] });
      let best: any = null, bestArea = 0;
      for (const f of features) {
        if (f.geometry.type !== "Polygon") continue;
        const r = f.geometry.coordinates[0];
        const area = Math.abs(r.slice(1).reduce((s: number, p: number[], i: number) => s + r[i][0] * p[1]! - p[0]! * r[i][1], 0));
        if (area > bestArea) { best = f; bestArea = area; }
      }
      const r = best.geometry.coordinates[0].slice(0, -1);
      const at = r.reduce((a: number[], p: number[]) => [a[0]! + p[0]! / r.length, a[1]! + p[1]! / r.length], [0, 0]);
      map.jumpTo({ center: at, zoom: 18.7, pitch: 65 });
      return { windows: map.getSource("architecture-facades")._data.features.length, buildings: features.length,
        stackedModel: Boolean(map.getLayer("building-design")), at };
    });
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `output/building-layout-${city}.png` });
    checks.push({ city, ...audit });
  }
  console.log(JSON.stringify({ checks, errors }));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
