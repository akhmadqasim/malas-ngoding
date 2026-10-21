import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Recommendations } from "../../src/shared/types.ts";
import {
  fmtWrittenOn,
  forgetRecommendations,
  impactNeedsEstimate,
  loadRecommendations,
  provenance,
  RecommendationFailure,
  RecommendationList,
  RecommendationLoading,
} from "../../src/web/panels/RecommendationPanel.tsx";

const ai: Recommendations = {
  regionId: "samarinda",
  model: "claude-sonnet-5-5",
  generatedAt: "2026-10-21T03:59:33.444Z",
  items: [
    {
      title: "Pasang PLTS atap di gedung milik Pemkot",
      category: "energi_terbarukan",
      body: "Samarinda punya 4,8 jam puncak matahari per hari.",
      impact: "Tiap 1 kWp menghemat sekitar Rp 2,3 jt per tahun (perkiraan).",
      priority: 1,
    },
    {
      title: "Lakukan audit energi gedung milik daerah",
      category: "efisiensi",
      body: "Pemakaian listrik per penduduk 1.596 kWh per tahun.",
      impact: "Tiap 1 kWh yang dihemat menghindari sekitar 1,14 kg CO2.",
      priority: 2,
    },
    {
      title: "Tetapkan target listrik bersih dalam RPJMD",
      category: "kebijakan",
      body: "Masukkan target tahunan PLTS atap ke dalam RPJMD.",
      impact: "Program energi bersih berjalan terukur dan berlanjut setiap tahun.",
      priority: 3,
    },
  ],
};
const rules: Recommendations = { ...ai, model: null };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  forgetRecommendations();
});

describe("who wrote the recommendations", () => {
  test("rule-based items (model null) say 'berbasis aturan'", () => {
    expect(provenance(rules)).toStartWith("Berbasis aturan");
  });
  test("AI items name the model and the day, in WITA", () => {
    expect(provenance(ai)).toContain("claude-sonnet-5-5");
    expect(provenance(ai)).toContain("21 Oktober 2026");
    // 17:30 UTC on 20 October is already 21 October in Kalimantan Timur (UTC+8).
    expect(fmtWrittenOn("2026-10-20T17:30:00Z")).toBe("21 Oktober 2026");
  });
  test("a broken date leaves the day out instead of printing 'Invalid Date'", () => {
    expect(fmtWrittenOn("not a date")).toBe("");
    expect(provenance({ model: "claude-sonnet-5-5", generatedAt: "" })).not.toContain("Invalid");
  });
});

describe("impact is shown honestly", () => {
  test("a number the text does not already call an estimate gets 'perkiraan'", () => {
    expect(impactNeedsEstimate("Tiap 1 kWh yang dihemat menghindari sekitar 1,14 kg CO2.")).toBe(true);
    expect(impactNeedsEstimate("Menghemat Rp 2,3 jt per tahun (perkiraan).")).toBe(false);
    expect(impactNeedsEstimate("Program energi bersih berjalan terukur.")).toBe(false);
  });

  test("the list labels each impact as expected, not achieved, and marks bare numbers", () => {
    const html = renderToStaticMarkup(<RecommendationList data={ai} />);
    expect(html.match(/Dampak yang diharapkan/g)?.length).toBe(3);
    // Only the second impact has a bare number: one "perkiraan" mark from the panel itself.
    expect(html.match(/class="est"/g)?.length).toBe(1);
  });
});

describe("the list", () => {
  test("shows every title with its priority and category, most urgent first", () => {
    const html = renderToStaticMarkup(<RecommendationList data={ai} />);
    for (const item of ai.items) expect(html).toContain(item.title);
    expect(html).toContain("Prioritas 1, energi terbarukan");
    expect(html).toContain("Prioritas 2, efisiensi energi");
    expect(html).toContain("Prioritas 3, kebijakan");
    expect(html).toContain("Ditulis AI (claude-sonnet-5-5) pada 21 Oktober 2026");
  });
  test("rule-based items carry the 'berbasis aturan' label", () => {
    expect(renderToStaticMarkup(<RecommendationList data={rules} />)).toContain("Berbasis aturan");
  });
  test("CO2 gets its subscript", () => {
    expect(renderToStaticMarkup(<RecommendationList data={ai} />)).toContain('CO<span class="sub">2</span>');
  });
});

describe("loading and failure", () => {
  test("loading is a progress line and skeleton rows, never a spinner", () => {
    const html = renderToStaticMarkup(<RecommendationLoading elapsedMs={2000} />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("8 sampai 10 detik");
    expect(html.match(/recs__skeleton-item/g)?.length).toBe(3);
    expect(html).not.toContain("spinner");
  });
  test("the line never reaches 100%, and a slow answer says so", () => {
    const html = renderToStaticMarkup(<RecommendationLoading elapsedMs={60_000} />);
    const now = Number(html.match(/aria-valuenow="(\d+)"/)?.[1]);
    expect(now).toBeGreaterThan(80);
    expect(now).toBeLessThanOrEqual(90);
    expect(html).toContain("Masih menyusun");
  });
  test("a failure says what failed and offers 'Coba lagi'", () => {
    const html = renderToStaticMarkup(<RecommendationFailure message="Wilayah tidak ditemukan" onRetry={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Rekomendasi belum bisa dimuat.");
    expect(html).toContain("Wilayah tidak ditemukan");
    expect(html).toContain("Coba lagi");
  });
});

describe("loading recommendations", () => {
  function serve(answer: Recommendations) {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      return Response.json(answer);
    }) as unknown as typeof fetch;
    return calls;
  }

  test("asks the server once per region for answers Claude wrote", async () => {
    const calls = serve(ai);
    expect(await loadRecommendations("samarinda")).toEqual(ai);
    expect(await loadRecommendations("samarinda")).toEqual(ai);
    expect(calls).toEqual(["/api/recommendations/samarinda"]);
  });

  test("asks again after a rule-based answer, so Claude gets another try", async () => {
    const calls = serve(rules);
    await loadRecommendations("samarinda");
    await loadRecommendations("samarinda");
    expect(calls.length).toBe(2);
  });

  test("passes the server's error on", async () => {
    globalThis.fetch = (async () => Response.json({ error: "Wilayah tidak ditemukan" }, { status: 404 })) as unknown as typeof fetch;
    await expect(loadRecommendations("nowhere")).rejects.toThrow("Wilayah tidak ditemukan");
  });
});
