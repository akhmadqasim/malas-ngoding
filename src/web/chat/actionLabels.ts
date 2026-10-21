import type { ChatAction } from "./sse.ts";

// What each chat map action did, in a few Indonesian words, for the action buttons under an answer.

const LAYER_WORDS: Record<string, string> = { regions: "Kolom wilayah", plants: "Pembangkit", buildings: "Gedung 3D" };
const TAB_WORDS: Record<string, string> = { energi: "Energi", emisi: "Emisi", surya: "Surya", cuaca: "Cuaca" };
const RAIN_WORDS: Record<string, string> = { auto: "ikut cuaca", on: "nyala", off: "mati" };

/** "kutai-kartanegara" reads "Kutai Kartanegara". Region ids are their names in lower case with dashes. */
export function regionName(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/** A short label for an action, or null for one the panel does not show. */
export function actionLabel(action: ChatAction): string | null {
  const i = action.input ?? {};
  switch (action.name) {
    case "fly_to_region":
      return typeof i.region === "string" ? regionName(i.region) : null;
    case "show_all_regions":
      return "Seluruh Kaltim";
    case "fly_to":
      return "Pindah tempat di peta";
    case "select_building_at":
      return "Gedung dipilih";
    case "toggle_layer": {
      const layer = typeof i.layer === "string" ? LAYER_WORDS[i.layer] : undefined;
      return layer ? `${layer} ${i.visible ? "ditampilkan" : "disembunyikan"}` : null;
    }
    case "set_metric":
      return i.metric === "kwh" ? "Warna menurut listrik" : i.metric === "co2" ? "Warna menurut emisi CO2" : null;
    case "set_rain": {
      const mode = typeof i.mode === "string" ? RAIN_WORDS[i.mode] : undefined;
      return mode ? `Hujan ${mode}` : null;
    }
    case "open_tab": {
      const tab = typeof i.tab === "string" ? TAB_WORDS[i.tab] : undefined;
      return tab ? `Tab ${tab}` : null;
    }
    case "mark_places": {
      const count = Array.isArray(i.places) ? i.places.length : 0;
      const label = typeof i.label === "string" ? i.label : "tempat";
      return count > 0 ? `${count} ${label} ditandai` : null;
    }
    default:
      return null;
  }
}

/** One action button under an answer. `failed`: the action ran but did not get there. */
export interface ActionChip {
  label: string;
  /** The action's index in the answer, to run it again. */
  index: number;
  failed: boolean;
}

/** What a failed action's button says instead of its usual label. */
const FAILED_LABELS: Partial<Record<ChatAction["name"], string>> = {
  select_building_at: "Gedung tidak ditemukan",
  open_tab: "Tab belum bisa dibuka",
};
/** What an action's button says while it is still running, when its usual label would claim too much. */
const PENDING_LABELS: Partial<Record<ChatAction["name"], string>> = {
  select_building_at: "Mencari gedung…",
};

/**
 * The buttons of an answer's actions, one per distinct label, in order (two moves to the same region show
 * once; the button runs the latest). A button only claims what happened: an action that was skipped has
 * none, a failed one says so, and one still running says what it is doing. `outcomes` is missing for
 * answers kept from before outcomes were recorded; their actions count as done.
 */
export function actionChips(actions: ChatAction[], outcomes?: (string | undefined)[]): ActionChip[] {
  const seen = new Map<string, ActionChip>();
  actions.forEach((action, index) => {
    const outcome = outcomes ? outcomes[index] : "ok";
    if (outcome === "skipped") return;
    const failed = outcome === "failed";
    const label =
      (failed && FAILED_LABELS[action.name]) || (outcome === undefined && PENDING_LABELS[action.name]) || actionLabel(action);
    if (!label) return;
    // A later success replaces an earlier failure of the same kind (and the other way round).
    const key = action.name === "select_building_at" ? "select_building_at" : label;
    seen.set(key, { label, index, failed });
  });
  return [...seen.values()];
}
