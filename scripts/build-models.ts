// Generates the procedural 3D models for the Mapbox `model` layer as binary glTF 2.0 files.
// Output: public/models/{solar-table,turbine-tower,turbine-rotor}.glb. Run: `bun scripts/build-models.ts`.
//
// Conventions: 1 unit = 1 metre. Geometry is authored in an ENU frame (x east, y north, z up) and
// written in glTF's own frame (+Y up, +X east, -Z north), so the files are plain glTF 2.0 that any
// viewer shows upright. Everything is generated here from code, so the licence is ours.
//   solar-table   origin: ground centre of the table. Panels face north (ENU +y), tilt 10 degrees.
//   turbine-tower origin: tower base centre. Nacelle front (rotor side) faces ENU +y (north).
//   turbine-rotor origin: hub centre. Spin axis is ENU +y (the nacelle axis); blades lie in the x-z plane.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

type V3 = [number, number, number];

export const GENERATOR = "malas-ngoding scripts/build-models.ts";

/** Position of the rotor hub relative to the tower origin, in ENU metres (x east, y north, z up). */
export const HUB_OFFSET_ENU: V3 = [0, 9, 102];
export const TOWER_HEIGHT = 100;
export const BLADE_LENGTH = 75;
export const HUB_RADIUS = 2;

export type Material = {
  name: string;
  baseColor: [number, number, number];
  metallic: number;
  roughness: number;
};

export const GLASS: Material = { name: "pv-glass", baseColor: [0.05, 0.08, 0.14], metallic: 0.3, roughness: 0.25 };
export const ALUMINIUM: Material = { name: "aluminium", baseColor: [0.75, 0.77, 0.8], metallic: 0.8, roughness: 0.4 };
export const WHITE: Material = { name: "off-white", baseColor: [0.92, 0.93, 0.94], metallic: 0.1, roughness: 0.5 };

// ---------- vector helpers ----------
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l === 0 ? [0, 0, 1] : [a[0] / l, a[1] / l, a[2] / l];
};

/** One mesh per material. Positions and normals are in ENU until the GLB is written. */
export class Mesh {
  positions: number[] = [];
  normals: number[] = [];
  indices: number[] = [];

  private vertex(p: V3, n: V3): number {
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0], n[1], n[2]);
    return this.positions.length / 3 - 1;
  }

  /** Flat convex polygon. `interior` is a point inside the solid, used to orient the face outward. */
  face(pts: V3[], interior: V3): void {
    let ordered = pts;
    let n = norm(cross(sub(pts[1]!, pts[0]!), sub(pts[2]!, pts[0]!)));
    const centre = mul(
      pts.reduce((s, p) => add(s, p), [0, 0, 0] as V3),
      1 / pts.length,
    );
    if (dot(n, sub(centre, interior)) < 0) {
      ordered = [...pts].reverse();
      n = mul(n, -1);
    }
    const ids = ordered.map((p) => this.vertex(p, n));
    for (let i = 1; i < ids.length - 1; i++) this.indices.push(ids[0]!, ids[i]!, ids[i + 1]!);
  }

  /** Smooth triangle from existing vertex ids, wound to agree with the vertex normals. */
  smoothTri(a: number, b: number, c: number): void {
    const p = (i: number): V3 => [this.positions[i * 3]!, this.positions[i * 3 + 1]!, this.positions[i * 3 + 2]!];
    const n = (i: number): V3 => [this.normals[i * 3]!, this.normals[i * 3 + 1]!, this.normals[i * 3 + 2]!];
    const g = cross(sub(p(b), p(a)), sub(p(c), p(a)));
    const avg = add(add(n(a), n(b)), n(c));
    if (dot(g, avg) >= 0) this.indices.push(a, b, c);
    else this.indices.push(a, c, b);
  }

  addSmoothVertex(p: V3, n: V3): number {
    return this.vertex(p, norm(n));
  }

  get triangles(): number {
    return this.indices.length / 3;
  }
}

/** Box from a centre and three half-extent axis vectors (need not be axis aligned). */
export function box(mesh: Mesh, c: V3, hx: V3, hy: V3, hz: V3): void {
  const corner = (sx: number, sy: number, sz: number): V3 => add(c, add(add(mul(hx, sx), mul(hy, sy)), mul(hz, sz)));
  const q = (a: number[], b: number[], d: number[], e: number[]) =>
    mesh.face([corner(a[0]!, a[1]!, a[2]!), corner(b[0]!, b[1]!, b[2]!), corner(d[0]!, d[1]!, d[2]!), corner(e[0]!, e[1]!, e[2]!)], c);
  q([1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]);
  q([-1, -1, -1], [-1, 1, -1], [-1, 1, 1], [-1, -1, 1]);
  q([-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]);
  q([-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]);
  q([-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]);
  q([-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]);
}

