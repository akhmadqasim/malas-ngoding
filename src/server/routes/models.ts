import { join } from "node:path";
import { type RouteTable, error } from "../http.ts";

/** Where the generated 3D models live (scripts/build-models.ts writes them). */
const MODEL_DIR = join(import.meta.dir, "../../../public/models");
/** Only plain file names of binary glTF: no folders, no dots before the extension, nothing to climb out with. */
const SAFE_NAME = /^[a-z0-9-]+\.glb$/;

/** The 3D models the map places (solar tables, wind turbines), served as `model/gltf-binary`. */
export function modelRoutes(): RouteTable {
  return {
    "/models/:name": {
      GET: async (req) => {
        const name = String(req.params.name);
        if (!SAFE_NAME.test(name)) return error("Model tidak ditemukan", 404);
        const file = Bun.file(join(MODEL_DIR, name));
        if (!(await file.exists())) return error("Model tidak ditemukan", 404);
        return new Response(file, {
          headers: { "Content-Type": "model/gltf-binary", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  };
}
