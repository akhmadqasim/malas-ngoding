import type { ChatEvent, ChatRequest } from "../../server/routes/chat.ts";
import type { ChatAction } from "../../server/services/chatTools.ts";

// The client side of POST /api/chat: a fetch stream (EventSource cannot POST) read as server-sent events.

export type { ChatAction, ChatRequest };

/** One server-sent event: its name and its raw data text. */
export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Splits a text/event-stream into messages as chunks arrive. A message may be cut anywhere between two
 * chunks; comments (": ping", the server's keep-alive) and messages without data are skipped.
 */
export function createSseParser(): { push: (chunk: string) => SseMessage[]; end: () => SseMessage[] } {
  let buffer = "";
  const parse = (block: string): SseMessage | null => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    return data.length > 0 ? { event, data: data.join("\n") } : null;
  };
  const drain = (final: boolean): SseMessage[] => {
    const out: SseMessage[] = [];
    let cut = buffer.indexOf("\n\n");
    while (cut >= 0) {
      const msg = parse(buffer.slice(0, cut));
      if (msg) out.push(msg);
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf("\n\n");
    }
    if (final && buffer.trim() !== "") {
      const msg = parse(buffer);
      if (msg) out.push(msg);
      buffer = "";
    }
    return out;
  };
  return {
    push: (chunk) => {
      buffer += chunk.replace(/\r\n?/g, "\n");
      return drain(false);
    },
    end: () => drain(true),
  };
}

/** What the chat panel hears while an answer streams. */
export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "action"; action: ChatAction }
  | { type: "done" }
  | { type: "error"; message: string };

const OFFLINE = "Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.";
const CUT_OFF = "Jawaban terputus sebelum selesai. Coba lagi.";
const UNREADABLE = "Server mengirim jawaban yang tidak bisa dibaca. Coba lagi sebentar lagi.";

/** A server event as the panel's event, or null when it is unknown or malformed (it is skipped). */
function toStreamEvent(msg: SseMessage): StreamEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(msg.data);
  } catch {
    return null;
  }
  const d = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  switch (msg.event as ChatEvent["event"]) {
    case "text":
      return typeof d.delta === "string" ? { type: "text", delta: d.delta } : null;
    case "action":
      return typeof d.name === "string" && typeof d.input === "object" && d.input !== null
        ? { type: "action", action: { name: d.name as ChatAction["name"], input: d.input as Record<string, unknown> } }
        : null;
    case "done":
      return { type: "done" };
    case "error":
      return { type: "error", message: typeof d.message === "string" ? d.message : UNREADABLE };
    default:
      return null;
  }
}

/**
 * Sends one question and reports the answer's events through `onEvent`, ending with exactly one `done` or
 * `error` (none when `signal` aborts: the user stopped it). Never throws.
 */
export async function streamChat(
  request: ChatRequest,
  opts: { signal: AbortSignal; onEvent: (event: StreamEvent) => void; fetch?: typeof fetch },
): Promise<void> {
  const doFetch = opts.fetch ?? fetch;
  let finished = false;
  let answering = false;
  const emit = (event: StreamEvent) => {
    if (finished) return;
    if (event.type === "done" || event.type === "error") finished = true;
    opts.onEvent(event);
  };
  try {
    const res = await doFetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(request),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      emit({ type: "error", message: typeof body?.error === "string" ? body.error : `Permintaan gagal (${res.status}).` });
      return;
    }
    answering = true;
    const parser = createSseParser();
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      const messages = done ? parser.end() : parser.push(value);
      for (const msg of messages) {
        const event = toStreamEvent(msg);
        if (event) emit(event);
      }
      if (done || finished) break;
    }
    if (finished) await reader.cancel().catch(() => {});
    emit({ type: "error", message: CUT_OFF });
  } catch {
    if (opts.signal.aborted) return;
    emit({ type: "error", message: answering ? CUT_OFF : OFFLINE });
  }
}
