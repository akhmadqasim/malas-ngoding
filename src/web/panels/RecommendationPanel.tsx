import { ArrowsRotateRight } from "../icons.ts";
import { Accordion, Button, ProgressBar, Skeleton } from "@heroui/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { RecommendationCategory, RecommendationItem, Recommendations, RegionSummary } from "../../shared/types.ts";
import { ApiError, api } from "../api.ts";
import { chem } from "../components/Chem.tsx";
import { Estimate } from "../components/Estimate.tsx";
import "../recommendations.css";

export const CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  energi_terbarukan: "Energi terbarukan",
  efisiensi: "Efisiensi energi",
  tata_ruang: "Tata ruang",
  akses_listrik: "Akses listrik",
  kebijakan: "Kebijakan",
};

/** What each priority means; the same words the recommendation prompt gives Claude. */
export const PRIORITY_LABELS: Record<RecommendationItem["priority"], string> = {
  1: "paling mendesak",
  2: "langkah penting berikutnya",
  3: "langkah pendukung",
};

const dateFormat = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Makassar" });

/** The day a recommendation was written, in WITA (the app's time zone); empty for a broken date. */
export function fmtWrittenOn(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

/** Who wrote the items: Claude (with the model and the day) or the fixed rules (`model: null`). */
export function provenance({ model, generatedAt }: Pick<Recommendations, "model" | "generatedAt">): string {
  if (model === null) {
    return "Berbasis aturan: AI sedang tidak tersedia, jadi saran ini disusun dari aturan tetap atas data wilayah ini.";
  }
  const day = fmtWrittenOn(generatedAt);
  return `Ditulis AI (${model})${day ? ` pada ${day}` : ""}, hanya dari angka di peta ini. Periksa lagi sebelum dipakai untuk keputusan.`;
}

/**
 * An impact that states a number the text itself does not already call an estimate gets "perkiraan". A
 * heuristic per impact, not per number: one "(perkiraan)" anywhere in it counts for all its numbers.
 */
export function impactNeedsEstimate(impact: string): boolean {
  return /\d/.test(impact) && !/perkiraan/i.test(impact);
}

// --- Data ----------------------------------------------------------------------------------------

/** Who the recommendations address: "Pemkot Samarinda", "Pemkab Mahakam Ulu", or local government in general. */
export function recommendationsHeading(regionName?: string, kind?: RegionSummary["kind"]): string {
  if (!regionName || !kind) return "Rekomendasi untuk pemerintah daerah";
  return `Rekomendasi untuk ${kind === "kota" ? "Pemkot" : "Pemkab"} ${regionName}`;
}

type State = { status: "loading" } | { status: "ready"; data: Recommendations } | { status: "error"; message: string };
/** The "Perbarui" request: none, running, or a sentence about how it ended when it brought nothing new. */
export type RefreshState = { status: "idle" } | { status: "pending" } | { status: "kept"; message: string };

/** Said when the server answered a refresh with the copy it already had (Claude could not write a new one). */
export const REFRESH_KEPT = "AI belum bisa menulis ulang sekarang, jadi yang tampil masih versi sebelumnya.";

function useRecommendations(regionId: string): [State, () => void, RefreshState, () => void] {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [refreshState, setRefreshState] = useState<RefreshState>({ status: "idle" });
  const refreshing = useRef<AbortController | null>(null);
  // Another region (or leaving the panel) drops a refresh still on its way.
  useEffect(
    () => () => {
      refreshing.current?.abort();
      refreshing.current = null;
      setRefreshState({ status: "idle" });
    },
    [regionId],
  );
  useEffect(() => {
    const abort = new AbortController();
    setState({ status: "loading" });
    // No client cache: the server's cache answers in a few ms, and only the server knows which answers it
    // kept (rule-based ones and those written on assumed sun hours are retried on the next request).
    api
      .recommendations(regionId, abort.signal)
      .then((data) => {
        if (!abort.signal.aborted) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        setState({ status: "error", message: err instanceof ApiError ? err.message : "Terjadi kesalahan yang tidak terduga." });
      });
    return () => abort.abort();
  }, [regionId, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const shownAt = state.status === "ready" ? state.data.generatedAt : null;
  const refresh = useCallback(() => {
    if (refreshing.current) return;
    const abort = new AbortController();
    refreshing.current = abort;
    setRefreshState({ status: "pending" });
    api
      .refreshRecommendations(regionId, abort.signal)
      .then((data) => {
        if (abort.signal.aborted) return;
        setState({ status: "ready", data });
        // The server keeps the old copy when Claude cannot write a new one: say so instead of pretending.
        setRefreshState(data.generatedAt === shownAt ? { status: "kept", message: REFRESH_KEPT } : { status: "idle" });
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        const reason = err instanceof ApiError ? ` ${err.message}` : "";
        setRefreshState({ status: "kept", message: `Rekomendasi belum bisa diperbarui.${reason} Yang tampil masih versi sebelumnya.` });
      })
      .finally(() => {
        if (refreshing.current === abort) refreshing.current = null;
      });
  }, [regionId, shownAt]);
  return [state, retry, refreshState, refresh];
}

/** Milliseconds since `active` turned on, updated every `stepMs`; 0 while off. */
function useElapsed(active: boolean, stepMs: number): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return setElapsed(0);
    const start = performance.now();
    const timer = setInterval(() => setElapsed(performance.now() - start), stepMs);
    return () => clearInterval(timer);
  }, [active, stepMs]);
  return elapsed;
}

