import { describe, expect, test } from "bun:test";
import { fmtKg, fmtKwh, fmtNumber, fmtRupiah } from "../../src/shared/format.ts";

describe("format", () => {
  test("fmtNumber uses id-ID separators", () => {
    expect(fmtNumber(12345)).toBe("12.345");
    expect(fmtNumber(1234.5, 1)).toBe("1.234,5");
  });
  test("fmtKwh", () => {
    expect(fmtKwh(12345)).toBe("12.345 kWh");
  });
  test("fmtKg switches to ton at 1000", () => {
    expect(fmtKg(950)).toBe("950 kg");
    expect(fmtKg(1500)).toBe("1,5 ton");
    expect(fmtKg(999.6)).toBe("1,0 ton");
  });
  test("fmtRupiah", () => {
    expect(fmtRupiah(23_700_000)).toBe("Rp 23,7 jt");
    expect(fmtRupiah(1_200_000_000)).toBe("Rp 1,2 M");
    expect(fmtRupiah(950_000)).toBe("Rp 950.000");
    expect(fmtRupiah(999_990_000)).toBe("Rp 1,0 M");
    expect(fmtRupiah(0)).toBe("Rp 0");
  });
});
