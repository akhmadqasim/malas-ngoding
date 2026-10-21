import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { DURATION, EASE_IN, EASE_OUT } from "../motion.ts";
import { chem } from "./Chem.tsx";

interface Props {
  /** "loading" while data and map load, "flying" during the globe-to-Kaltim flight, "done" after. */
  phase: "loading" | "flying" | "done";
  onSkip: () => void;
}

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
        <motion.div key="intro" className="intro" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: DURATION.assemble, ease: EASE_IN } }}>
          <div className="intro__scrim" aria-hidden />
          <div className="intro__copy">
            <motion.h1
              className="intro__title"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DURATION.introText, ease: EASE_OUT }}
            >
              Malas Ngoding
            </motion.h1>
            <motion.p
              className="intro__lede"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DURATION.introText, delay: 0.15, ease: EASE_OUT }}
            >
              {chem("Dari mana listrik Kalimantan Timur datang, berapa yang kita pakai, dan berapa CO2 yang ikut terlepas.")}
            </motion.p>
            <motion.div className="intro__actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: DURATION.assemble, delay: 0.4 }}>
              {phase === "loading" ? (
                <span className="intro__status">Memuat peta…</span>
              ) : (
                <button type="button" className="button-quiet" onClick={onSkip}>
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