/** Cone around the ENU y axis: base ring at `y0` (radius r0), apex-side ring at `y1` (radius r1, 0 for a point). */
export function coneY(mesh: Mesh, centre: V3, y0: number, r0: number, y1: number, r1: number, sides: number): void {
  const ring = (y: number, r: number): V3[] =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2;
      return [centre[0] + Math.cos(a) * r, centre[1] + y, centre[2] + Math.sin(a) * r] as V3;
    });
  const inside: V3 = [centre[0], centre[1] + (y0 + y1) / 2, centre[2]];
  const a = ring(y0, r0);
  const b = ring(y1, r1);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const quad = r1 === 0 ? [a[i]!, a[j]!, b[0]!] : [a[i]!, a[j]!, b[j]!, b[i]!];
    mesh.face(quad, inside);
  }
  mesh.face(a, inside);
  if (r1 > 0) mesh.face(b, inside);
}

/** UV sphere with smooth normals. */
export function sphere(mesh: Mesh, c: V3, r: number, segments: number, rings: number): void {
  const ids: number[][] = [];
  for (let k = 0; k <= rings; k++) {
    const phi = (k / rings) * Math.PI;
    const row: number[] = [];
    for (let s = 0; s < segments; s++) {
      const th = (s / segments) * Math.PI * 2;
      const n: V3 = [Math.sin(phi) * Math.cos(th), Math.sin(phi) * Math.sin(th), Math.cos(phi)];
      row.push(mesh.addSmoothVertex(add(c, mul(n, r)), n));
    }
    ids.push(row);
  }
  for (let k = 0; k < rings; k++) {
    for (let s = 0; s < segments; s++) {
      const s2 = (s + 1) % segments;
      const a = ids[k]![s]!;
      const b = ids[k]![s2]!;
      const d = ids[k + 1]![s]!;
      const e = ids[k + 1]![s2]!;
      if (k > 0) mesh.smoothTri(a, d, b);
      if (k < rings - 1) mesh.smoothTri(b, d, e);
    }
  }
}

// ---------- GLB writer ----------
export type Part = { material: Material; mesh: Mesh };

const pad4 = (n: number) => (n + 3) & ~3;

/** ENU (x east, y north, z up) to glTF (x east, y up, z south). A proper rotation, so winding is kept. */
const toGltf = (v: number[]): number[] => {
  const out: number[] = [];
  for (let i = 0; i < v.length; i += 3) out.push(v[i]!, v[i + 2]!, -v[i + 1]!);
  return out;
};

