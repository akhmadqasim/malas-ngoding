import { ArrowRotateLeft, CircleExclamation, Comments, MapPin, PaperPlane, StopFill, Xmark } from "@gravity-ui/icons";
import { Button, Card, TextArea, Tooltip } from "@heroui/react";
import { AnimatePresence, motion } from "motion/react";
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DURATION, EASE_IN, EASE_OUT } from "../motion.ts";
import { useAppStore } from "../store.ts";
import { actionChips } from "./actionLabels.ts";
import "./chat.css";
import { Markdown } from "./markdown.tsx";
import type { ChatMessage } from "./session.ts";
import { type UseChat, useChat } from "./useChat.ts";

// The AI chat: a floating button in the bottom-right corner and the panel it opens. Answers stream in,
// and every map action the assistant took shows as a button under its answer that shows it again.

/** Questions to start with (Task 8 brief). */
export const SUGGESTED_PROMPTS = [
  "Wilayah mana emisinya paling tinggi?",
  "Tunjukkan gedung sekolah di Samarinda",
  "Kalau gedung ini pakai panel surya?",
  "Besok hujan? Berapa listrik suryanya?",
];
const MAX_CHARS = 2000;
/** The server's own words when an answer only moved the map; the action buttons already say it. */
const ACTIONS_ONLY_TEXT = "Sudah saya tampilkan di peta.";
const PANEL_ID = "chat-panel";

/**
 * Px from the bottom of the window to the top of the bottom dock's cards (legend, map controls) that sit
 * under the panel's column, or null when none does. Kept up to date as the dock or the window changes.
 */
function useDockClearance(panel: RefObject<HTMLElement | null>, open: boolean, beside: boolean): number | null {
  const [clearance, setClearance] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const dock = document.querySelector(".dock-slot");
    const measure = () => {
      const p = panel.current?.getBoundingClientRect();
      if (!p) return;
      const under = dock
        ? [...dock.children].map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0 && r.left < p.right && r.right > p.left)
        : [];
      setClearance(under.length ? Math.max(0, window.innerHeight - Math.min(...under.map((r) => r.top))) : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (dock) observer.observe(dock);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [panel, open, beside]);
  return open ? clearance : null;
}

export function ChatPanel() {
  const open = useAppStore((s) => s.chatOpen);
  // The building panel owns the right edge: next to it the chat moves one column left.
  const besideBuilding = useAppStore((s) => s.buildingStatus !== "idle");
  const panel = useRef<HTMLElement>(null);
  // Where the dock's cards reach under the panel, it ends above them.
  const clearance = useDockClearance(panel, open, besideBuilding);
  const chat = useChat();
  const launcher = useRef<HTMLButtonElement>(null);

  const close = () => {
    useAppStore.getState().setChatOpen(false);
    launcher.current?.focus();
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.section
            key="chat"
            ref={panel}
            id={PANEL_ID}
            className="chat"
            data-beside={besideBuilding ? "" : undefined}
            style={clearance !== null ? { bottom: `max(var(--chat-bottom), calc(${clearance}px + var(--chat-gap)))` } : undefined}
            aria-label="Asisten AI"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0, transition: { duration: DURATION.panel, ease: EASE_OUT } }}
            exit={{ opacity: 0, x: 16, transition: { duration: DURATION.exit, ease: EASE_IN } }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
          >
            <ChatCard chat={chat} onClose={close} />
          </motion.section>
        )}
      </AnimatePresence>
      <motion.div
        className="chat-launch"
        variants={{
          hidden: { opacity: 0, y: 12 },
          shown: { opacity: 1, y: 0, transition: { duration: DURATION.assemble, ease: EASE_OUT } },
        }}
      >
        <Tooltip>
          <Button
            ref={launcher}
            isIconOnly
            variant={open ? "outline" : "primary"}
            aria-label={open ? "Tutup asisten AI" : "Tanya asisten AI"}
            aria-expanded={open}
            aria-controls={open ? PANEL_ID : undefined}
            className="chat-launch__button"
            onPress={() => useAppStore.getState().setChatOpen(!open)}
          >
            {open ? <Xmark aria-hidden /> : <Comments aria-hidden />}
          </Button>
          <Tooltip.Content placement="left">{open ? "Tutup asisten AI" : "Tanya asisten AI"}</Tooltip.Content>
        </Tooltip>
      </motion.div>
    </>
  );
}

