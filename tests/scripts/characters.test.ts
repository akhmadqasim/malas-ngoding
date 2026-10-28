import { expect, test } from "bun:test";
import { personParts } from "../../scripts/build-characters.ts";
import { buildGlb } from "../../scripts/build-models.ts";
import { decode } from "fast-png";

test("all three 3D roles and walking poses have valid meshes, unit normals and small GLBs", () => {
  for (const role of ["warga", "pemda", "teknisi"] as const) for (const stride of [-1, 0, 1]) {
    const parts = personParts(role, stride);
    for (const { mesh } of parts) {
      expect(mesh.positions.every(Number.isFinite)).toBe(true);
      expect(mesh.indices.every(i => i >= 0 && i < mesh.positions.length / 3)).toBe(true);
      for (let i = 0; i < mesh.normals.length; i += 3) expect(Math.hypot(...mesh.normals.slice(i, i + 3))).toBeCloseTo(1, 6);
    }
    const bytes = buildGlb(`person-${role}`, parts);
    expect(bytes.byteLength).toBeLessThan(100_000);
    expect(new DataView(bytes.buffer).getUint32(0, true)).toBe(0x46546c67);
  }
});
test("ready-to-use character illustrations retain real transparency", async () => {
  for (const role of ["warga", "pemda", "teknisi"]) {
    const png = decode(await Bun.file(`public/characters/${role}.png`).arrayBuffer());
    expect(png.channels).toBe(4); expect(png.data[3]).toBe(0); expect(png.width).toBeGreaterThanOrEqual(512);
    let visible = 0;
    for (let i = 3; i < png.data.length; i += 4) if (png.data[i]! >= 250) visible++;
    expect(visible).toBeGreaterThan(10_000);
  }
});