export function buildGlb(name: string, parts: Part[]): Uint8Array {
  const accessors: object[] = [];
  const bufferViews: object[] = [];
  const primitives: object[] = [];
  const materials: object[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  const push = (bytes: Uint8Array, target: number): number => {
    const padded = new Uint8Array(pad4(bytes.byteLength));
    padded.set(bytes);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    chunks.push(padded);
    offset += padded.byteLength;
    return bufferViews.length - 1;
  };

  parts.forEach((part, mi) => {
    const pos = new Float32Array(toGltf(part.mesh.positions));
    const nor = new Float32Array(toGltf(part.mesh.normals));
    const count = pos.length / 3;
    const idx = count > 65535 ? new Uint32Array(part.mesh.indices) : new Uint16Array(part.mesh.indices);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i++) {
      const k = i % 3;
      min[k] = Math.min(min[k]!, pos[i]!);
      max[k] = Math.max(max[k]!, pos[i]!);
    }
    const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const vp = push(bytes(pos), 34962);
    const vn = push(bytes(nor), 34962);
    const vi = push(bytes(idx), 34963);
    const base = accessors.length;
    accessors.push({ bufferView: vp, componentType: 5126, count, type: "VEC3", min, max });
    accessors.push({ bufferView: vn, componentType: 5126, count, type: "VEC3" });
    accessors.push({ bufferView: vi, componentType: idx instanceof Uint32Array ? 5125 : 5123, count: idx.length, type: "SCALAR" });
    primitives.push({ attributes: { POSITION: base, NORMAL: base + 1 }, indices: base + 2, material: mi, mode: 4 });
    materials.push({
      name: part.material.name,
      pbrMetallicRoughness: {
        baseColorFactor: [...part.material.baseColor, 1],
        metallicFactor: part.material.metallic,
        roughnessFactor: part.material.roughness,
      },
    });
  });

  const json = {
    asset: { version: "2.0", generator: GENERATOR },
    scene: 0,
    scenes: [{ name, nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.byteLength);
  const total = 12 + 8 + jsonLen + 8 + offset;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLen, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.fill(0x20, 20, 20 + jsonLen);
  out.set(jsonBytes, 20);
  const binStart = 20 + jsonLen;
  view.setUint32(binStart, offset, true);
  view.setUint32(binStart + 4, 0x004e4942, true); // "BIN\0"
  let at = binStart + 8;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

// ---------- models ----------
const PANEL_W = 1.13;
const PANEL_L = 2.28;
const PANEL_GAP = 0.02;
const PANEL_T = 0.04;
const TILT = (10 * Math.PI) / 180;
const LOW_EDGE = 0.6;

/** One PV table: 10 columns (east-west) by 2 portrait panels up the slope, tilted 10 degrees, facing north. */
export function solarTableParts(): Part[] {
  const glass = new Mesh();
  const alu = new Mesh();
  const cols = 10;
  const rows = 2;
  const width = cols * PANEL_W + (cols - 1) * PANEL_GAP;
  const slope = rows * PANEL_L + (rows - 1) * PANEL_GAP;
  const up: V3 = [0, -Math.cos(TILT), Math.sin(TILT)]; // up the slope, from the low north edge to the high south edge
  const nrm: V3 = [0, Math.sin(TILT), Math.cos(TILT)]; // panel normal, tilted toward north
  const east: V3 = [1, 0, 0];
  // Underside point at slope distance s, centred east-west. The low edge sits LOW_EDGE above ground.
  const lowY = (slope * Math.cos(TILT)) / 2;
  const under = (s: number): V3 => [0, lowY + up[1] * s, LOW_EDGE + up[2] * s];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const s = r * (PANEL_L + PANEL_GAP) + PANEL_L / 2;
      const x = -width / 2 + c * (PANEL_W + PANEL_GAP) + PANEL_W / 2;
      const centre = add(add(under(s), mul(nrm, PANEL_T / 2)), mul(east, x));
      box(glass, centre, mul(east, PANEL_W / 2), mul(up, PANEL_L / 2), mul(nrm, PANEL_T / 2));
    }
  }

  // Two rails under the panels, running east-west, and four posts below them.
  const railT = 0.06;
  const railW = 0.1;
  const postHalf = 0.05;
  for (const s of [0.5, slope - 0.5]) {
    const c = sub(under(s), mul(nrm, railT / 2));
    box(alu, c, mul(east, width / 2), mul(up, railW / 2), mul(nrm, railT / 2));
    const top = under(s)[2] - nrm[2] * railT;
    for (const x of [-width / 2 + 1.5, width / 2 - 1.5]) {
      box(alu, [x, c[1], top / 2], [postHalf, 0, 0], [0, postHalf, 0], [0, 0, top / 2]);
    }
  }
  return [
    { material: GLASS, mesh: glass },
    { material: ALUMINIUM, mesh: alu },
  ];
}

/** Tower (16 sided tapered tube), nacelle box and a small cone collar at the rotor side. */
export function turbineTowerParts(): Part[] {
  const m = new Mesh();
  const sides = 16;
  const r0 = 2.25;
  const r1 = 1.5;
  const bottom: number[] = [];
  const top: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const n: V3 = [Math.cos(a), Math.sin(a), (r0 - r1) / TOWER_HEIGHT];
    bottom.push(m.addSmoothVertex([Math.cos(a) * r0, Math.sin(a) * r0, 0], n));
    top.push(m.addSmoothVertex([Math.cos(a) * r1, Math.sin(a) * r1, TOWER_HEIGHT], n));
  }
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    m.smoothTri(bottom[i]!, bottom[j]!, top[j]!);
    m.smoothTri(bottom[i]!, top[j]!, top[i]!);
  }
  // Nacelle: 12 m long (north-south), 4 m wide, 4 m high, sitting on the tower top.
  box(m, [0, 2, TOWER_HEIGHT + 2], [2, 0, 0], [0, 6, 0], [0, 0, 2]);
  // Collar cone on the nacelle's north face, ahead of the rotor hub.
  coneY(m, [0, 0, HUB_OFFSET_ENU[2]], 8, 1.9, 9, 1.2, 12);
  return [{ material: WHITE, mesh: m }];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Chord, thickness and twist along the blade at hub-relative radius r (metres). */
