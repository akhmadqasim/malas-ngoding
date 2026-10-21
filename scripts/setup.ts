// Prepares a fresh checkout in one command: waits for the database, applies the migrations, loads the
// seed data and warms the caches. Safe to repeat. Run: bun run setup
import { fileURLToPath } from "node:url";
import { sql } from "../src/server/db.ts";
import { env } from "../src/server/env.ts";
import { fmtNumber } from "../src/shared/format.ts";
import { runMigrations } from "./migrate.ts";
import { seedAll } from "./seed.ts";

const WARM_URL = new URL("./warm.ts", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
/** The value `.env.example` ships with. */
const PLACEHOLDER_TOKEN = "pk.your-public-token";

/** Table name from `seedAll()` -> words for the log line. */
const SEED_LABELS: Record<string, string> = {
  regions: "wilayah",
  power_plants: "pembangkit",
  grid_mix: "baris bauran listrik",
  building_types: "jenis bangunan",
  equivalents: "faktor padanan",
};

export interface SetupDeps {
  /** Resolves when the database answers a query, rejects when it does not. */
  ping: () => Promise<void>;
  /** Applies the pending migrations; returns their names. */
  migrate: () => Promise<string[]>;
  /** Upserts the seed files; returns the row count per table. */
  seed: () => Promise<Record<string, number>>;
  /** Absolute path of scripts/warm.ts, or null while that file does not exist. */
  warmScript: () => Promise<string | null>;
  /** Runs the warm script in its own process; returns its exit code. */
  runWarm: (script: string) => Promise<number>;
  /** Closes the database connection. */
  close: () => Promise<void>;
  log: (line: string) => void;
  error: (line: string) => void;
  /** host:port of the database, for messages. Never carries the credentials. */
  target: string;
  /** Port the app listens on, for the closing hint. */
  port: number;
  mapboxToken: string;
}

export interface SetupOptions {
  /** How long to wait for the database to come up. */
  dbWaitMs?: number;
  /** Pause between two attempts. */
  dbRetryMs?: number;
}

/** First line of an error message, so one failure never floods the terminal. */
function describe(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.split("\n")[0]?.trim() || "kesalahan tidak diketahui";
}

/**
 * Why the Mapbox token will not work in the browser, or null when it looks fine. The token is sent to
 * every visitor through /api/config, so a secret (sk.) token must never be used here.
 */
export function mapboxTokenProblem(token: string): string | null {
  const value = token.trim();
  if (value === "" || value === PLACEHOLDER_TOKEN) {
    return "MAPBOX_TOKEN belum diisi di .env, jadi peta tidak akan tampil. Isi dengan token publik Mapbox (diawali pk.).";
  }
  if (!value.startsWith("pk.")) {
    return "MAPBOX_TOKEN bukan token publik (harus diawali pk.). Token ini dikirim ke browser lewat /api/config, jadi jangan pakai token rahasia (sk.).";
  }
  return null;
}

/** Retries `ping` until the database answers or `waitMs` has passed; then rethrows the last error. */
async function waitForDatabase(deps: SetupDeps, waitMs: number, retryMs: number): Promise<void> {
  const deadline = Date.now() + waitMs;
  let announced = false;
  for (;;) {
    try {
      await deps.ping();
      return;
    } catch (err) {
      if (Date.now() >= deadline) throw err;
      if (!announced) {
        deps.log(`Database belum menjawab, mencoba lagi sampai ${fmtNumber(waitMs / 1000)} detik ...`);
        announced = true;
      }
      await Bun.sleep(retryMs);
    }
  }
}

/** Runs the setup steps and returns the process exit code: 0 when everything worked, 1 otherwise. */
export async function runSetup(deps: SetupDeps, opts: SetupOptions = {}): Promise<number> {
  const { dbWaitMs = 30_000, dbRetryMs = 1_000 } = opts;
  const started = Date.now();
  deps.log(`Malas Ngoding: menyiapkan database di ${deps.target}`);

  // Migrate and seed share one connection, which is closed before the warm script opens its own.
  try {
    try {
      await waitForDatabase(deps, dbWaitMs, dbRetryMs);
    } catch (err) {
      deps.error(`Gagal: database di ${deps.target} tidak menjawab setelah ${fmtNumber(dbWaitMs / 1000)} detik (${describe(err)}).`);
      deps.error(
        "Pastikan Docker berjalan, lalu jalankan `docker compose up -d` dan tunggu sampai `docker compose ps` menampilkan status healthy. Setelah itu ulangi `bun run setup`.",
      );
      return 1;
    }
    deps.log("Database siap.");

    deps.log("[1/3] Migrasi skema database ...");
    try {
      const applied = await deps.migrate();
      deps.log(
        applied.length > 0
          ? `      ${applied.length} migrasi diterapkan: ${applied.join(", ")}`
          : "      tidak ada migrasi baru, skema sudah terbaru",
      );
    } catch (err) {
      deps.error(`Gagal pada langkah migrasi: ${describe(err)}`);
      deps.error("Setup dihentikan. Perbaiki masalahnya, lalu ulangi `bun run setup`.");
      return 1;
    }

    deps.log("[2/3] Mengisi data awal (seed) ...");
    try {
      const counts = await deps.seed();
      deps.log(`      ${Object.entries(counts).map(([table, n]) => `${fmtNumber(n)} ${SEED_LABELS[table] ?? table}`).join(", ")}`);
    } catch (err) {
      deps.error(`Gagal pada langkah seed: ${describe(err)}`);
      deps.error("Seed berjalan dalam satu transaksi, jadi tidak ada data yang tersimpan setengah jadi. Setup dihentikan.");
      return 1;
    }
  } finally {
    try {
      await deps.close();
    } catch {
      // The connection is going away with the process anyway.
    }
  }

  deps.log("[3/3] Memanaskan cache ...");
  const script = await deps.warmScript();
  if (script === null) {
    deps.log("      dilewati: scripts/warm.ts belum ada di versi ini. Cache terisi sendiri saat aplikasi dipakai.");
  } else {
    const code = await deps.runWarm(script);
    if (code !== 0) {
      deps.error(`Pemanasan cache gagal (kode keluar ${code}).`);
      deps.error("Migrasi dan seed sudah selesai, jadi aplikasi tetap bisa dijalankan dengan `bun dev`. Ulangi pemanasan nanti dengan `bun run warm`.");
      return 1;
    }
  }

  const problem = mapboxTokenProblem(deps.mapboxToken);
  if (problem) deps.log(`Catatan: ${problem}`);
  const seconds = fmtNumber((Date.now() - started) / 1000, 1);
  deps.log(`Setup selesai dalam ${seconds} detik. Berikutnya: jalankan \`bun dev\`, lalu buka http://localhost:${deps.port}`);
  return 0;
}

/** host:port of a connection string; the user name and password are left out. */
function databaseTarget(url: string): string {
  try {
    const { hostname, port } = new URL(url);
    return port ? `${hostname}:${port}` : hostname;
  } catch {
    return "database";
  }
}

async function findWarmScript(): Promise<string | null> {
  return (await Bun.file(WARM_URL).exists()) ? fileURLToPath(WARM_URL) : null;
}

/** The warm script runs in its own process, so its output shows as it happens and it cannot end this one. */
async function runWarmScript(script: string): Promise<number> {
  const proc = Bun.spawn([process.execPath, script], {
    cwd: REPO_ROOT,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
}

export function defaultDeps(): SetupDeps {
  return {
    ping: async () => {
      await sql`SELECT 1`;
    },
    migrate: runMigrations,
    seed: seedAll,
    warmScript: findWarmScript,
    runWarm: runWarmScript,
    close: () => sql.close(),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
    target: databaseTarget(env.databaseUrl),
    port: env.port,
    mapboxToken: env.mapboxToken,
  };
}

if (import.meta.main) {
  process.exit(await runSetup(defaultDeps()));
}
