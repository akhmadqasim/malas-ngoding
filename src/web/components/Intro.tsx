import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";

interface Props {
  /** "loading" while data and map load, "flying" during the globe-to-Kaltim flight, "done" after. */
  phase: "loading" | "flying" | "done";
  onSkip: () => void;
}

const ease = [0.16, 1, 0.3, 1] as const;

/** Title card over the globe while the camera flies in. Fades away as the regions rise. */
export function Intro({ phase, onSkip }: Props) {
  useEffect(() => {
    if (phase !== "flying") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " " || e.key === "Enter") onSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onSkip]);

  return (
    <AnimatePresence>
      {phase !== "done" && (
        <motion.div
          key="intro"
          className="intro"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.7, ease } }}
        >
          <div className="intro__copy">
            <motion.h1
              className="intro__title"
              initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 1.2, ease }}
            >
              Malas Ngoding
            </motion.h1>
            <motion.p
              className="intro__lede"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.35, ease }}
            >
              Dari mana listrik Kalimantan Timur datang, berapa yang kita pakai, dan berapa CO2 yang ikut terlepas.
            </motion.p>
            <motion.div
              className="intro__actions"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.8 }}
            >
              {phase === "loading" ? (
                <span className="intro__status">Memuat peta…</span>
              ) : (
                <button type="button" className="intro__skip" onClick={onSkip}>
                  Lewati intro
                </button>
              )}
            </motion.div>
          </div>
          {phase === "flying" && <div className="intro__progress" aria-hidden />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