// --- View ----------------------------------------------------------------------------------------

/** Progress ticks. A cached answer arrives in a few ms, so the loading view waits for the first tick and never flashes. */
const TICK_MS = 250;
/** Claude's first answer takes 8 to 10 s. The line fills toward 90% on this time scale and never claims 100%. */
const EXPECTED_MS = 4000;
const SLOW_MS = 12_000;

/**
 * "Rekomendasi untuk Pemkot Samarinda" in the region detail: Claude's (or the rules') advice for the region.
 * The name and kind only shape the heading; without them it says "pemerintah daerah".
 */
export function RecommendationPanel({ regionId, regionName, kind }: { regionId: string; regionName?: string; kind?: RegionSummary["kind"] }) {
  const [state, retry, refreshState, refresh] = useRecommendations(regionId);
  const elapsed = useElapsed(state.status === "loading", TICK_MS);
  const headingId = useId();
  const showLoading = state.status === "loading" && elapsed > 0;

  return (
    <section className="recs" aria-labelledby={headingId} aria-busy={state.status === "loading" || refreshState.status === "pending"}>
      <div className="recs__head">
        <h3 id={headingId} className="recs__title">
          {recommendationsHeading(regionName, kind)}
        </h3>
        {state.status === "ready" && <RecommendationRefreshButton pending={refreshState.status === "pending"} onRefresh={refresh} />}
      </div>
      {state.status === "ready" && <RecommendationRefreshNote state={refreshState} />}
      {state.status === "ready" && <RecommendationList data={state.data} />}
      {state.status === "error" && <RecommendationFailure message={state.message} onRetry={retry} />}
      {showLoading && <RecommendationLoading elapsedMs={elapsed} />}
    </section>
  );
}

