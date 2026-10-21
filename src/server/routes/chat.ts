import type { BunRequest, Server } from "bun";
import { resolveRegion } from "../../shared/regionAlias.ts";
import type { BuildingEstimate, BuildingType } from "../../shared/types.ts";
import type { AppDeps } from "../index.ts";
import { error, safe } from "../http.ts";
import type { ChatAction } from "../services/chatTools.ts";
import {
  type ChatContext,
  type HistoryTurn,
  type SelectedBuilding,
  buildMessages,
  chatErrorMessage,
  runChat,
} from "../services/claude.ts";

/** Messages of the session sent to Claude as history. */
export const CHAT_HISTORY_LIMIT = 20;
const MAX_MESSAGE_CHARS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Body of POST /api/chat. */
export interface ChatRequest {
  sessionId: string;
  message: string;
  context: {
    selectedRegionId: string | null;
    selectedBuilding: BuildingEstimate | null;
    view: { center: [number, number]; zoom: number };
  };
}

/** Server-sent events of POST /api/chat: text and action events while Claude answers, then one done or one error. */
export type ChatEvent =
  | { event: "text"; data: { delta: string } }
  | { event: "action"; data: ChatAction }
  | { event: "done"; data: Record<string, never> }
  | { event: "error"; data: { message: string } };

interface ParsedRequest {
  sessionId: string;
  message: string;
  context: ChatContext;
}

const BUILDING_TYPES: Record<BuildingType, true> = {
  rumah: true,
  ruko: true,
  kantor: true,
  pemerintahan: true,
  sekolah: true,
  kampus: true,
  rumah_sakit: true,
  hotel: true,
  mal: true,
  ibadah: true,
  gudang: true,
  industri: true,
};
const TYPE_SOURCES: readonly string[] = ["poi", "footprint", "user"];
/** Client-supplied assumption texts that reach the prompt: the first 5, each cut to 200 characters. */
const MAX_ASSUMPTIONS = 5;
const MAX_ASSUMPTION_CHARS = 200;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isShortText = (v: unknown, max = 100): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** The selected building, null, or undefined when it is not a valid BuildingEstimate. Only the fields the chat reads are kept. */
function parseBuilding(v: unknown): SelectedBuilding | null | undefined {
  if (v === null) return null;
  if (!isObject(v)) return undefined;
  const { type, typeSource, floors, floorAreaM2, kwhYear, co2KgYear } = v;
  if (typeof type !== "string" || !Object.hasOwn(BUILDING_TYPES, type)) return undefined;
  if (typeof typeSource !== "string" || !TYPE_SOURCES.includes(typeSource)) return undefined;
  if (!isNum(floors) || floors < 1 || floors > 40) return undefined;
  if (!isNum(floorAreaM2) || floorAreaM2 <= 0) return undefined;
  if (!isNum(kwhYear) || kwhYear < 0 || !isNum(co2KgYear) || co2KgYear < 0) return undefined;
  const region = v.region ?? null;
  if (region !== null && !(isObject(region) && isShortText(region.id) && isShortText(region.name))) return undefined;
  const assumptions = v.assumptions ?? [];
  if (!Array.isArray(assumptions) || !assumptions.every((a) => typeof a === "string")) return undefined;
  const kept = (assumptions as string[])
    .map((a) => a.trim())
    .filter((a) => a !== "")
    .slice(0, MAX_ASSUMPTIONS)
    .map((a) => a.slice(0, MAX_ASSUMPTION_CHARS));
  return {
    type: type as BuildingType,
    typeSource: typeSource as SelectedBuilding["typeSource"],
    floors,
    floorAreaM2,
    kwhYear,
    co2KgYear,
    region: region === null ? null : { id: region.id as string, name: region.name as string },
    assumptions: kept,
  };
}

function parseContext(v: unknown): { context: ChatContext } | { problem: string } {
  if (!isObject(v)) return { problem: "Konteks peta (context) harus berupa objek." };
  const view = v.view;
  const center = isObject(view) ? view.center : undefined;
  if (
    !isObject(view) ||
    !Array.isArray(center) ||
    center.length !== 2 ||
    !isNum(center[0]) ||
    center[0] < -180 ||
    center[0] > 180 ||
    !isNum(center[1]) ||
    center[1] < -90 ||
    center[1] > 90 ||
    !isNum(view.zoom) ||
    view.zoom < 0 ||
    view.zoom > 24
  ) {
    return { problem: "Posisi peta (context.view) harus berisi center [lng, lat] dan zoom yang valid." };
  }
  // Missing selections count as none; present ones must have the right type.
  const regionId = v.selectedRegionId ?? null;
  if (regionId !== null && !isShortText(regionId)) {
    return { problem: "Wilayah terpilih (context.selectedRegionId) harus berupa teks atau null." };
  }
  const building = parseBuilding(v.selectedBuilding ?? null);
  if (building === undefined) return { problem: "Gedung terpilih (context.selectedBuilding) tidak valid." };
  return {
    context: {
      selectedRegionId: regionId === null ? null : resolveRegion(regionId),
      selectedBuilding: building,
      view: { center: [center[0], center[1]], zoom: view.zoom },
    },
  };
}

