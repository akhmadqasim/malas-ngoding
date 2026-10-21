import { describe, expect, test } from "bun:test";
import type { Map as MapboxMap } from "mapbox-gl";
import type { BuildingEstimate } from "../../src/shared/types.ts";
import { chatContext } from "../../src/web/chat/useChat.ts";
import { KALTIM_VIEW } from "../../src/web/map/camera.ts";
import { type AppState, useAppStore } from "../../src/web/store.ts";

const BUILDING = { featureId: "b1", type: "sekolah" } as unknown as BuildingEstimate;
const map = (lng: number, lat: number, zoom: number) =>
  ({ getCenter: () => ({ wrap: () => ({ lng, lat }) }), getZoom: () => zoom }) as unknown as MapboxMap;
const state = (over: Partial<AppState>): AppState => ({ ...useAppStore.getState(), ...over });

describe("chatContext: what the question carries about the map", () => {
  test("a selected building goes with its own point", () => {
    const ctx = chatContext(
      state({ map: map(117.15, -0.5, 17.5), selectedRegionId: "samarinda", selectedBuilding: BUILDING, selectedBuildingAt: [117.151, -0.501] }),
    );
    expect(ctx).toEqual({
      selectedRegionId: "samarinda",
      selectedBuilding: BUILDING,
      selectedBuildingAt: [117.151, -0.501],
      view: { center: [117.15, -0.5], zoom: 17.5 },
    });
  });

  test("without a building no point is sent, even if one is left in the store", () => {
    const ctx = chatContext(state({ map: map(117, -0.4, 9), selectedBuilding: null, selectedBuildingAt: [117.1, -0.5] }));
    expect(ctx.selectedBuilding).toBeNull();
    expect(ctx.selectedBuildingAt).toBeNull();
  });

  test("the zoom stays within what the server accepts, and no map means the province view", () => {
    expect(chatContext(state({ map: map(117, -0.4, 25.3) })).view.zoom).toBe(24);
    expect(chatContext(state({ map: null })).view).toEqual({ center: KALTIM_VIEW.center, zoom: KALTIM_VIEW.zoom });
  });
});
