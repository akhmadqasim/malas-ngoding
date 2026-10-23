import { Person } from "../icons.ts";
import { Button } from "@heroui/react";
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { useAppStore } from "../store.ts";
import { flyToProvince } from "../map/camera.ts";
import { Character } from "../components/Character.tsx";

/** Asks the server who is signed in (the session cookie) once, and fetches a resident's home. */
export function useSession() {
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true; setReady(false); setProblem(null);
    void (async () => {
      try {
        const {user} = await api.me();
        // Resolve the account and its home before constructing the map or choosing a startup camera.
        const home = user?.role === "warga" ? (await api.home()).home : null;
        if (!live) return;
        const s = useAppStore.getState(); s.setUser(user); s.setHome(home);
        if (user?.role === "warga") s.setHomeOpen(true);
        else if (user?.role === "pemda") s.setPemdaOpen(true);
        if (user) s.finishLanding();
        setReady(true);
      } catch { if (live) setProblem("Akun dan rumah belum berhasil dimuat. Coba lagi tanpa mengubah rumah tersimpan."); }
    })();
    return () => { live = false; };
  }, [attempt]);
  return {ready, problem, retry: () => setAttempt(v => v + 1)};
}

/** In the sheet's masthead: "Masuk" for a guest; the account's name and "Keluar" once signed in. */
export function AccountControl() {
  const user = useAppStore((s) => s.user);
  const checked = useAppStore((s) => s.authChecked);
  const openLogin = useAppStore((s) => s.setLoginOpen);

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    const s = useAppStore.getState();
    s.setUser(null);
    s.setStory(null);
    if (s.map) flyToProvince(s.map);
  };

  return (
    <>
      {!checked ? null : user ? (
        <span className="account-control">
          <Character role={user.role} />
          <span className="account-control__name" title={user.email}>
            {user.name}
            <span className="account-control__role">{user.role === "pemda" ? "pemda" : "warga"}</span>
          </span>
          <Button variant="ghost" size="sm" className="account-control__button" onPress={signOut}>
            Keluar
          </Button>
        </span>
      ) : (
        <Button variant="ghost" size="sm" className="account-control__button" onPress={() => openLogin(true)}>
          <Person aria-hidden />
          Masuk
        </Button>
      )}
    </>
  );
}
