import { useAppStore } from "../store.ts";

/**
 * Takes the camera to a searched place (an address, a housing estate, the device's location) and opens the
 * building there. A search point often lies on a street or in a yard, not on a roof: then the camera stays
 * at building zoom over the place and a hint asks the resident to click their roof, instead of an error.
 */
export async function goToPlace(place: { at: [number, number]; label: string }): Promise<void> {
  const s = useAppStore.getState();
  const map = s.map;
  if (!map) return;
  // The landing hands over while the intro's last easing still runs; a pick started then never lands.
  if (map.isMoving()) await new Promise<void>((resolve) => map.once("moveend", () => resolve()));
  s.setPlaceHint(null);
  await s.selectBuildingAt(place.at, { name: place.label });
  const after = useAppStore.getState();
  if (after.buildingStatus === "empty") {
    after.closeBuilding();
    after.setPlaceHint(place.label);
  }
}
