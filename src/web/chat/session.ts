import type { ChatAction } from "./sse.ts";

// The chat session the browser keeps: an anonymous session id (the server keeps the history under it) and
// the transcript shown in the panel, so a reload shows the same conversation the assistant remembers.

/** One message in the panel. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Map actions of an answer, in the order they ran. */
  actions: ChatAction[];
  /** What each action did, by its index in `actions` ("failed": it ran but did not get there). */
  outcomes?: ("ok" | "failed" | "skipped")[];
  /** streaming: the answer is arriving; stopped: the user stopped it; error: it failed with `error`. */
  status: "streaming" | "done" | "stopped" | "error";
  error?: string;
}

export interface StoredChat {
  sessionId: string;
  messages: ChatMessage[];
}

export const CHAT_STORAGE_KEY = "malas-ngoding.chat";
/** Messages kept for the panel; the server replays only the last 20 to Claude anyway. */
export const MAX_KEPT_MESSAGES = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const newId = () => crypto.randomUUID();

/** A fresh conversation with a new session id. */
export function newChat(makeId: () => string = newId): StoredChat {
  return { sessionId: makeId(), messages: [] };
}

function isMessage(v: unknown): v is ChatMessage {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    (m.role === "user" || m.role === "assistant") &&
    typeof m.text === "string" &&
    Array.isArray(m.actions) &&
    (m.status === "done" || m.status === "stopped" || m.status === "error")
  );
}

/** The kept conversation, or a new one when there is none or it cannot be read. */
export function loadChat(storage: Pick<Storage, "getItem"> | null, makeId: () => string = newId): StoredChat {
  try {
    const raw = storage?.getItem(CHAT_STORAGE_KEY);
    if (!raw) return newChat(makeId);
    const v = JSON.parse(raw) as { sessionId?: unknown; messages?: unknown };
    if (typeof v.sessionId !== "string" || !UUID.test(v.sessionId) || !Array.isArray(v.messages)) return newChat(makeId);
    const messages = v.messages
      .filter(isMessage)
      .slice(-MAX_KEPT_MESSAGES)
      // Outcomes come back as JSON (a hole is null); anything else is dropped.
      .map(({ outcomes, ...m }): ChatMessage => (Array.isArray(outcomes) ? { ...m, outcomes } : m));
    return { sessionId: v.sessionId, messages };
  } catch {
    return newChat(makeId);
  }
}

/**
 * Keeps the conversation. An answer still streaming is kept as stopped, since a reload ends it. Storage
 * that is full or switched off is ignored: the chat still works, it is just not remembered.
 */
export function saveChat(storage: Pick<Storage, "setItem"> | null, chat: StoredChat): void {
  const messages = chat.messages
    .slice(-MAX_KEPT_MESSAGES)
    .map((m) => (m.status === "streaming" ? { ...m, status: "stopped" as const } : m));
  try {
    storage?.setItem(CHAT_STORAGE_KEY, JSON.stringify({ sessionId: chat.sessionId, messages }));
  } catch {
    // Private mode or a full quota.
  }
}

/** localStorage when the browser allows it. */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
