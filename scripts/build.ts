// Builds the React app into public/ for Vercel, which serves it as static files. Run: bun run build
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import tailwind from "bun-plugin-tailwind";

const OUT_DIR = fileURLToPath(new URL("../public/", import.meta.url));

await rm(OUT_DIR, { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL("../src/web/index.html", import.meta.url))],
  outdir: OUT_DIR,
  plugins: [tailwind],
  minify: true,
  sourcemap: "linked",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`Built ${result.outputs.length} files into public/`);
