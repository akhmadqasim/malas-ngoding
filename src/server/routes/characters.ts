import { join } from "node:path";
import { type RouteTable, error } from "../http.ts";

const DIRECTORY = join(import.meta.dir, "../../../public/characters");
const FILES = new Set(["warga.png", "pemda.png", "teknisi.png"]);
export function characterRoutes(): RouteTable {
  return { "/characters/:name": { GET: async req => {
    const name = String(req.params.name);
    if (!FILES.has(name)) return error("Karakter tidak ditemukan", 404);
    const file = Bun.file(join(DIRECTORY, name));
    if (!await file.exists()) return error("Karakter tidak ditemukan", 404);
    return new Response(file, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" } });
  } } };
}
