import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { Mesh, box, sphere, buildGlb, type Material, type Part } from "./build-models.ts";

type V = [number, number, number];
export type PersonRole = "warga" | "pemda" | "teknisi";
const material = (name: string, baseColor: V): Material => ({ name, baseColor, roughness: 0.8, metallic: 0 });
const skin = material("warm-skin", [0.67, 0.4, 0.25]);
const dark = material("charcoal-fabric", [0.08, 0.1, 0.12]);
const cream = material("helmet-and-shoes", [0.87, 0.85, 0.77]);
const clothes: Record<PersonRole, Material> = { warga: material("sage-blouse", [0.38, 0.45, 0.35]), pemda: material("khaki-uniform", [0.62, 0.49, 0.31]), teknisi: material("teal-jacket", [0.15, 0.37, 0.4]) };

/** Rounded non-boxy body parts; authored in metres in the same ENU frame as the farm models. */
function ellipsoid(mesh: Mesh, c: V, radii: V) {
  const piece = new Mesh(); sphere(piece, [0, 0, 0], 1, 12, 8);
  const offset = mesh.positions.length / 3;
  for (let i = 0; i < piece.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) mesh.positions.push(c[k]! + piece.positions[i + k]! * radii[k]!);
    const n = radii.map((r, k) => piece.normals[i + k]! / r);
    const length = Math.hypot(...n); mesh.normals.push(...n.map(v => v / length));
  }
  mesh.indices.push(...piece.indices.map(i => i + offset));
}
function limb(mesh: Mesh, a: V, b: V, radius: number) {
  const direction = b.map((v, i) => v - a[i]!) as V;
  const length = Math.hypot(...direction);
  const z = direction.map(v => v / length) as V;
  const x: V = [1, 0, 0];
  const y: V = [0, z[2], -z[1]];
  box(mesh, a.map((v, i) => (v + b[i]!) / 2) as V, x.map(v => v * radius) as V, y.map(v => v * radius) as V, z.map(v => v * length / 2) as V);
  sphere(mesh, a, radius, 8, 6); sphere(mesh, b, radius, 8, 6);
}
export function personParts(role: PersonRole, stride: number): Part[] {
  const body = new Mesh(), trousers = new Mesh(), face = new Mesh(), trim = new Mesh(), details = new Mesh();
  ellipsoid(body, [0, 0, 1.13], [0.25, 0.15, 0.36]);
  ellipsoid(trousers, [0, 0, 0.82], [0.21, 0.13, 0.17]);
  for (const side of [-1, 1]) {
    const step = stride * side;
    const hip: V = [side * 0.115, 0, 0.8], knee: V = [side * 0.115, step * 0.13, 0.44], foot: V = [side * 0.115, step * 0.22, 0.12];
    limb(trousers, hip, knee, 0.08); limb(trousers, knee, foot, 0.065);
    ellipsoid(trim, [foot[0], foot[1] + 0.045, 0.08], [0.09, 0.16, 0.08]);
    limb(body, [side * 0.24, 0, 1.35], [side * 0.29, -step * 0.12, 1.07], 0.065);
    limb(body, [side * 0.29, -step * 0.12, 1.07], [side * 0.28, -step * 0.18, 0.87], 0.055);
    sphere(face, [side * 0.28, -step * 0.18, 0.84], 0.06, 8, 6);
  }
  ellipsoid(face, [0, 0, 1.53], [0.075, 0.075, 0.12]);
  ellipsoid(face, [0, 0.015, 1.7], [0.155, 0.145, 0.185]);
  // Face is toward +north, with two small dark eyes and a nose.
  for (const side of [-1, 1]) sphere(details, [side * 0.055, 0.15, 1.72], 0.018, 8, 6);
  sphere(face, [0, 0.163, 1.675], 0.026, 8, 6);
  if (role === "warga") { ellipsoid(trousers, [0, -0.04, 1.72], [0.18, 0.145, 0.2]); ellipsoid(trousers, [0, -0.065, 1.46], [0.2, 0.12, 0.2]); }
  else { ellipsoid(details, [0, -0.02, 1.82], [0.16, 0.13, 0.09]); }
  if (role === "teknisi") { ellipsoid(trim, [0, 0, 1.86], [0.185, 0.18, 0.1]); ellipsoid(trim, [0, 0.035, 1.8], [0.21, 0.21, 0.025]); }
  if (role === "pemda") box(details, [-0.18, 0.17, 1.12], [0.1, 0, 0], [0, 0.015, 0], [0, 0, 0.14]);
  return [{ material: clothes[role], mesh: body }, { material: role === "pemda" ? clothes[role] : dark, mesh: trousers }, { material: skin, mesh: face }, { material: cream, mesh: trim }, { material: dark, mesh: details }];
}
if (import.meta.main) {
  const dir = join(import.meta.dir, "../public/models"); mkdirSync(dir, { recursive: true });
  for (const role of ["warga", "pemda", "teknisi"] as const) for (const [pose, stride] of [["stand", 0], ["step-a", 1], ["step-b", -1]] as const) {
    const name = `person-${role}-${pose}`;
    const bytes = buildGlb(name, personParts(role, stride));
    await Bun.write(join(dir, `${name}.glb`), bytes); console.log(`${name}: ${bytes.byteLength} bytes`);
  }
}
