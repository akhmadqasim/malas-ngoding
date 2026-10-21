// Warms the caches the demo relies on: the NASA POWER climatology at every region's label point, then the
// government recommendations (written by Claude only when ANTHROPIC_API_KEY is set). Safe to repeat: rows
// already cached are kept. Exits non-zero only when the database fails. Run: bun run warm
import * as db from "../src/server/db.ts";
import { env } from "../src/server/env.ts";
import type { AppDeps } from "../src/server/index.ts";
import { cachedClimatology } from "../src/server/services/cache.ts";
import { climatologyKey, createNasaLookup } from "../src/server/services/nasaPower.ts";
import {
  createClaudeRecommender,
  parseRecommendationItems,
  recommendationsFor,
} from "../src/server/services/recommendations.ts";
import { fmtNumber } from "../src/shared/format.ts";
import type { RegionSummary } from "../src/shared/types.ts";

type WarmDeps = Pick<AppDeps, "db" | "nasa" | "recommender">;

export interface WarmSummary {
  regions: number;
  /** Regions whose climatology is in the cache after the run. */
  climateStored: number;
  /** Regions whose AI recommendations are in the cache after the run. */
  aiStored: number;
  /** AI recommendations written by this run. */
  aiCreated: number;
  /** True without an API key: no AI recommendations were attempted. */
  aiSkipped: boolean;
  /** Upstream problems (NASA POWER, Claude), one Indonesian line each. Database problems throw instead. */
  failures: string[];
}

/** Regions warmed at the same time; NASA POWER and Claude each take seconds per call. */
const CONCURRENCY = 3;

async function hasRecommendations(deps: WarmDeps, regionId: string): Promise<boolean> {
  const row = await deps.db.recommendationsGet(regionId);
  return row !== null && parseRecommendationItems(row.items) !== null;
}

/** Warms one region and returns its report line. Throws when the database fails. */
async function warmRegion(deps: WarmDeps, region: RegionSummary, summary: WarmSummary): Promise<string> {
  const point = await deps.db.regionLabelPoint(region.id);
  if (!point) throw new Error(`titik label ${region.name} tidak ada di database`);
  const [lng, lat] = point;
  const parts: string[] = [];

  const climate = await cachedClimatology(deps, lat, lng);
  if (climate.fallback) {
    summary.failures.push(`${region.name}: data surya NASA POWER gagal diambil`);
    parts.push("data surya gagal diambil dari NASA POWER");
  } else {
    // cachedClimatology swallows write errors, so read the row back to be sure it was stored.
    if (!(await deps.db.climatologyGet(climatologyKey(lat, lng)))) {
      throw new Error(`data surya ${region.name} tidak tersimpan di database`);
    }
    summary.climateStored++;
    parts.push(`data surya ${fmtNumber(climate.pshYear, 2)} jam puncak per hari`);
  }

  if (!deps.recommender) {
    parts.push("rekomendasi AI dilewati");
  } else if (await hasRecommendations(deps, region.id)) {
    summary.aiStored++;
    parts.push("rekomendasi AI sudah ada");
  } else if (climate.fallback) {
    parts.push("rekomendasi AI menunggu data surya");
  } else {
    const out = await recommendationsFor(deps, region.id);
    if (out?.model) {
      if (!(await hasRecommendations(deps, region.id))) {
        throw new Error(`rekomendasi ${region.name} tidak tersimpan di database`);
      }
      summary.aiStored++;
      summary.aiCreated++;
      parts.push(`rekomendasi AI dibuat (${out.model})`);
    } else {
      summary.failures.push(`${region.name}: rekomendasi AI gagal dibuat`);
      parts.push("rekomendasi AI gagal, panel memakai rekomendasi berbasis aturan");
    }
  }
  return `- ${region.name}: ${parts.join("; ")}`;
}

/** Warms every region, a few at a time, and logs one line per region plus a total. Throws on database errors. */
export async function warmCaches(deps: WarmDeps, log: (line: string) => void = console.log): Promise<WarmSummary> {
  const regions = await deps.db.listRegions();
  const summary: WarmSummary = {
    regions: regions.length,
    climateStored: 0,
    aiStored: 0,
    aiCreated: 0,
    aiSkipped: deps.recommender === null,
    failures: [],
  };
  log(`Memanaskan cache untuk ${regions.length} wilayah...`);
  if (summary.aiSkipped) {
    log("ANTHROPIC_API_KEY kosong: rekomendasi AI dilewati, panel memakai rekomendasi berbasis aturan.");
  }

  const queue = [...regions];
  let stopped = false;
  const worker = async () => {
    for (let region = queue.shift(); region && !stopped; region = queue.shift()) {
      try {
        log(await warmRegion(deps, region, summary));
      } catch (err) {
        stopped = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  const ai = summary.aiSkipped ? "dilewati" : `${summary.aiStored}/${summary.regions} wilayah`;
  log(`Selesai: data surya ${summary.climateStored}/${summary.regions} wilayah, rekomendasi AI ${ai}.`);
  return summary;
}

if (import.meta.main) {
  try {
    const summary = await warmCaches({
      db,
      nasa: createNasaLookup(),
      recommender: env.anthropicApiKey ? createClaudeRecommender(env.anthropicApiKey) : null,
    });
    if (summary.failures.length > 0) {
      console.log(
        "Sebagian gagal. Periksa koneksi internet dan ANTHROPIC_API_KEY, lalu jalankan `bun run warm` lagi; data yang sudah tersimpan tidak diulang.",
      );
    }
  } catch (err) {
    console.error("Gagal memanaskan cache:", err instanceof Error ? err.message : "unknown error");
    process.exitCode = 1;
  } finally {
    await db.sql.close();
  }
}
