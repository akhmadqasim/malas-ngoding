import { launchBrowser } from "./chromium.ts";
import { mkdirSync } from "node:fs";

const browser = await launchBrowser();
const errors: string[] = [];
mkdirSync("output", { recursive: true });
async function open(role: "warga" | "pemda") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" || (message.type() === "warning" && /farm|\[peta\]/.test(message.text()))) errors.push(message.text()); });
  await page.addInitScript(() => sessionStorage.setItem("malas:landing-seen", "1"));
  await page.goto("http://localhost:3000/?cahaya=day");
  if (await page.getByRole("button", {name:"Lewati intro"}).isVisible()) await page.getByRole("button", {name:"Lewati intro"}).click();
  await page.locator(".dashboard-header").getByRole("button", { name: "Masuk", exact: true }).click();
  await page.getByRole("button", { name: `Masuk sebagai ${role} demo` }).click();
  if (role === "warga") await page.getByRole("region", { name: "Dashboard rumah pribadi" }).waitFor();
  else await page.getByRole("navigation", { name: "Navigasi pemda" }).waitFor();
  await page.waitForTimeout(1200);
  return { context, page };
}

try {
  const gov = await open("pemda");
  const page = gov.page;
  await page.screenshot({ path: "output/dashboard-pemda.png" });
  await page.locator(".dashboard-nav").getByRole("button", { name: /^Rencana pembangkit/ }).click();
  await page.locator(".potential__ranking .ranking__row").first().waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "output/dashboard-planner.png" });
  // Deterministic browser fixtures test layout/animation without depending on an external site check.
  await page.route("**/api/site?**", route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: { clear: true, at: [Number(url.searchParams.get("lng")), Number(url.searchParams.get("lat"))], movedKm: 0 } });
  });
  await page.route("**/api/weather?**", route => route.fulfill({ json: { hours: [], days: [], stale: false,
    current: { raining: false, cloudPct: 10, precipMm: 0, isDay: true, wind: { speedMs: 6, fromDeg: 90, heightM: 10, time: "2026-10-22T16:00" } } } }));
  let windFrom = 90;
  await page.route("**/api/wind?**", route => route.fulfill({ json: { current: { wind: { speedMs: 6, fromDeg: windFrom, heightM: 10, time: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16) } }, stale: false, fetchedAt: new Date().toISOString(), source: "Open-Meteo" } }));
  await page.locator(".potential__ranking .ranking__row").first().click();
  await page.getByRole("button", { name: "Periksa lahan & mulai simulasi" }).click();
  await page.getByRole("slider", { name: "Kapasitas PLTS" }).waitFor();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "output/dashboard-solar-planning.png" });
  await page.locator(".planning-tech-picker > summary").click();
  await page.locator(".planning-technologies").getByRole("button", { name: /PLTB/ }).click();
  await page.getByRole("button", { name: "Periksa lahan & mulai simulasi" }).click();
  await page.waitForFunction(() => { const map = (window as any).__malasMap; return map.getLayer("farm-towers") && map.getPaintProperty("farm-towers", "model-rotation")?.[2] === 90; }).catch(async error => { await page.screenshot({ path: "output/modern-wind-failure.png" }); console.log(await page.locator(".planning-wind").textContent(), errors); throw error; });
  await page.waitForTimeout(2500);
  await page.waitForFunction(() => { const map = (window as any).__malasMap; return map.isSourceLoaded("farm") && ["turbine-tower", "turbine-rotor"].every(id => Object.values(map.style.modelManager.models).some((entries: any) => entries[id]?.model?.uploaded)); }).catch(async error => { console.log("Wind model load timed out", errors); throw error; });
  const pose = await page.evaluate(() => {
    const map = (window as any).__malasMap;
    const arrow = map.getSource("farm-wind")._data.features[0].geometry.coordinates[0];
    return { modelsLoaded: ["turbine-tower", "turbine-rotor"].every(id => Object.values(map.style.modelManager.models).some((entries: any) => entries[id]?.model?.uploaded)),
      tower: map.getPaintProperty("farm-towers", "model-rotation"), rotor: map.getPaintProperty("farm-rotors", "model-rotation"),
      hub: map.getPaintProperty("farm-rotors", "model-translation"), westwardFlow: arrow[1][0] < arrow[0][0] };
  });
  if (!pose.westwardFlow || Math.abs(pose.hub[0] - 9) > 0.01 || Math.abs(pose.hub[1]) > 0.01) throw new Error("Wind direction, hub and rotor are not aligned");
  const angle = pose.rotor[1];
  await page.waitForTimeout(400);
  const turning = await page.evaluate(angle => (window as any).__malasMap.getPaintProperty("farm-rotors", "model-rotation")[1] !== angle, angle);
  if (!turning) throw new Error("Rotor does not animate");
  await page.screenshot({ path: "output/dashboard-wind-planning.png" });
  // Let the real one-minute poll run: changing the source must rotate the existing turbine without another click.
  windFrom = 225;
  await page.waitForFunction(() => (window as any).__malasMap.getPaintProperty("farm-towers", "model-rotation")[2] === 225, undefined, { timeout: 70_000 });
  await page.locator(".planning-wind").filter({ hasText: "dari Barat daya" }).waitFor();
  await page.screenshot({ path: "output/dashboard-wind-updated.png" });
  const overlaps = await page.evaluate(() => {
    const panel = document.querySelector(".sheet-slot")!.getBoundingClientRect();
    const tools = document.querySelector(".tools-slot")!.getBoundingClientRect();
    const header = document.querySelector(".dashboard-context")!.getBoundingClientRect();
    return panel.right > tools.left || panel.top < header.bottom;
  });
  if (overlaps) throw new Error("Planning panel overlaps map tools or the header");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "output/dashboard-mobile.png" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error("Mobile dashboard overflows horizontally");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".dashboard-nav").getByRole("button", { name: /^Digital twin/ }).click();
  await page.getByRole("button", { name: "Putar 24 jam" }).waitFor();
  await page.waitForFunction(() => (window as any).__malasMap.getZoom() < 8).catch(async error => { await page.screenshot({ path: "output/modern-twin-failure.png" }); console.log("Twin camera", await page.evaluate(() => ({ zoom: (window as any).__malasMap.getZoom(), moving: (window as any).__malasMap.isMoving() }))); throw error; });
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "Putar 24 jam" }).click();
  await page.getByRole("button", { name: "Jeda" }).waitFor();
  await page.waitForTimeout(1600);
  await page.getByRole("button", { name: "Jeda" }).click();
  await page.screenshot({ path: "output/dashboard-digital-twin.png" });
  await gov.context.close();
  const resident = await open("warga");
  await resident.page.getByRole("region", { name: "Rumah saya", exact: true }).waitFor();
  await resident.page.screenshot({ path: "output/dashboard-warga.png" });
  await resident.page.getByRole("button", { name: "Manfaat untuk saya", exact: true }).click();
  await resident.page.getByRole("button", { name: "Lihat pilihan panel di atap" }).click();
  await resident.page.getByRole("region", { name: "Simulasi pemasangan panel surya" }).waitFor();
  if (await resident.page.locator(".building-panel").count()) throw new Error("Home experiment opened a different building");
  await resident.page.waitForTimeout(2500);
  await resident.page.screenshot({ path: "output/dashboard-warga-solar.png" });
  await resident.context.close();
  console.log(JSON.stringify({ roles: ["pemda", "warga"], planning: ["PLTS", "PLTB"], windFixture: pose, errors }));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