export function bladeSection(r: number): { chord: number; thick: number; twist: number } {
  const root = HUB_RADIUS;
  const tip = HUB_RADIUS + BLADE_LENGTH;
  const peak = 12;
  const chord = r <= peak ? lerp(2.0, 4.2, (r - root) / (peak - root)) : lerp(4.2, 0.8, (r - peak) / (tip - peak));
  const twist = ((14 * (tip - r)) / (tip - root)) * (Math.PI / 180);
  return { chord, thick: chord * (r < 8 ? 0.3 : 0.14), twist };
}

/** Three tapered, twisted blades (diamond cross-section) and a hub sphere. */
export function turbineRotorParts(): Part[] {
  const m = new Mesh();
  sphere(m, [0, 0, 0], HUB_RADIUS, 14, 10);
  const stations = [0, 1, 2, 3, 5, 8, 12, 17, 24, 32, 41, 51, 62, 75].map((s) => HUB_RADIUS * 0.8 + s * ((BLADE_LENGTH + HUB_RADIUS * 0.2) / 75));
  for (let b = 0; b < 3; b++) {
    const th = (b / 3) * Math.PI * 2 + Math.PI / 2; // first blade points up
    const radial: V3 = [Math.cos(th), 0, Math.sin(th)];
    const tangent: V3 = [-Math.sin(th), 0, Math.cos(th)];
    const axis: V3 = [0, 1, 0];
    const rings = stations.map((r) => {
      const { chord, thick, twist } = bladeSection(r);
      // Diamond profile: leading edge, upper max, trailing edge, lower max (max thickness at 30 percent chord).
      const prof: [number, number][] = [
        [-0.25 * chord, 0],
        [0.05 * chord, thick / 2],
        [0.75 * chord, 0],
        [0.05 * chord, -thick / 2],
      ];
      return prof.map(([u, v]) => {
        const uu = u * Math.cos(twist) - v * Math.sin(twist);
        const vv = u * Math.sin(twist) + v * Math.cos(twist);
        return add(add(mul(radial, r), mul(tangent, uu)), mul(axis, vv));
      });
    });
    for (let i = 0; i < rings.length - 1; i++) {
      const a = rings[i]!;
      const c = rings[i + 1]!;
      const inside = mul(
        [...a, ...c].reduce((s, p) => add(s, p), [0, 0, 0] as V3),
        1 / 8,
      );
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) % 4;
        m.face([a[k]!, a[k2]!, c[k2]!, c[k]!], inside);
      }
    }
    const last = rings[rings.length - 1]!;
    const prev = rings[rings.length - 2]!;
    const inside = mul(
      [...last, ...prev].reduce((s, p) => add(s, p), [0, 0, 0] as V3),
      1 / 8,
    );
    m.face(last, inside);
  }
  return [{ material: WHITE, mesh: m }];
}

const ROOF_TERRACOTTA: Material = { name: "roof-terracotta", baseColor: [0.55, 0.25, 0.15], metallic: 0.05, roughness: 0.85 };
const DOME: Material = { name: "dome-teal", baseColor: [0.09, 0.4, 0.35], metallic: 0.35, roughness: 0.4 };
const GOLD: Material = { name: "finial-brass", baseColor: [0.8, 0.6, 0.22], metallic: 0.7, roughness: 0.3 };

/** Rooftop details in a 1 m square, scaled to a small part of the selected footprint by the map. */
export function mosqueRoofParts(): Part[] {
  const dome = new Mesh(), trim = new Mesh(), stone = new Mesh();
  // A drum hides the lower half of the sphere; the visible dome has a rounded silhouette.
  box(stone, [0, 0, 0.08], [0.26, 0, 0], [0, 0.26, 0], [0, 0, 0.08]);
  sphere(dome, [0, 0, 0.14], 0.25, 24, 14);
  box(trim, [0, 0, 0.43], [0.012, 0, 0], [0, 0.012, 0], [0, 0, 0.08]);
  sphere(trim, [0, 0, 0.52], 0.025, 10, 8);
  // One slender minaret with a small cap beside the dome.
  box(stone, [0.38, 0.3, 0.28], [0.04, 0, 0], [0, 0.04, 0], [0, 0, 0.28]);
  sphere(dome, [0.38, 0.3, 0.57], 0.065, 12, 8);
  return [{ material: DOME, mesh: dome }, { material: GOLD, mesh: trim }, { material: WHITE, mesh: stone }];
}