/** A calm progress line plus skeleton rows in the shape of the list (00-direction section 8: flat, no shimmer). */
export function RecommendationLoading({ elapsedMs }: { elapsedMs: number }) {
  const value = Math.round(90 * (1 - Math.exp(-elapsedMs / EXPECTED_MS)));
  const note =
    elapsedMs < SLOW_MS
      ? "Menyusun rekomendasi dari data wilayah ini. Biasanya butuh 8 sampai 10 detik."
      : "Masih menyusun. Jawaban pertama untuk satu wilayah kadang butuh hingga dua menit.";
  return (
    <div className="recs__loading">
      <ProgressBar
        aria-label="Menyusun rekomendasi"
        valueLabel="Sedang menyusun"
        value={value}
        size="sm"
        color="default"
        className="recs__progress"
      >
        <ProgressBar.Track>
          <ProgressBar.Fill />
        </ProgressBar.Track>
      </ProgressBar>
      <p className="recs__note" role="status">
        {note}
      </p>
      <div className="recs__skeleton" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="recs__skeleton-item">
            <Skeleton animationType="none" className="recs__skeleton-line recs__skeleton-line--title" />
            <Skeleton animationType="none" className="recs__skeleton-line recs__skeleton-line--meta" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * "Perbarui": asks Claude to write the region's recommendations again (the refresh route). A quiet text
 * button beside the heading; while it runs it says so and cannot be pressed twice.
 */
export function RecommendationRefreshButton({ pending, onRefresh }: { pending: boolean; onRefresh: () => void }) {
  return (
    <Button size="sm" variant="ghost" className="recs__refresh" isPending={pending} onPress={onRefresh}>
      <ArrowsRotateRight aria-hidden />
      {pending ? "Memperbarui" : "Perbarui"}
    </Button>
  );
}

/** One quiet line under the heading while a refresh runs, or when it ended without new items. */
export function RecommendationRefreshNote({ state }: { state: RefreshState }) {
  if (state.status === "idle") return null;
  return (
    <p className="recs__note recs__note--refresh" role="status">
      {state.status === "pending"
        ? "Menulis ulang rekomendasi dari data wilayah ini. Biasanya butuh 8 sampai 10 detik; daftar di bawah tetap bisa dibaca."
        : state.message}
    </p>
  );
}

/** One sentence about what failed and a "Coba lagi" button. */
export function RecommendationFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="recs__failure" role="alert">
      <p className="recs__failure-text">
        Rekomendasi belum bisa dimuat. <span className="recs__failure-reason">{message}</span>
      </p>
      <Button size="sm" variant="primary" onPress={onRetry}>
        Coba lagi
      </Button>
    </div>
  );
}

/** The items, most urgent first. The first one is open; the rest open on a click. */
export function RecommendationList({ data }: { data: Recommendations }) {
  return (
    <>
      <p className="recs__source" data-model={data.model ?? "aturan"}>
        {provenance(data)}
      </p>
      <Accordion allowsMultipleExpanded defaultExpandedKeys={["0"]} className="recs__list">
        {data.items.map((item, i) => (
          <Accordion.Item key={i} id={String(i)} className="rec">
            <Accordion.Heading level={4}>
              <Accordion.Trigger className="rec__trigger">
                <span className="rec__head">
                  <span className="rec__title">{chem(item.title)}</span>
                  <span className="rec__meta">
                    <PriorityMark priority={item.priority} />
                    Prioritas {item.priority}, {CATEGORY_LABELS[item.category].toLowerCase()}
                  </span>
                </span>
                <Accordion.Indicator className="rec__indicator" />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="rec__body">
                <p className="rec__text">{chem(item.body)}</p>
                <p className="rec__impact-label">
                  Dampak yang diharapkan{impactNeedsEstimate(item.impact) && <>, <Estimate /></>}
                </p>
                <p className="rec__impact">{chem(item.impact)}</p>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
      <p className="recs__key">Prioritas 1 {PRIORITY_LABELS[1]}, 2 {PRIORITY_LABELS[2]}, 3 {PRIORITY_LABELS[3]}.</p>
    </>
  );
}

/** Three short bars, as many filled as the item is urgent: priority 1 fills all three. */
function PriorityMark({ priority }: { priority: RecommendationItem["priority"] }) {
  return (
    <span className="rec__priority" aria-hidden>
      {[1, 2, 3].map((step) => (
        <span key={step} className="rec__priority-step" data-on={step <= 4 - priority || undefined} />
      ))}
    </span>
  );
}
