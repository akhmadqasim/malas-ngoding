import { describe, expect, test } from "bun:test";
import { CHAT_STORAGE_KEY, type ChatMessage, loadChat, MAX_KEPT_MESSAGES, newChat, saveChat } from "../../src/web/chat/session.ts";

const ID = "6f1c2b9e-3d4a-4e5f-8a7b-9c0d1e2f3a4b";
const fixedId = () => ID;

function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

const msg = (n: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m${n}`,
  role: n % 2 ? "assistant" : "user",
  text: `pesan ${n}`,
  actions: [],
  status: "done",
  ...extra,
});

describe("the chat session in localStorage", () => {
  test("a first visit starts a new conversation with a new session id", () => {
    expect(loadChat(memory(), fixedId)).toEqual({ sessionId: ID, messages: [] });
    expect(loadChat(null, fixedId)).toEqual({ sessionId: ID, messages: [] });
  });

  test("the session id and the transcript survive a reload", () => {
    const storage = memory();
    const chat = { sessionId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", messages: [msg(0), msg(1, { actions: [{ name: "set_metric", input: { metric: "co2" } }] })] };
    saveChat(storage, chat);
    expect(loadChat(storage, fixedId)).toEqual(chat);
  });

  test("an answer still streaming is kept as stopped", () => {
    const storage = memory();
    saveChat(storage, { sessionId: ID, messages: [msg(0), msg(1, { status: "streaming" })] });
    expect(loadChat(storage, fixedId).messages[1]?.status).toBe("stopped");
  });

  test(`keeps only the last ${MAX_KEPT_MESSAGES} messages`, () => {
    const storage = memory();
    saveChat(storage, { sessionId: ID, messages: Array.from({ length: 50 }, (_, i) => msg(i)) });
    const kept = loadChat(storage, fixedId).messages;
    expect(kept).toHaveLength(MAX_KEPT_MESSAGES);
    expect(kept[0]?.id).toBe("m10");
  });

  test.each([["not json"], ['{"sessionId":"abc","messages":[]}'], ['{"sessionId":"' + ID + '"}']])(
    "unreadable storage %p starts over",
    (raw) => {
      const storage = memory();
      storage.setItem(CHAT_STORAGE_KEY, raw);
      expect(loadChat(storage, () => "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d")).toEqual(newChat(() => "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"));
    },
  );

  test("broken messages are dropped, good ones kept", () => {
    const storage = memory();
    storage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ sessionId: ID, messages: [msg(0), { id: 1 }, null, msg(1)] }));
    expect(loadChat(storage, fixedId).messages.map((m) => m.id)).toEqual(["m0", "m1"]);
  });

  test("a full or blocked storage does not break the chat", () => {
    const full = { setItem: () => {
      throw new Error("QuotaExceededError");
    } };
    expect(() => saveChat(full, { sessionId: ID, messages: [msg(0)] })).not.toThrow();
  });
});
