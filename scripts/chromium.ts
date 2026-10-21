import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium } from "playwright";

/** Newest Chromium already installed by Playwright, so the browser checks never have to download one. */
export function findChromium(): string | undefined {
  if (Bun.env.CHROMIUM_PATH) return Bun.env.CHROMIUM_PATH;
  const root = join(Bun.env.LOCALAPPDATA ?? join(Bun.env.HOME ?? "", ".cache"), "ms-playwright");
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    for (const exe of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const p = join(root, d, exe);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

/**
 * Chromium with hardware WebGL by default; SMOKE_GL=swiftshader forces software rendering (slow, but works
 * without a GPU). SMOKE_HEADED=1 shows the window.
 */
export function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    executablePath: findChromium(),
    headless: !Bun.env.SMOKE_HEADED,
    args:
      Bun.env.SMOKE_GL === "swiftshader"
        ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
        : ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=default"],
  });
}