function parseChatRequest(body: unknown): { request: ParsedRequest } | { problem: string } {
  if (!isObject(body)) return { problem: "Isi permintaan chat harus berupa objek JSON." };
  if (typeof body.sessionId !== "string" || !UUID.test(body.sessionId)) return { problem: "sessionId harus berupa UUID." };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length === 0 || message.length > MAX_MESSAGE_CHARS) {
    return { problem: "Pesan harus berisi 1 sampai 2.000 karakter." };
  }
  const parsed = parseContext(body.context);
  if ("problem" in parsed) return parsed;
  return { request: { sessionId: body.sessionId.toLowerCase(), message, context: parsed.context } };
}

// ---------- persistence: a broken store must not break the answer ----------

function warn(what: string, err: unknown): void {
  console.warn(`${what}:`, err instanceof Error ? err.message : "unknown error");
}

/** Creates the session on first use and returns its last messages; [] when the store is down. */
async function loadHistory(deps: AppDeps, sessionId: string): Promise<HistoryTurn[]> {
  try {
    await deps.db.ensureChatSession(sessionId);
    return await deps.db.chatHistory(sessionId, CHAT_HISTORY_LIMIT);
  } catch (err) {
    warn("chat history unavailable", err);
    return [];
  }
}

async function storeMessage(
  deps: AppDeps,
  sessionId: string,
  role: "user" | "assistant",
  content: Record<string, unknown>,
): Promise<void> {
  try {
    await deps.db.addChatMessage(sessionId, role, content);
  } catch (err) {
    warn(`chat ${role} message not stored`, err);
  }
}

/** One question and its answer, streamed through `send`. Resolves when the stream may close. */
async function converse(
  deps: AppDeps,
  { sessionId, message, context }: ParsedRequest,
  send: (event: ChatEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const history = await loadHistory(deps, sessionId);
  await storeMessage(deps, sessionId, "user", { text: message });
  const outcome = await runChat({
    deps,
    messages: buildMessages(history, message, context, new Date()),
    signal,
    onText: (delta) => send({ event: "text", data: { delta } }),
    onAction: (action) => send({ event: "action", data: action }),
  });
  if (outcome.status === "done") {
    // Stored before `done`, so a follow-up question sent right away already sees this answer.
    await storeMessage(deps, sessionId, "assistant", { text: outcome.text, actions: outcome.actions });
    send({ event: "done", data: {} });
  } else if (outcome.status === "error") {
    send({ event: "error", data: { message: outcome.message } });
  }
  // "aborted": the client is gone, so there is nobody to answer and no answer to store.
}

const encoder = new TextEncoder();

/**
 * A text/event-stream response fed by `produce`. When the client disconnects (request signal or stream
 * cancel), the signal given to `produce` aborts. The stream closes when `produce` settles.
 */
function eventStream(
  req: Request,
  produce: (send: (event: ChatEvent) => void, signal: AbortSignal) => Promise<void>,
): Response {
  const disconnect = new AbortController();
  const onAbort = () => disconnect.abort();
  req.signal.addEventListener("abort", onAbort, { once: true });
  let open = true;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`));
        } catch {
          open = false;
        }
      };
      void produce(send, disconnect.signal)
        .catch((err) => {
          // produce() handles its own failures; this only keeps a bug from becoming an unhandled rejection.
          console.error("chat stream failed:", err instanceof Error ? err.message : "unknown error");
          send({ event: "error", data: { message: chatErrorMessage(err) } });
        })
        .finally(() => {
          req.signal.removeEventListener("abort", onAbort);
          if (!open) return;
          open = false;
          try {
            controller.close();
          } catch {
            // Already closed by a disconnect.
          }
        });
    },
    cancel() {
      open = false;
      disconnect.abort();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      // Keeps reverse proxies such as nginx from buffering the stream.
      "x-accel-buffering": "no",
    },
  });
}

export function chatRoutes(deps: AppDeps) {
  return {
    "/api/chat": {
      POST: (req: BunRequest, server: Server<undefined>) =>
        safe(async (r) => {
          let body: unknown;
          try {
            body = await r.json();
          } catch {
            return error("Isi permintaan bukan JSON yang valid.", 400);
          }
          const parsed = parseChatRequest(body);
          if ("problem" in parsed) return error(parsed.problem, 400);
          // Claude and the tools can stay quiet for longer than Bun's 10 s idle timeout.
          server.timeout(r, 0);
          return eventStream(r, (send, signal) => converse(deps, parsed.request, send, signal));
        })(req),
    },
  };
}
