import { LocationArrow, Magnifier } from "../icons.ts";
import { Button, Input, Label, TextField } from "@heroui/react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { api, type GeocodeHit } from "../api.ts";

/** Wait this long after the last key before searching, ms: one request per pause, not per letter. */
const DEBOUNCE_MS = 300;

export interface PickedPlace {
  at: [number, number];
  /** What to call it in the building panel: the street address, or "Lokasi saya". */
  label: string;
}

/**
 * Finding one's home: type an address or place in Kaltim (Mapbox Geocoding through our server) and pick a
 * result, or use the device's location (the browser asks first; the spot is not sent anywhere until the
 * resident saves it as their home). Arrow keys move through the results, Enter picks.
 */
export function AddressSearch({ onPick, autoFocus = false, compact = false, label = "Cari alamat rumahmu" }: { onPick: (place: PickedPlace) => void; autoFocus?: boolean; compact?: boolean; label?: string }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<"idle" | "searching" | "none" | "error" | "locating">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const listId = useId();
  const picked = useRef(false);

  useEffect(() => {
    const q = query.trim();
    if (picked.current || q.length < 3) {
      picked.current = false;
      setHits([]);
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setStatus("searching");
      api
        .geocode(q, controller.signal)
        .then(({ hits }) => {
          setHits(hits);
          setActive(0);
          setStatus(hits.length ? "idle" : "none");
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setHits([]);
          setStatus("error");
          setMessage(err instanceof Error ? err.message : "Pencarian gagal.");
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const choose = (hit: GeocodeHit) => {
    picked.current = true;
    setQuery(hit.name);
    setHits([]);
    onPick({ at: [hit.lng, hit.lat], label: hit.name });
  };

  const locate = () => {
    if (!navigator.geolocation) {
      setStatus("error");
      setMessage("Browser ini tidak bisa membaca lokasi. Ketik alamatmu saja.");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStatus("idle");
        onPick({ at: [pos.coords.longitude, pos.coords.latitude], label: "Lokasi saya" });
      },
      (err) => {
        setStatus("error");
        setMessage(err.code === err.PERMISSION_DENIED ? "Izin lokasi ditolak. Ketik alamatmu saja." : "Lokasi tidak terbaca. Ketik alamatmu saja.");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(hits[active]!);
    } else if (e.key === "Escape") {
      setHits([]);
    }
  };

  return (
    <div className="address-search" data-compact={compact || undefined}>
      <TextField name="alamat" type="search" value={query} onChange={setQuery} autoFocus={autoFocus}>
        <Label className={compact ? "sr-only" : undefined}>{label}</Label>
        <div className="address-search__field">
          <Magnifier aria-hidden className="address-search__icon" />
          <Input
            placeholder={compact ? "Cari alamat, gedung, atau wilayah…" : "Contoh: nama perumahan, kelurahan, atau tempat di dekat rumah"}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={hits.length ? `${listId}-${active}` : undefined}
            onKeyDown={onKeyDown}
            autoComplete="off"
          />
        </div>
      </TextField>
      {hits.length > 0 && (
        <ul id={listId} className="address-search__list" role="listbox" aria-label="Hasil pencarian alamat">
          {hits.map((h, i) => (
            <li key={`${h.lng},${h.lat},${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button type="button" className="address-search__hit" data-active={i === active || undefined} onClick={() => choose(h)} tabIndex={-1}>
                <span className="address-search__name">{h.name}</span>
                <span className="address-search__place">{h.place}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="address-search__foot">
        <Button variant="ghost" size="sm" isPending={status === "locating"} onPress={locate}>
          <LocationArrow aria-hidden />
          Pakai lokasi saya
        </Button>
        <span className="address-search__status" role="status">
          {status === "searching" ? "Mencari..." : status === "none" ? "Tidak ditemukan di Kalimantan Timur. Coba nama jalan atau kelurahan." : status === "error" ? message : ""}
        </span>
      </div>
    </div>
  );
}
