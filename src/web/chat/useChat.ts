import { useCallback, useEffect, useRef, useState } from "react";
import { KALTIM_VIEW } from "../map/camera.ts";
import { runAction } from "../map/actions.ts";
import { type AppState, useAppStore } from "../store.ts";
import { clearPlaces } from "./placesLayer.ts";
import { browserStorage, type ChatMessage, loadChat, newChat, saveChat, type StoredChat } from "./session.ts";
import { type ChatAction, type ChatRequest, type StreamEvent, streamChat } from "./sse.ts";

// The chat panel's state: the conversation (kept in localStorage with its session id), sending a question
// with what the map shows, streaming the answer in, running its map actions, stopping and starting over.

/** What the map shows as the question is sent: the app state the server puts in front of the question. */
export function chatContext(state: AppState): ChatRequest["context"] {
  const map = state.map;
  const center = map?.getCenter().wrap();
  const zoom = map?.getZoom() ?? KALTIM_VIEW.zoom;
  return {
    selectedRegionId: state.selectedRegionId,
    selectedBuilding: state.selectedBuilding,
    selectedBuildingAt: state.selectedBuilding ? state.selectedBuildingAt : null,
    view: { center: center ? [center.lng, center.lat] : KALTIM_VIEW.center, zoom: Math.min(24, Math.max(0, zoom)) },
  };
}

export interface UseChat {
  messages: ChatMessage[];
  /** An answer is streaming in. */
  busy: boolean;
  /** Whether the server has an AI key: null until known (or when the check failed). */
  enabled: boolean | null;
  send: (text: string) => void;
  stop: () => void;
  /** Asks the question of a failed or stopped answer again. */
  retry: (answerId: string) => void;
  /** Starts a new conversation (new session id) and clears the places marked on the map. */
  reset: () => void;
  /** Runs an answer's map action again (the action buttons). */
  replay: (action: ChatAction) => void;
}

const newId = () => crypto.randomUUID();

export function useChat(opts: { fetch?: typeof fetch } = {}): UseChat {
  const storage = browserStorage();
  const [chat, setChat] = useState<StoredChat>(() => loadChat(storage));
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const running = useRef<AbortController | null>(null);
  const fetcher = opts.fetch;
  const busy = chat.messages.at(-1)?.status === "streaming";

  useEffect(() => {
    let live = true;
    (fetcher ?? fetch)("/api/chat/status")
      .then((r) => (r.ok ? (r.json() as Promise<{ enabled?: unknown }>) : null))
      .then((s) => {
        if (live && typeof s?.enabled === "boolean") setEnabled(s.enabled);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [fetcher]);

  // Kept once an answer settles, not on every streamed word.
  useEffect(() => {
    if (!busy) saveChat(storage, chat);
  }, [chat, busy, storage]);

  // Leaving the page (or unmounting the panel) stops the answer.
  useEffect(() => () => running.current?.abort(), []);

  const update = useCallback((id: string, change: (m: ChatMessage) => ChatMessage) => {
    setChat((c) => ({ ...c, messages: c.messages.map((m) => (m.id === id ? change(m) : m)) }));
  }, []);

  const ask = useCallback(
    (text: string, sessionId: string) => {
      const message = text.trim();
      if (!message || running.current) return;
      const question: ChatMessage = { id: newId(), role: "user", text: message, actions: [], status: "done" };
      const answer: ChatMessage = { id: newId(), role: "assistant", text: "", actions: [], status: "streaming" };
      setChat((c) => ({ ...c, messages: [...c.messages, question, answer] }));

      const controller = new AbortController();
      running.current = controller;
      const onEvent = (event: StreamEvent) => {
        if (event.type === "text") update(answer.id, (m) => ({ ...m, text: m.text + event.delta }));
        else if (event.type === "action") {
          update(answer.id, (m) => ({ ...m, actions: [...m.actions, event.action] }));
          void runAction(event.action);
        } else if (event.type === "done") update(answer.id, (m) => ({ ...m, status: "done" }));
        else update(answer.id, (m) => ({ ...m, status: "error", error: event.message }));
      };
      const request: ChatRequest = { sessionId, message, context: chatContext(useAppStore.getState()) };
      void streamChat(request, { signal: controller.signal, onEvent, fetch: fetcher }).finally(() => {
        if (running.current === controller) running.current = null;
        // Stopped by the user: no done or error came.
        update(answer.id, (m) => (m.status === "streaming" ? { ...m, status: "stopped" } : m));
      });
    },
    [fetcher, update],
  );

  const send = useCallback((text: string) => ask(text, chat.sessionId), [ask, chat.sessionId]);

  const stop = useCallback(() => running.current?.abort(), []);

  const retry = useCallback(
    (answerId: string) => {
      if (running.current) return;
      const i = chat.messages.findIndex((m) => m.id === answerId);
      const question = chat.messages[i - 1];
      if (i < 1 || question?.role !== "user") return;
      // The failed pair leaves the transcript; the question comes back as a new one.
      setChat((c) => ({ ...c, messages: c.messages.filter((m) => m.id !== answerId && m.id !== question.id) }));
      ask(question.text, chat.sessionId);
    },
    [ask, chat],
  );

  const reset = useCallback(() => {
    running.current?.abort();
    running.current = null;
    const map = useAppStore.getState().map;
    if (map) clearPlaces(map);
    setChat(newChat());
  }, []);

  const replay = useCallback((action: ChatAction) => void runAction(action), []);

  return { messages: chat.messages, busy, enabled, send, stop, retry, reset, replay };
}
