import {expect,test} from "bun:test";
import {simulateSolar} from "../../src/shared/solar.ts";
import {parseSolarInput} from "../../src/server/routes/solar.ts";
const input={roofAreaM2:100,kwhYear:1000,peakSunHours:4.5,backupHours:0,tariffRpPerKwh:1500,costRpPerKwp:15000000,batteryRpPerKwh:0,gridFactorKgPerKwh:0.8,daytimeShare:0.4};
test("manual panel count drives production and cost but never earns export credit",()=>{
 const one=simulateSolar({...input,panelCount:1}),many=simulateSolar({...input,panelCount:10});
 expect(one.panels).toBe(1);expect(many.panels).toBe(10);expect(many.kwhYear).toBeCloseTo(one.kwhYear*10);
 expect(many.costRp).toBeCloseTo(one.costRp*10);expect(many.savingRpYear).toBeLessThanOrEqual(input.kwhYear*input.daytimeShare*input.tariffRpPerKwh);
 expect(many.exportKwh).toBeGreaterThan(0);expect(many.selfUseKwh+many.exportKwh).toBeCloseTo(many.kwhYear);
});
test("zero panels means no installation and oversized requests respect roof capacity",()=>{
 expect(simulateSolar({...input,panelCount:0}).panels).toBe(0);
 expect(simulateSolar({...input,roofAreaM2:10,panelCount:100}).panels).toBe(1);
});
test("manual count endpoint rejects fractional, negative and nonnumeric input",()=>{
 const body={lat:0,lng:117,roofAreaM2:100,kwhYear:1000,backupHours:0};
 for(const n of [-1,1.5,"2",null,Infinity,20001])expect(parseSolarInput({...body,panelCount:n})).toHaveProperty("problem");
 expect(parseSolarInput({...body,panelCount:3})).toHaveProperty("input.panelCount",3);
});
