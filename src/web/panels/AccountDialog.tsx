import { Button, Description, FieldError, Input, Label, Modal, TextField } from "@heroui/react";
import { type FormEvent, useState } from "react";
import type { AuthAnswer, Role } from "../../shared/auth.ts";
import { api } from "../api.ts";
import { Segmented } from "../components/Segmented.tsx";
import { useAppStore } from "../store.ts";

type Mode = "masuk" | "daftar";

const MODES = [
  { key: "masuk" as const, label: "Masuk" },
  { key: "daftar" as const, label: "Daftar warga" },
];

/** After signing in: the resident's home (if any) is fetched and each role lands on its own view. */
export async function afterSignIn(answer: AuthAnswer): Promise<void> {
  const s = useAppStore.getState();
  s.setUser(answer.user);
  if (!answer.user) return;
  if (s.selectedRegionId !== null) s.selectRegion(null);
  if (s.buildingStatus !== "idle") s.closeBuilding();
  if (answer.user.role === "warga") {
    const { home } = await api.home().catch(() => ({ home: null }));
    useAppStore.getState().setHome(home);
    useAppStore.getState().setHomeOpen(true);
    // From the landing page, a resident with a home lands on it.
    if (useAppStore.getState().landing === "open") useAppStore.getState().finishLanding();
  } else {
    useAppStore.getState().setPemdaOpen(true);
    if (useAppStore.getState().landing === "open") useAppStore.getState().finishLanding();
  }
}

/**
 * Signing in and residents' sign-up, in one dialog. Government accounts cannot sign up: an admin makes them.
 * For judges and demos, two buttons sign in as the seeded demo resident or demo government account.
 */
export function AccountDialog() {
  const open = useAppStore((s) => s.loginOpen);
  const setOpen = useAppStore((s) => s.setLoginOpen);
  const [mode, setMode] = useState<Mode>("masuk");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shortPassword = mode === "daftar" && password.length > 0 && password.length < 8;

  const finish = async (call: () => Promise<AuthAnswer>) => {
    setBusy(true);
    setProblem(null);
    try {
      await afterSignIn(await call());
      setPassword("");
      setOpen(false);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Gagal masuk. Coba lagi.");
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (shortPassword) return;
    void finish(() => (mode === "masuk" ? api.login({ email, password }) : api.register({ name, email, password })));
  };
  const demo = (role: Role) => void finish(() => api.demoLogin(role));

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
      <Modal.Container size="sm" placement="center">
        <Modal.Dialog className="account" aria-label="Masuk ke Malas Ngoding">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading className="account__title">Masuk ke Malas Ngoding</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <p className="account__lede">
              Warga: setelah masuk, langsung lihat rumah yang tersimpan di akunmu. Tetapkan sekali jika rumah belum terhubung. Pemerintah daerah: lihat semua wilayah dan minat warga.
            </p>
            <div className="account__demo">
              <span className="group-label">Coba tanpa daftar</span>
              <div className="account__demo-buttons">
                <Button variant="outline" size="sm" isDisabled={busy} onPress={() => demo("warga")}>
                  Masuk sebagai warga demo
                </Button>
                <Button variant="outline" size="sm" isDisabled={busy} onPress={() => demo("pemda")}>
                  Masuk sebagai pemda demo
                </Button>
              </div>
            </div>
            <div className="account__mode">
              <span className="group-label" id="account-mode">
                Akun sendiri
              </span>
              <Segmented labelledBy="account-mode" options={MODES} value={mode} onChange={setMode} indicatorId="account-mode-indicator" />
            </div>
            <form className="account__form" onSubmit={submit}>
              {mode === "daftar" && (
                <TextField isRequired name="name" value={name} onChange={setName} autoComplete="name">
                  <Label>Nama</Label>
                  <Input />
                </TextField>
              )}
              <TextField isRequired name="email" type="email" value={email} onChange={setEmail} autoComplete="email">
                <Label>Email</Label>
                <Input />
              </TextField>
              <TextField
                isRequired
                isInvalid={shortPassword}
                name="password"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete={mode === "masuk" ? "current-password" : "new-password"}
              >
                <Label>Kata sandi</Label>
                <Input />
                {shortPassword ? <FieldError>Minimal 8 karakter.</FieldError> : mode === "daftar" ? <Description>Minimal 8 karakter.</Description> : null}
              </TextField>
              {problem && (
                <p className="account__problem" role="alert">
                  {problem}
                </p>
              )}
              <Button type="submit" variant="primary" isPending={busy}>
                {mode === "masuk" ? "Masuk" : "Daftar dan masuk"}
              </Button>
              <p className="account__note">
                Akun pemerintah daerah dibuat oleh admin. Kata sandi disimpan dalam bentuk hash, dan data rumahmu hanya terlihat oleh pemda sebagai titik
                tanpa nama bila kamu mengizinkannya.
              </p>
            </form>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
