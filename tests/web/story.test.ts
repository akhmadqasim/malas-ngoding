import { describe, expect, test } from "bun:test";
import { PHASE_LABEL, STORY, type StoryTrack } from "../../src/web/story/steps.ts";

const tracks = Object.keys(STORY) as StoryTrack[];

describe("the guided story", () => {
  test("has a track for residents and one for local government", () => {
    expect(tracks.sort()).toEqual(["pemda", "warga"]);
  });

  test("every step has a label, a title, a text, a known phase and SDG targets", () => {
    for (const t of tracks) {
      const labels = new Set<string>();
      for (const s of STORY[t].steps) {
        expect(s.label.length).toBeGreaterThan(0);
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.text.length).toBeGreaterThan(20);
        expect(Object.keys(PHASE_LABEL)).toContain(s.phase);
        expect(s.sdg.length).toBeGreaterThan(0);
        for (const target of s.sdg) expect(target).toMatch(/^\d{1,2}\.[0-9a-z]+$/);
        expect(typeof s.enter).toBe("function");
        labels.add(s.label);
      }
      // Labels key the stepper: they must be unique within a track.
      expect(labels.size).toBe(STORY[t].steps.length);
    }
  });

  test("each track runs from where Kaltim stands now to acting on it", () => {
    for (const t of tracks) {
      const steps = STORY[t].steps;
      expect(steps[0]!.phase).toBe("sekarang");
      expect(steps.at(-1)!.phase).toBe("bertindak");
    }
  });

  test("no step text uses arrows (00-direction rule 5); acronyms such as PLTS and RPJMD are names, not labels", () => {
    for (const t of tracks) for (const s of STORY[t].steps) expect(`${s.title} ${s.text}`).not.toContain("→");
  });
});
