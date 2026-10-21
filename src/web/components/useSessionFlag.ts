import { useCallback, useState } from "react";

/** Reads a remembered on/off flag for this browser tab; `fallback` when none is stored or storage is blocked. */
export function readSessionFlag(key: string, fallback: boolean): boolean {
  try {
    const stored = sessionStorage.getItem(key);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}

/** An on/off state remembered for the session (sessionStorage), such as a disclosure left open. */
export function useSessionFlag(key: string, fallback: boolean): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => readSessionFlag(key, fallback));
  const set = useCallback(
    (next: boolean) => {
      setOn(next);
      try {
        sessionStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Storage blocked (private mode): the state still holds until the page reloads.
      }
    },
    [key],
  );
  return [on, set];
}
