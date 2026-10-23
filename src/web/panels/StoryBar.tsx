import { ChevronLeft, ChevronRight, Xmark } from "../icons.ts";
import { Button, Card } from "@heroui/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { PHASE_LABEL, STORY, type StoryTrack, type TransitionPhase } from "../story/steps.ts";

const PHASES = Object.keys(PHASE_LABEL) as TransitionPhase[];
import { DURATION, EASE_IN, EASE_OUT } from "../motion.ts";
import { useAppStore } from "../store.ts";
import { Character } from "../components/Character.tsx";

const rise = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.panel, ease: EASE_OUT } },
  exit: { opacity: 0, y: 12, transition: { duration: DURATION.exit, ease: EASE_IN } },
};

/**
 * The guided story at the bottom of the map, where the legend dock sits otherwise: first the choice of a
 * track (residents or local government), then its steps with the transition phase and SDG targets of each,
 * Kembali and Lanjut, and a stepper to jump. Every step sets the map itself (story/steps.ts). Esc leaves.
 */
export function StoryBar() {
  const story = useAppStore((s) => s.story);
  const setStory = useAppStore((s) => s.setStory);
  const track = story?.track ? STORY[story.track] : null;
  const step = track && story ? track.steps[story.step] : undefined;

  // Each step sets its own view when it is reached.
  useEffect(() => {
    step?.enter();
  }, [step]);
  useEffect(() => {
    if (!story) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStory(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [story, setStory]);

  return (
    <div className="story-slot">
      <AnimatePresence mode="wait" initial={false}>
        {story && !track && (
          <motion.div key="choose" {...rise}>
            <Card className="story" role="dialog" aria-label="Pilih alur cerita">
              <div className="story__head">
                <p className="story__title">Pilih alurnya</p>
                <Button isIconOnly variant="ghost" size="sm" aria-label="Tutup alur cerita" onPress={() => setStory(null)}>
                  <Xmark aria-hidden />
                </Button>
              </div>
              <p className="story__text">Satu peta, dua sudut pandang transisi energi menuju SDG 7: energi bersih dan terjangkau.</p>
              <div className="story__tracks">
                {(Object.keys(STORY) as StoryTrack[]).map((key) => (
                  <button key={key} type="button" className="story__track" onClick={() => setStory({ track: key, step: 0 })}>
                    <Character role={key} variant="guide" />
                    <span className="story__track-name">{STORY[key].name}</span>
                    <span className="story__track-lede">{STORY[key].lede}</span>
                    <span className="story__track-count num">{STORY[key].steps.length} langkah</span>
                  </button>
                ))}
              </div>
            </Card>
          </motion.div>
        )}
        {story && track && step && (
          <motion.div key="steps" {...rise}>
            <Card className="story" role="region" aria-label={`Alur cerita ${track.name.toLowerCase()}`}>
              <ol className="story__stepper" aria-label="Langkah">
                {track.steps.map((s, i) => (
                  <li key={s.label}>
                    <button
                      type="button"
                      className="story__dot"
                      data-state={i === story.step ? "now" : i < story.step ? "done" : undefined}
                      aria-current={i === story.step ? "step" : undefined}
                      onClick={() => setStory({ ...story, step: i })}
                    >
                      <span className="story__dot-n num">{i + 1}</span>
                      <span className="story__dot-label">{s.label}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={story.step} className="story__body" {...rise}>
                  {/* Where this step sits in the energy transition, the thread both tracks follow. */}
                  <ol className="story__phases" aria-label="Fase transisi energi">
                    {PHASES.map((p) => (
                      <li key={p} className="story__phase" data-now={p === step.phase || undefined} aria-current={p === step.phase ? "step" : undefined}>
                        {PHASE_LABEL[p]}
                      </li>
                    ))}
                  </ol>
                  <p className="story__meta">
                    {track.name}, langkah {story.step + 1} dari {track.steps.length}. Mendukung SDG {step.sdg.join(", ")}.
                  </p>
                  <p className="story__title">{step.title}</p>
                  <p className="story__text">{step.text}</p>
                </motion.div>
              </AnimatePresence>
              <div className="story__nav">
                <Button variant="ghost" size="sm" onPress={() => setStory({ track: null, step: 0 })}>
                  Ganti alur
                </Button>
                <span className="story__spacer" />
                <Button variant="outline" size="sm" isDisabled={story.step === 0} onPress={() => setStory({ ...story, step: story.step - 1 })}>
                  <ChevronLeft aria-hidden />
                  Kembali
                </Button>
                {story.step < track.steps.length - 1 ? (
                  <Button variant="primary" size="sm" onPress={() => setStory({ ...story, step: story.step + 1 })}>
                    Lanjut
                    <ChevronRight aria-hidden />
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" onPress={() => setStory(null)}>
                    Selesai, jelajahi bebas
                  </Button>
                )}
                <Button isIconOnly variant="ghost" size="sm" aria-label="Keluar dari alur cerita" onPress={() => setStory(null)}>
                  <Xmark aria-hidden />
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
