import { Xmark } from "../icons.ts";
import { Button } from "@heroui/react";
import { AnimatePresence, motion } from "motion/react";
import { DURATION, EASE_IN, EASE_OUT } from "../motion.ts";
import { useAppStore } from "../store.ts";

/** After a search lands near a place but not on a roof: one line at the top asking for a click on the house. */
export function PlaceHint() {
  const hint = useAppStore((s) => s.placeHint);
  const clear = useAppStore((s) => s.setPlaceHint);
  return (
    <div className="place-hint-slot">
      <AnimatePresence>
        {hint && (
          <motion.div
            key={hint}
            className="place-hint"
            role="status"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DURATION.panel, ease: EASE_OUT } }}
            exit={{ opacity: 0, y: -8, transition: { duration: DURATION.exit, ease: EASE_IN } }}
          >
            <span>
              Kamu sudah dekat <strong>{hint}</strong>. Klik atap rumahmu di peta untuk melihat listrik dan panel suryanya.
            </span>
            <Button isIconOnly variant="ghost" size="sm" aria-label="Tutup petunjuk" onPress={() => clear(null)}>
              <Xmark aria-hidden />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