function ChatCard({ chat, onClose }: { chat: UseChat; onClose: () => void }) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const off = chat.enabled === false;

  useEffect(() => input.current?.focus(), []);

  // Follow the answer as it streams, unless the reader scrolled up to read something earlier.
  const lastText = chat.messages.at(-1)?.text;
  useLayoutEffect(() => {
    const el = log.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, lastText]);

  const submit = (text = draft) => {
    if (!text.trim() || chat.busy || off) return;
    chat.send(text.slice(0, MAX_CHARS));
    setDraft("");
    pinned.current = true;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Card className="chat__card">
      <header className="chat__head">
        <div>
          <h2 className="chat__title">Asisten energi</h2>
          <p className="chat__lede">Bertanya tentang listrik, emisi dan surya di Kaltim. Peta ikut bergerak.</p>
        </div>
        <div className="chat__tools">
          <IconTool label="Percakapan baru" onPress={chat.reset} isDisabled={chat.messages.length === 0}>
            <ArrowRotateLeft aria-hidden />
          </IconTool>
          <IconTool label="Tutup" onPress={onClose}>
            <Xmark aria-hidden />
          </IconTool>
        </div>
      </header>

      {off && (
        <div className="chat__notice" role="status">
          <CircleExclamation aria-hidden className="chat__notice-icon" />
          <div>
            <p className="chat__notice-title">Asisten AI belum aktif</p>
            <p>Kunci API Anthropic (ANTHROPIC_API_KEY) belum diatur di server. Peta dan semua panel tetap bisa dipakai.</p>
          </div>
        </div>
      )}

      <div
        ref={log}
        className="chat__log"
        role="log"
        aria-live="polite"
        aria-label="Percakapan"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {chat.messages.length === 0 ? (
          <div className="chat__empty">
            <p>Jawaban memakai data di peta ini. Angka per wilayah dan per gedung adalah perkiraan.</p>
            <p className="group-label">Coba tanyakan</p>
            <ul className="chat__prompts">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <li key={prompt}>
                  <Button variant="outline" size="sm" fullWidth className="chat__prompt" isDisabled={off} onPress={() => submit(prompt)}>
                    {prompt}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          chat.messages.map((m) =>
            m.role === "user" ? (
              <p key={m.id} className="chat-msg chat-msg--user">
                {m.text}
              </p>
            ) : (
              <Answer key={m.id} message={m} chat={chat} />
            ),
          )
        )}
      </div>

      <form
        className="chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextArea
          ref={input}
          aria-label="Pertanyaan untuk asisten AI"
          className="chat__input"
          rows={2}
          maxLength={MAX_CHARS}
          placeholder={off ? "Asisten AI belum aktif" : "Tulis pertanyaan…"}
          value={draft}
          disabled={off}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {chat.busy ? (
          <IconTool label="Hentikan jawaban" onPress={chat.stop} variant="outline">
            <StopFill aria-hidden />
          </IconTool>
        ) : (
          <IconTool label="Kirim" type="submit" variant="primary" isDisabled={off || !draft.trim()}>
            <PaperPlane aria-hidden />
          </IconTool>
        )}
      </form>
      <p className="chat__foot">AI bisa keliru. Angkanya dari data peta dan tetap perkiraan.</p>
    </Card>
  );
}

function IconTool({
  label,
  children,
  onPress,
  isDisabled,
  type,
  variant = "ghost",
}: {
  label: string;
  children: ReactNode;
  onPress?: () => void;
  isDisabled?: boolean;
  type?: "submit";
  variant?: "ghost" | "outline" | "primary";
}) {
  return (
    <Tooltip>
      <Button isIconOnly size="sm" variant={variant} aria-label={label} onPress={onPress} isDisabled={isDisabled} type={type} className="chat__icon">
        {children}
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}

function Answer({ message: m, chat }: { message: ChatMessage; chat: UseChat }) {
  const chips = actionChips(m.actions);
  const text = chips.length > 0 && m.text.trim() === ACTIONS_ONLY_TEXT ? "" : m.text;
  const waiting = m.status === "streaming" && text === "";
  return (
    <div className="chat-msg chat-msg--ai" aria-busy={m.status === "streaming"}>
      {waiting && <p className="chat-msg__status">{chips.length > 0 ? "Menyiapkan peta…" : "Mencari data…"}</p>}
      {text && (
        <div className="chat-msg__text">
          <Markdown text={text} />
        </div>
      )}
      {chips.length > 0 && (
        <div className="chat-msg__actions" role="group" aria-label="Sudah saya tampilkan di peta">
          <p className="chat-msg__actions-label">
            <MapPin aria-hidden />
            Sudah saya tampilkan di peta
          </p>
          <div className="chat-msg__chips">
            {chips.map(({ label, action }) => (
              <Button key={label} size="sm" variant="outline" className="chat-chip" aria-label={`Tampilkan lagi: ${label}`} onPress={() => chat.replay(action)}>
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}
      {m.status === "error" && (
        <div className="chat-msg__problem" role="alert">
          <p>{m.error}</p>
          <Button size="sm" variant="outline" onPress={() => chat.retry(m.id)} isDisabled={chat.busy}>
            Coba lagi
          </Button>
        </div>
      )}
      {m.status === "stopped" && (
        <div className="chat-msg__problem">
          <p>{text ? "Jawaban dihentikan." : "Dihentikan sebelum ada jawaban."}</p>
          <Button size="sm" variant="ghost" onPress={() => chat.retry(m.id)} isDisabled={chat.busy}>
            Tanya lagi
          </Button>
        </div>
      )}
    </div>
  );
}
