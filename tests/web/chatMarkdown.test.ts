import { describe, expect, test } from "bun:test";
import { parseInline, parseMarkdown } from "../../src/web/chat/markdown.tsx";

describe("the assistant's Markdown", () => {
  test("bold and italic runs", () => {
    expect(parseInline("**Samarinda** emisinya *perkiraan* tinggi")).toEqual([
      { text: "Samarinda", bold: true },
      { text: " emisinya " },
      { text: "perkiraan", italic: true },
      { text: " tinggi" },
    ]);
  });

  test("an emphasis still streaming runs to the end, so no stars flash on screen", () => {
    expect(parseInline("**Sama")).toEqual([{ text: "Sama", bold: true }]);
  });

  test("stars and underscores inside words or sums stay text", () => {
    expect(parseInline("fly_to_region dan 2*3 = 6")).toEqual([{ text: "fly_to_region dan 2*3 = 6" }]);
  });

  test("paragraphs, bullet lists and numbered lists", () => {
    const text =
      "**Samarinda** paling tinggi, sekitar 1,6 juta ton CO2 per tahun (perkiraan).\n\nBerikutnya:\n- Kutai Kartanegara: 1,4 juta ton\n- Balikpapan: 1,1 juta ton\n\n1. Pasang panel\n2. Hemat AC\n\nPeta sudah saya arahkan.";
    expect(parseMarkdown(text)).toEqual([
      { type: "p", lines: [[{ text: "Samarinda", bold: true }, { text: " paling tinggi, sekitar 1,6 juta ton CO2 per tahun (perkiraan)." }]] },
      { type: "p", lines: [[{ text: "Berikutnya:" }]] },
      { type: "ul", items: [[{ text: "Kutai Kartanegara: 1,4 juta ton" }], [{ text: "Balikpapan: 1,1 juta ton" }]] },
      { type: "ol", start: 1, items: [[{ text: "Pasang panel" }], [{ text: "Hemat AC" }]] },
      { type: "p", lines: [[{ text: "Peta sudah saya arahkan." }]] },
    ]);
  });

  test("lines of one paragraph stay together; a heading reads as bold text", () => {
    expect(parseMarkdown("## Ringkasan\nBaris dua")).toEqual([{ type: "p", lines: [[{ text: "Ringkasan", bold: true }], [{ text: "Baris dua" }]] }]);
  });

  test("an empty answer has no blocks", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n")).toEqual([]);
  });
});