export function mechanicalRoofParts(base = 0): Part[] {
  const vents = new Mesh(), glass = new Mesh();
  for (const x of [-0.28, 0, 0.28]) {
    box(vents, [x, 0, base + 0.08], [0.055, 0, 0], [0, 0.1, 0], [0, 0, 0.08]);
    box(glass, [x, 0, base + 0.165], [0.05, 0, 0], [0, 0.09, 0], [0, 0, 0.008]);
  }
  return [{ material: ALUMINIUM, mesh: vents }, { material: GLASS, mesh: glass }];
}

export function warehouseRoofParts(): Part[] {
  const roof = new Mesh();
  const a: V3 = [-0.5, -0.45, 0], b: V3 = [0.5, -0.45, 0], c: V3 = [0.5, 0.45, 0], d: V3 = [-0.5, 0.45, 0];
  const e: V3 = [-0.5, 0, 0.23], f: V3 = [0.5, 0, 0.23], inside: V3 = [0, 0, 0.05];
  roof.face([a, b, f, e], inside); roof.face([d, c, f, e], inside);
  roof.face([a, d, e], inside); roof.face([b, c, f], inside);
  return [{ material: ALUMINIUM, mesh: roof }, ...mechanicalRoofParts(0.24)];
}

export function civicRoofParts(): Part[] {
  const roof = new Mesh(), stone = new Mesh();
  box(roof, [0, 0, 0.1], [0.32, 0, 0], [0, 0.22, 0], [0, 0, 0.08]);
  for (const x of [-0.25, 0, 0.25]) box(stone, [x, -0.18, 0.23], [0.035, 0, 0], [0, 0.035, 0], [0, 0, 0.07]);
  return [{ material: ROOF_TERRACOTTA, mesh: roof }, { material: WHITE, mesh: stone }];
}

export function rooftopPvParts(): Part[] {
  const panels = new Mesh(), frame = new Mesh();
  // Four modules on an aluminium frame; asset origin is the roof, not the ground.
  for (const x of [-1.05, 1.05]) for (const y of [-0.55, 0.55]) {
    box(frame, [x, y, 0.13], [1.02, 0, 0], [0, 0.53, 0], [0, 0, 0.06]);
    box(panels, [x, y, 0.2], [0.98, 0, 0], [0, 0.49, 0], [0, 0, 0.015]);
    for (const u of [-0.49, 0, 0.49]) box(frame, [x + u, y, 0.22], [0.006, 0, 0], [0, 0.49, 0], [0, 0, 0.003]);
  }
  return [{ material: GLASS, mesh: panels }, { material: ALUMINIUM, mesh: frame }];
}

export function previewPanelParts(): Part[] {
  const glass = new Mesh(), frame = new Mesh();
  box(frame, [0,0,0.07], [0.56,0,0], [0,1.11,0], [0,0,0.06]);
  box(glass, [0,0,0.14], [0.52,0,0], [0,1.07,0], [0,0,0.015]);
  for (const y of [-0.7,-0.35,0,0.35,0.7]) box(frame,[0,y,0.16],[0.52,0,0],[0,0.005,0],[0,0,0.002]);
  box(frame,[0,0,0.16],[0.005,0,0],[0,1.07,0],[0,0,0.002]);
  return [{material:GLASS,mesh:glass},{material:ALUMINIUM,mesh:frame}];
}

export const MODELS: Record<string, () => Part[]> = {
  "solar-table": solarTableParts,
  "preview-panel": previewPanelParts,
  "turbine-tower": turbineTowerParts,
  "turbine-rotor": turbineRotorParts,
  "mosque-roof": mosqueRoofParts,
  "warehouse-roof": warehouseRoofParts,
  "mechanical-roof": mechanicalRoofParts,
  "civic-roof": civicRoofParts,
  "rooftop-pv": rooftopPvParts,
};

export function buildModel(name: keyof typeof MODELS & string): Uint8Array {
  return buildGlb(name, MODELS[name]!());
}

if (import.meta.main) {
  const dir = join(import.meta.dir, "..", "public", "models");
  mkdirSync(dir, { recursive: true });
  for (const name of Object.keys(MODELS)) {
    const parts = MODELS[name]!();
    const bytes = buildGlb(name, parts);
    await Bun.write(join(dir, `${name}.glb`), bytes);
    const tris = parts.reduce((s, p) => s + p.mesh.triangles, 0);
    console.log(`${name}.glb  ${bytes.byteLength} bytes  ${tris} triangles`);
  }
}
