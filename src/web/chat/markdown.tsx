import type { ReactNode } from "react";

// The light Markdown the assistant writes (bold, italic, bullet and numbered lists, paragraphs), turned into
// React elements without ever setting HTML. Works on a half-streamed answer too: an emphasis that is not
// closed yet runs to the end of the text, so the stars never flash on screen.

export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
}
export type Block =
  | { type: "p"; lines: Inline[][] }
  | { type: "ul"; items: Inline[][] }
  | { type: "ol"; start: number; items: Inline[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

/** Bold (**text**) and italic (*text* or _text_) runs of one line. */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let bold = false;
  let italic = false;
  let text = "";
  const flush = () => {
    if (text) out.push({ text, ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) });
    text = "";
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === "*" && line[i + 1] === "*") {
      flush();
      bold = !bold;
      i++;
    } else if ((c === "*" || c === "_") && isItalicMark(line, i)) {
      flush();
      italic = !italic;
    } else {
      text += c;
    }
  }
  flush();
  return out;
}

/** A single * or _ that opens or closes emphasis: not inside a word (snake_case, 2*3) and not a lone star. */
function isItalicMark(line: string, i: number): boolean {
  const before = line[i - 1] ?? " ";
  const after = line[i + 1] ?? " ";
  const word = /[\p{L}\p{N}]/u;
  const opens = !word.test(before) && after !== " ";
  const closes = before !== " " && !word.test(after);
  return opens || closes;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  for (const raw of lines) {
    const last = blocks.at(-1);
    if (raw.trim() === "") {
      // A blank line ends a paragraph; lists may continue after one.
      if (last?.type === "p") blocks.push({ type: "p", lines: [] });
      continue;
    }
    const bullet = BULLET.exec(raw);
    const numbered = bullet ? null : NUMBERED.exec(raw);
    if (bullet) {
      if (last?.type === "ul") last.items.push(parseInline(bullet[1]!));
      else blocks.push({ type: "ul", items: [parseInline(bullet[1]!)] });
    } else if (numbered) {
      if (last?.type === "ol") last.items.push(parseInline(numbered[2]!));
      else blocks.push({ type: "ol", start: Number(numbered[1]), items: [parseInline(numbered[2]!)] });
    } else {
      const heading = HEADING.exec(raw);
      const inline = heading ? [{ text: heading[1]!, bold: true }] : parseInline(raw);
      if (last?.type === "p") last.lines.push(inline);
      else blocks.push({ type: "p", lines: [inline] });
    }
  }
  return blocks.filter((b) => (b.type === "p" ? b.lines.length > 0 : b.items.length > 0));
}

function renderInline(runs: Inline[]): ReactNode[] {
  return runs.map((r, i) => {
    let node: ReactNode = r.text;
    if (r.italic) node = <em key={`i${i}`}>{node}</em>;
    if (r.bold) node = <strong key={`b${i}`}>{node}</strong>;
    return typeof node === "string" ? <span key={i}>{node}</span> : node;
  });
}

/** The assistant's text as paragraphs and lists. */
export function Markdown({ text }: { text: string }) {
  return (
    <>
      {parseMarkdown(text).map((block, i) => {
        if (block.type === "ul") {
          return (
            <ul key={i}>
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "ol") {
          return (
            <ol key={i} start={block.start}>
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {renderInline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}
