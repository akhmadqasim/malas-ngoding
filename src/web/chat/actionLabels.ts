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

/** The labels of an answer's actions, one per distinct label, in order (two moves to the same region show once). */
export function actionChips(actions: ChatAction[]): { label: string; action: ChatAction }[] {
  const seen = new Map<string, ChatAction>();
  for (const action of actions) {
    const label = actionLabel(action);
    // Keeps the place of the first, the input of the latest: replaying it shows the final state.
    if (label) seen.set(label, action);
  }
  return [...seen].map(([label, action]) => ({ label, action }));
}
