// Builds the React app into dist/vercel/ for Vercel, which serves it as static files, with the 3D models and
// characters from public/ copied beside it. Run: bun run build
import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import tailwind from "bun-plugin-tailwind";

const OUT_DIR = fileURLToPath(new URL("../dist/vercel/", import.meta.url));

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
for (const dir of ["models", "characters"]) {
  await cp(fileURLToPath(new URL(`../public/${dir}/`, import.meta.url)), `${OUT_DIR}${dir}`, { recursive: true });
}
console.log(`Built ${result.outputs.length} files into dist/vercel/`);
