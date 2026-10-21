/**
 * Measures the WCAG contrast of every colour class of the region ramps against the basemap ground,
 * from rendered pixels (not from hex values): light, emissive strength and opacity all change the
 * colour you see. Start `bun dev` first, then run `bun run contrast`.
 *
 * For each light preset and metric it shows the province from straight above with flat columns, gives
 * the ten regions the six ramp stops in turn, and screenshots the map with and without the columns. Per
 * region it compares the median column pixel with the median ground pixel under the same points.
 *
 * Options (env): BASE_URL (default http://localhost:3000), CONTRAST_PRESETS (default day,dawn,dusk,night).
 */
import type { Page } from "playwright";
import { launchBrowser } from "./chromium.ts";
import type { RegionCollection } from "../src/web/api.ts";
import { calmShapes } from "../src/web/map/regionShapes.ts";

const BASE_URL = Bun.env.BASE_URL ?? "http://localhost:3000";
const PRESETS = (Bun.env.CONTRAST_PRESETS ?? "day,dawn,dusk,night").split(",");
const STOPS = [0, 0.2, 0.4, 0.6, 0.8, 1];

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: number[]) => 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

type MapWindow = Window & { __malasMap?: import("mapbox-gl").Map };

/** Screen points inside each region polygon, with the ramp stop that region was given. */
async function preparePage(page: Page, metric: "co2" | "kwh") {
  // The metric switch sinks and re-raises the columns; let that finish before flattening them.
  if (metric === "kwh") await page.getByRole("radio", { name: "Listrik" }).click();
  await page.waitForTimeout(2500);
  // Sample the shapes the columns are drawn from (the calmer copy: no tiny delta islands).
  const calm = calmShapes((await (await fetch(new URL("/api/regions", BASE_URL))).json()) as RegionCollection);
  return page.evaluate(async ({ stops, calm }) => {
    const map = (window as MapWindow).__malasMap!;
    (document.querySelector(".ui-layer") as HTMLElement).style.display = "none";
    // Only the columns and the ground are measured: outlines, top rims, plant markers and the region names
    // drawn on top of the columns go (the name covers most of small Balikpapan and pulled its sample to the halo).
    const pins = map.getStyle().layers.flatMap((l) => (l.id.startsWith("plants-") ? [l.id] : []));
    for (const id of ["regions-outline", "regions-rim", "region-labels", ...pins]) map.setLayoutProperty(id, "visibility", "none");
    for (const key of ["showPlaceLabels", "showRoadLabels", "showAdminBoundaries"]) map.setConfigProperty("basemap", key, false);
    map.jumpTo({ center: [116.6, 0.4], zoom: 6.15, pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
    type Shape = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
    const fc = calm as unknown as { features: { properties: { id: string }; geometry: Shape }[] };
    const inside = (pt: number[], rings: number[][][]) => {
      let hit = false;
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i]!;
          const [xj, yj] = ring[j]!;
          if (yi! > pt[1]! !== yj! > pt[1]! && pt[0]! < ((xj! - xi!) * (pt[1]! - yi!)) / (yj! - yi!) + xi!) hit = !hit;
        }
      }
      return hit;
    };
    const out: { id: string; stop: number; points: [number, number][] }[] = [];
    fc.features.forEach((f, k) => {
      const id = f.properties.id;
      const stop = stops[k % stops.length]!;
      map.setFeatureState({ source: "regions", id }, { t: stop, h: 40, hover: false, fade: 0 });
      const polys: number[][][][] = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      const points: [number, number][] = [];
      for (const poly of polys) {
        const xs = poly[0]!.map((c) => c[0]!);
        const ys = poly[0]!.map((c) => c[1]!);
        const [w, e, s, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        for (let gx = 0; gx < 14; gx++) {
          for (let gy = 0; gy < 14; gy++) {
            const p = [w + ((gx + 0.5) / 14) * (e - w), s + ((gy + 0.5) / 14) * (n - s)];
            if (!inside(p, poly)) continue;
            const sp = map.project(p as [number, number]);
            if (sp.x > 4 && sp.y > 4 && sp.x < innerWidth - 4 && sp.y < innerHeight - 4) points.push([Math.round(sp.x), Math.round(sp.y)]);
          }
        }
      }
      out.push({ id, stop, points });
    });
    await new Promise((r) => map.once("idle", r));
    return out;
  }, { stops: STOPS, calm });
}

/** Median colour under each region's points, from a PNG screenshot. */
async function sample(page: Page, png: Buffer, regions: { id: string; points: [number, number][] }[]) {
  return page.evaluate(
    async ({ b64, regions }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      const median = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
      return Object.fromEntries(
        regions.map((r) => {
          const ch: number[][] = [[], [], []];
          for (const [x, y] of r.points) {
            const i = (y * c.width + x) * 4;
            for (let k = 0; k < 3; k++) ch[k]!.push(data[i + k]!);
          }
          return [r.id, ch.map(median)];
        }),
      );
    },
    { b64: png.toString("base64"), regions },
  );
}

const browser = await launchBrowser();
const rows: string[] = [];
let worst = Number.POSITIVE_INFINITY;
try {
  for (const preset of PRESETS) {
    for (const metric of ["co2", "kwh"] as const) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
      await page.goto(`${BASE_URL}/?cahaya=${preset}`, { waitUntil: "domcontentloaded" });
      await page.locator(".ui-layer").waitFor({ timeout: 60_000 });
      const regions = await preparePage(page, metric);
      await page.waitForTimeout(600);
      const shotA = await page.screenshot();
      if (Bun.env.CONTRAST_SHOTS) await Bun.write(`${Bun.env.CONTRAST_SHOTS}/${preset}-${metric}-columns.png`, shotA);
      const withColumns = await sample(page, shotA, regions);
      await page.evaluate(async () => {
        const map = (window as MapWindow).__malasMap!;
        map.setLayoutProperty("regions-extrusion", "visibility", "none");
        await new Promise((r) => map.once("idle", r));
      });
      await page.waitForTimeout(300);
      const ground = await sample(page, await page.screenshot(), regions);
      const byStop = new Map<number, number[]>();
      const colours = new Map<number, string>();
      for (const r of regions) {
        if (r.points.length < 10) continue;
        const ratio = contrast(withColumns[r.id]!, ground[r.id]!);
        byStop.set(r.stop, [...(byStop.get(r.stop) ?? []), ratio]);
        colours.set(r.stop, `${hex(withColumns[r.id]!)} on ${hex(ground[r.id]!)}`);
      }
      const cells = STOPS.map((s) => Math.min(...(byStop.get(s) ?? [Number.NaN])));
      worst = Math.min(worst, ...cells.filter(Number.isFinite));
      rows.push(`| ${preset} | ${metric} | ${cells.map((v) => v.toFixed(1)).join(" | ")} |`);
      console.log(`${preset.padEnd(5)} ${metric}  ${cells.map((v) => v.toFixed(2)).join("  ")}   (${[...colours.values()].join(", ")})`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
console.log("\n| Preset | Metric | Stop 1 | Stop 2 | Stop 3 | Stop 4 | Stop 5 | Stop 6 |\n|---|---|---|---|---|---|---|---|");
console.log(rows.join("\n"));
console.log(`\nLowest contrast: ${worst.toFixed(2)}:1`);
