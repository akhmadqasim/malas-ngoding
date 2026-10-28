import { expect, test } from "bun:test";
import { energyImpact, telemetryCsv } from "../../src/shared/energyImpact.ts";
import { sensorFrame } from "../../src/shared/telemetry.ts";

const model = { id: "demo", kWp: 3, kwhYear: 3600, gridFactor: 1.14 };
const time = Date.parse("2026-10-22T04:00:00Z");
test("comparison uses the same load and credits on-site use, not exported surplus", () => {
  const frame = sensorFrame(model, time, "clear"), impact = energyImpact(frame, 1.14);
  expect(impact.coveragePct).toBe(100); expect(impact.status).toBe("covered");
  expect(impact.baselineKgHour! - impact.remainingKgHour!).toBeCloseTo(frame.avoidedKgHour, 10);
  expect(impact.avoidedKgHour).toBeLessThan(frame.solarKw * 1.14);
});
test("night and missing factors do not invent a reduction or a zero emission value", () => {
  const frame = sensorFrame(model, time, "night");
  expect(energyImpact(frame, 1.14).coveragePct).toBe(0);
  expect(energyImpact(frame, 1.14).status).toBe("grid");
  expect(energyImpact(frame, null).baselineKgHour).toBeNull();
  expect(energyImpact(frame, null).remainingKgHour).toBeNull();
});
test("a zero-load building never claims 100% avoided consumption", () => {
  expect(energyImpact(sensorFrame({ ...model, kwhYear: 0 }, time, "clear"), 1.14).coveragePct).toBe(0);
});
test("CSV identifies synthetic history, UTC timestamps, capacity, factor and units", () => {
  const frames = [sensorFrame(model, time, "clear"), sensorFrame(model, time + 2000, "clear")];
  const csv = telemetryCsv(frames, { id: "demo", scenario: "clear", kWp: 3, gridFactor: 1.14 });
  expect(csv.startsWith("\uFEFF")).toBe(true);
  expect(csv).toContain("co2_kg_per_hour"); expect(csv).toContain("riwayat_model_sintetis_bukan_pengukuran");
  expect(csv).toContain("2026-10-22T04:00:00.000Z"); expect(csv).toContain('"1.14"');
  expect(csv.trim().split("\r\n")).toHaveLength(3);
});
test("CSV escapes quotes and neutralises spreadsheet formula identifiers", () => {
  const csv = telemetryCsv([sensorFrame(model, time)], { id: '=HYPERLINK("example")', scenario: "auto", kWp: 3, gridFactor: null });
  expect(csv).toContain('"\'=HYPERLINK(""example"")"');
  expect(csv).toContain(',"","","",');
});
