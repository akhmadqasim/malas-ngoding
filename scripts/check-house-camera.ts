import { launchBrowser } from "./chromium.ts";
const browser = await launchBrowser();
const errors: string[] = [];
try {
  for (const [name, width, height, light] of [["desktop-night", 1440, 1000, "night"], ["mobile-day", 390, 844, "day"]] as const) {
    const context = await browser.newContext({viewport:{width,height}});
    await context.request.post("http://localhost:3000/api/auth/demo", {data:{role:"warga"},headers:{origin:"http://localhost:3000"}});
    const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(() => sessionStorage.setItem("malas:landing-seen", "1"));
    await page.goto(`http://localhost:3000/?cahaya=${light}`);
    if (await page.getByRole("button", {name:"Lewati intro"}).isVisible()) await page.getByRole("button", {name:"Lewati intro"}).click();
    await page.getByRole("region",{name:"Dashboard rumah pribadi"}).waitFor();
    if (await page.getByRole("button",{name:"Lewati intro"}).count()) throw new Error("Saved account replayed the globe intro");
    await page.waitForFunction(() => {
      const map = (window as any).__malasMap;
      return map && map.getZoom() >= 18.5 && Math.abs(map.queryTerrainElevation(map.getCenter()) ?? 0) < 0.01 && map.isSourceLoaded("city-architecture") && map.queryRenderedFeatures({layers:["city-architecture"]}).length > 0;
    }).catch(async error => { console.log(name, await page.evaluate(() => { const m = (window as any).__malasMap; return {zoom:m.getZoom(),terrain:m.getTerrain(), source:m.isSourceLoaded("city-architecture"),rendered:m.queryRenderedFeatures({layers:["city-architecture"]}).length, center:m.getCenter()}; })); await page.screenshot({path:"output/house-fix-failure.png"}); throw error; });
    await page.waitForTimeout(1500);
    await page.screenshot({path:`output/house-fixed-${name}.png`});
    await page.reload(); if (await page.getByRole("button", {name:"Lewati intro"}).isVisible()) await page.getByRole("button", {name:"Lewati intro"}).click();
    await page.getByRole("region",{name:"Dashboard rumah pribadi"}).waitFor();
    if (await page.getByRole("button",{name:"Lewati intro"}).count()) throw new Error("Saved account replayed the globe intro");
    await page.waitForFunction(() => Math.abs((window as any).__malasMap.queryTerrainElevation((window as any).__malasMap.getCenter()) ?? 0) < 0.01 && (window as any).__malasMap.getZoom() >= 18.5);
    await context.close();
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(JSON.stringify({night:true,mobile:true,raisedTerrainAtRoofScale:false,renderedBuildings:true,reload:true,errors}));
} finally {await browser.close();}
