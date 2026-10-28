import { describe, expect, test } from "bun:test";
import { buildModel, HUB_OFFSET_ENU, MODELS } from "../../scripts/build-models.ts";

type Accessor = { bufferView: number; componentType: number; count: number; type: string; byteOffset?: number; min?: number[]; max?: number[] };
type View = { buffer: number; byteOffset: number; byteLength: number };

function parse(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  const binStart = 20 + jsonLen;
  const binLen = view.getUint32(binStart, true);
  const bin = bytes.slice(binStart + 8, binStart + 8 + binLen);
  return { view, jsonLen, json, binStart, binLen, bin };
}

/** Axis-aligned extent [min, max] per glTF axis over all POSITION accessors. */
function bounds(json: { meshes: { primitives: { attributes: { POSITION: number } }[] }[]; accessors: Accessor[] }) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of json.meshes[0]!.primitives) {
    const a = json.accessors[p.attributes.POSITION]!;
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, a.min![k]!);
      max[k] = Math.max(max[k]!, a.max![k]!);
    }
  }
  return { min, max };
}

const names = Object.keys(MODELS);

describe("generated glTF models", () => {
  for (const name of names) {
    const bytes = buildModel(name);
    const g = parse(bytes);

    test(`${name}: GLB header and chunks`, () => {
      expect(g.view.getUint32(0, true)).toBe(0x46546c67);
      expect(g.view.getUint32(4, true)).toBe(2);
      expect(g.view.getUint32(8, true)).toBe(bytes.byteLength);
      expect(g.jsonLen % 4).toBe(0);
      expect(g.binLen % 4).toBe(0);
      expect(g.view.getUint32(16, true)).toBe(0x4e4f534a);
      expect(g.view.getUint32(g.binStart + 4, true)).toBe(0x004e4942);
      expect(g.json.asset.version).toBe("2.0");
      expect(g.json.asset.generator).toBe("malas-ngoding scripts/build-models.ts");
      expect(g.json.buffers[0].byteLength).toBe(g.binLen);
    });

    test(`${name}: accessors fit their buffer views`, () => {
      const sizes: Record<number, number> = { 5126: 4, 5123: 2, 5125: 4 };
      const comps: Record<string, number> = { SCALAR: 1, VEC3: 3 };
      for (const a of g.json.accessors as Accessor[]) {
        const v = g.json.bufferViews[a.bufferView] as View;
        const need = (a.byteOffset ?? 0) + a.count * sizes[a.componentType]! * comps[a.type]!;
        expect(need).toBeLessThanOrEqual(v.byteLength);
        expect(v.byteOffset + v.byteLength).toBeLessThanOrEqual(g.binLen);
      }
    });

    test(`${name}: POSITION min/max are true and normals are unit length`, () => {
      const f32 = new Float32Array(g.bin.buffer, g.bin.byteOffset, g.bin.byteLength / 4);
      for (const p of g.json.meshes[0].primitives) {
        const pa = g.json.accessors[p.attributes.POSITION] as Accessor;
        const na = g.json.accessors[p.attributes.NORMAL] as Accessor;
        const pv = g.json.bufferViews[pa.bufferView] as View;
        const nv = g.json.bufferViews[na.bufferView] as View;
        const pos = f32.subarray(pv.byteOffset / 4, pv.byteOffset / 4 + pa.count * 3);
        const nor = f32.subarray(nv.byteOffset / 4, nv.byteOffset / 4 + na.count * 3);
        for (let k = 0; k < 3; k++) {
          let lo = Infinity;
          let hi = -Infinity;
          for (let i = k; i < pos.length; i += 3) {
            lo = Math.min(lo, pos[i]!);
            hi = Math.max(hi, pos[i]!);
          }
          expect(lo).toBe(pa.min![k]!);
          expect(hi).toBe(pa.max![k]!);
        }
        for (let i = 0; i < nor.length; i += 3) expect(Math.hypot(nor[i]!, nor[i + 1]!, nor[i + 2]!)).toBeCloseTo(1, 4);
        const iv = g.json.bufferViews[g.json.accessors[p.indices].bufferView] as View;
        const ia = g.json.accessors[p.indices] as Accessor;
        const idx = ia.componentType === 5123 ? new Uint16Array(g.bin.buffer, g.bin.byteOffset + iv.byteOffset, ia.count) : new Uint32Array(g.bin.buffer, g.bin.byteOffset + iv.byteOffset, ia.count);
        expect(ia.count % 3).toBe(0);
        for (const i of idx) expect(i).toBeLessThan(pa.count);
      }
    });
  }

  test("solar-table dimensions: 11.5 m wide, 4.6 m up the slope, low edge 0.6 m, light", () => {
    const { json } = parse(buildModel("solar-table"));
    const { min, max } = bounds(json);
    // glTF axes: x east, y up, z south (north is -z).
    expect(max[0]! - min[0]!).toBeCloseTo(11.48, 1);
    expect(min[1]!).toBeCloseTo(0, 5);
    expect(max[1]!).toBeGreaterThan(1.3);
    expect(max[1]!).toBeLessThan(1.6);
    expect(max[2]! - min[2]!).toBeGreaterThan(4.4);
    expect(max[2]! - min[2]!).toBeLessThan(4.8);
    // Slope length of the panel field is about 4.6 m.
    const slope = Math.hypot(max[2]! - min[2]!, max[1]! - 0.6);
    expect(slope).toBeGreaterThan(4.5);
    const tris = json.accessors.filter((a: Accessor) => a.type === "SCALAR").reduce((s: number, a: Accessor) => s + a.count / 3, 0);
    expect(tris).toBeLessThan(400);
  });

  test("turbine tower: 100 m tower, nacelle on top, centred on the base", () => {
    const { json } = parse(buildModel("turbine-tower"));
    const { min, max } = bounds(json);
    expect(min[1]!).toBeCloseTo(0, 5);
    expect(max[1]!).toBeCloseTo(104, 3);
    expect(min[0]!).toBeCloseTo(-2.25, 2);
    expect(max[0]!).toBeCloseTo(2.25, 2);
    // Nacelle: 12 m long, from 4 m behind to 8 m ahead of the tower axis (north is -z in glTF).
    expect(min[2]!).toBeCloseTo(-9, 3);
    expect(max[2]!).toBeCloseTo(4, 3);
    expect(HUB_OFFSET_ENU[2]).toBe(102);
  });

  test("turbine rotor: tip radius about 77 m, flat in the rotor plane, centred on the hub", () => {
    const { json } = parse(buildModel("turbine-rotor"));
    const { min, max } = bounds(json);
    expect(max[1]!).toBeGreaterThan(76);
    expect(max[1]!).toBeLessThan(78);
    expect(Math.min(-min[0]!, max[0]!)).toBeGreaterThan(60);
    // Depth along the spin axis (glTF z) stays within the hub diameter plus blade twist.
    expect(max[2]! - min[2]!).toBeLessThan(6);
    expect(max[2]! - min[2]!).toBeGreaterThan(3.5);
  });
});
