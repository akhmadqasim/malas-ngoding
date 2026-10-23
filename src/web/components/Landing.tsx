import { ChartColumn, Globe, House } from "../icons.ts";
import { Button } from "@heroui/react";
import { AnimatePresence, motion } from "motion/react";
import { DURATION, EASE_IN, EASE_OUT, stagger } from "../motion.ts";
import { useAppStore } from "../store.ts";
import { AddressSearch } from "./AddressSearch.tsx";
import { chem } from "./Chem.tsx";

/**
 * The first page: the globe turns behind it while the visitor picks where to start. A resident types their
 * address (or uses their location) and lands on their house; anyone can look at Kaltim's energy as a whole;
 * the local government signs in. The intro flight starts once a choice is made (MapView waits for it).
 */
export function Landing({ ready }: { ready: boolean }) {
  const landing = useAppStore((s) => s.landing);
  const user = useAppStore((s) => s.user);
  const finish = useAppStore((s) => s.finishLanding);
  const openLogin = useAppStore((s) => s.setLoginOpen);

  const asGovernment = () => {
    // A government account goes straight on; anyone else signs in first (the dialog has a demo button).
    if (user?.role === "pemda") finish();
    else openLogin(true);
  };

  const enter = (i: number) => ({
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0, transition: { duration: DURATION.introText, delay: 0.1 + stagger(i) * 3, ease: EASE_OUT } },
  });

  return (
    <AnimatePresence>
      {landing === "open" && (
        <motion.section
          key="landing"
          className="landing"
          aria-label="Selamat datang di Malas Ngoding"
          exit={{ opacity: 0, transition: { duration: DURATION.assemble, ease: EASE_IN } }}
        >
          <div className="intro__scrim" aria-hidden />
          <div className="landing__copy">
            <motion.p className="landing__brand" {...enter(0)}>
              Malas Ngoding, kembar digital energi Kalimantan Timur
            </motion.p>
            <motion.h1 className="landing__title" {...enter(1)}>
              Berapa listrik rumahmu, dan berapa yang bisa diganti matahari?
            </motion.h1>
            <motion.p className="landing__lede" {...enter(2)}>
              {chem(
                "Sebagian besar listrik Kaltim masih dari batu bara. Cari rumahmu untuk melihat listrik dan CO2-nya, lalu hitung panel surya yang cocok untuk atapnya.",
              )}
            </motion.p>

            <motion.div className="landing__search" {...enter(3)}>
              <AddressSearch autoFocus onPick={(place) => finish(place)} />
            </motion.div>

            <motion.div className="landing__choices" {...enter(4)}>
              <button type="button" className="landing__choice" onClick={() => { useAppStore.getState().setHomeOpen(true); finish(); }}>
                <House aria-hidden />
                <span className="landing__choice-name">Coba tanpa akun</span>
                <span className="landing__choice-text">Coba hujan, panel, dan baterai. Akun diperlukan saat menyimpan rumah.</span>
              </button>
              <button type="button" className="landing__choice" onClick={() => finish()}>
                <Globe aria-hidden />
                <span className="landing__choice-name">Lihat energi Kaltim</span>
                <span className="landing__choice-text">Emisi dan listrik 10 kabupaten dan kota, pembangkit, cuaca.</span>
              </button>
              <button type="button" className="landing__choice" onClick={asGovernment}>
                <ChartColumn aria-hidden />
                <span className="landing__choice-name">Saya dari pemerintah</span>
                <span className="landing__choice-text">Rencanakan PLTS, lihat minat warga dan rekomendasi per wilayah.</span>
              </button>
            </motion.div>

            <motion.div className="landing__foot" {...enter(5)}>
              <span>Mendukung SDG 7: energi bersih dan terjangkau. Semua angka perkiraan dengan sumber yang disebut.</span>
              {!user && (
                <Button variant="ghost" size="sm" onPress={() => openLogin(true)}>
                  Sudah punya akun? Masuk
                </Button>
              )}
              {!ready && <span className="landing__status">Memuat peta...</span>}
            </motion.div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
