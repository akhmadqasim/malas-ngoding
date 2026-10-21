import { describe, expect, test } from "bun:test";
import { createSseParser, type StreamEvent, streamChat } from "../../src/web/chat/sse.ts";

const REQUEST = {
  sessionId: "6f1c2b9e-3d4a-4e5f-8a7b-9c0d1e2f3a4b",
  message: "Halo",
  context: { selectedRegionId: null, selectedBuilding: null, selectedBuildingAt: null, view: { center: [117, -0.5] as [number, number], zoom: 9 } },
};

/** A fetch that answers with an event stream sent in the given chunks. */
function sseFetch(chunks: string[], seen: { url?: string; init?: RequestInit } = {}) {
  return (async (url: string, init?: RequestInit) => {
    seen.url = url;
    seen.init = init;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
}

async function collect(fetcher: typeof fetch, signal = new AbortController().signal): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  await streamChat(REQUEST, { signal, onEvent: (e) => events.push(e), fetch: fetcher });
  return events;
}

describe("createSseParser", () => {
  test("parses events cut anywhere between chunks, skipping keep-alive comments", () => {
    const parser = createSseParser();
    const stream = ': ping\n\nevent: text\ndata: {"delta":"Ha"}\n\nevent: text\r\ndata: {"delta":"lo"}\r\n\r\n: ping\n\nevent: done\ndata: {}\n\n';
    const out = [];
    for (let i = 0; i < stream.length; i += 7) out.push(...parser.push(stream.slice(i, i + 7)));
    out.push(...parser.end());
    expect(out).toEqual([
      { event: "text", data: '{"delta":"Ha"}' },
      { event: "text", data: '{"delta":"lo"}' },
      { event: "done", data: "{}" },
    ]);
  });

  test("joins multi-line data and reads a last event without its blank line at the end", () => {
    const parser = createSseParser();
    expect(parser.push("data: a\ndata: b\n\n")).toEqual([{ event: "message", data: "a\nb" }]);
    expect(parser.push("event: done\ndata: {}")).toEqual([]);
    expect(parser.end()).toEqual([{ event: "done", data: "{}" }]);
  });

  test("a CRLF split across two chunks is one line break", () => {
    const parser = createSseParser();
    expect(parser.push('event: text\r\ndata: {"delta":"a"}\r')).toEqual([]);
    expect(parser.push("\n\r\nevent: done\r\ndata: {}\r\n\r\n")).toEqual([
      { event: "text", data: '{"delta":"a"}' },
      { event: "done", data: "{}" },
    ]);
  });
});

describe("streamChat", () => {
  test("posts the question as JSON and reports text, actions and done in order", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const events = await collect(
      sseFetch(
        [
          'event: action\ndata: {"name":"fly_to_region","input":{"region":"samarinda"}}\n\n',
          'event: text\ndata: {"delta":"Samarinda "}\n\nevent: text\ndata: {"delta":"paling tinggi."}\n\n',
          "event: done\ndata: {}\n\n",
        ],
        seen,
      ),
    );
    expect(seen.url).toBe("/api/chat");
    expect(seen.init?.method).toBe("POST");
    expect(JSON.parse(String(seen.init?.body))).toEqual(REQUEST);
    expect(events).toEqual([
      { type: "action", action: { name: "fly_to_region", input: { region: "samarinda" } } },
      { type: "text", delta: "Samarinda " },
      { type: "text", delta: "paling tinggi." },
      { type: "done" },
    ]);
  });

  test("an error event ends the answer with its message", async () => {
    const events = await collect(sseFetch(['event: text\ndata: {"delta":"Sebentar"}\n\n', 'event: error\ndata: {"message":"Asisten AI sedang sibuk."}\n\n']));
    expect(events.at(-1)).toEqual({ type: "error", message: "Asisten AI sedang sibuk." });
    expect(events.filter((e) => e.type === "error" || e.type === "done")).toHaveLength(1);
  });

  test("a stream that ends without done or error says the answer was cut off", async () => {
    const events = await collect(sseFetch(['event: text\ndata: {"delta":"Sam"}\n\n']));
    expect(events.at(-1)).toEqual({ type: "error", message: expect.stringContaining("terputus") });
  });

  test("malformed and unknown events are skipped", async () => {
    const events = await collect(
      sseFetch(["event: text\ndata: not json\n\n", 'event: thinking\ndata: {"x":1}\n\n', 'event: action\ndata: {"name":1}\n\n', "event: done\ndata: {}\n\n"]),
    );
    expect(events).toEqual([{ type: "done" }]);
  });

  test("a 400 shows the server's own message", async () => {
    const fetcher = (async () => Response.json({ error: "Pesan harus berisi 1 sampai 2.000 karakter." }, { status: 400 })) as unknown as typeof fetch;
    expect(await collect(fetcher)).toEqual([{ type: "error", message: "Pesan harus berisi 1 sampai 2.000 karakter." }]);
  });

  test("no connection gives an Indonesian message", async () => {
    const fetcher = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await collect(fetcher)).toEqual([{ type: "error", message: expect.stringContaining("Tidak bisa terhubung") }]);
  });

  test("stopping the answer ends quietly, without an error", async () => {
    const controller = new AbortController();
    const fetcher = (async (_url: string, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('event: text\ndata: {"delta":"Sam"}\n\n'));
          init?.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body);
    }) as unknown as typeof fetch;
    const events: StreamEvent[] = [];
    const done = streamChat(REQUEST, {
      signal: controller.signal,
      fetch: fetcher,
      onEvent: (e) => {
        events.push(e);
        controller.abort();
      },
    });
    await done;
    expect(events).toEqual([{ type: "text", delta: "Sam" }]);
  });
});
