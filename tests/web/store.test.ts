import { beforeEach, describe, expect, test } from "bun:test";
import { useAppStore } from "../../src/web/store.ts";

const state = () => useAppStore.getState();

beforeEach(() => {
  useAppStore.setState({ selectedRegionId: null, hoveredRegionId: null, hoverOrigin: null });
});

describe("the hover preview ends when its job is done", () => {
  test("picking a region from the list ends the list hover that pointed at it", () => {
    state().setHoveredRegion("paser", "list");
    state().selectRegion("paser");
    expect(state().selectedRegionId).toBe("paser");
    expect(state().hoveredRegionId).toBeNull();
    expect(state().hoverOrigin).toBeNull();
  });

  test("clicking a column ends the map hover too (the detail panel takes over)", () => {
    state().setHoveredRegion("berau", "map");
    state().selectRegion("berau");
    expect(state().hoveredRegionId).toBeNull();
  });

  test("going back to all regions leaves no hover behind", () => {
    state().selectRegion("paser");
    state().setHoveredRegion("paser", "list");
    state().selectRegion(null);
    expect(state().hoveredRegionId).toBeNull();
    expect(state().hoverOrigin).toBeNull();
  });
});

describe("the list only ends its own hover", () => {
  test("a row ends its hover when the pointer leaves or it loses focus", () => {
    state().setHoveredRegion("paser", "list");
    state().endListHover("paser");
    expect(state().hoveredRegionId).toBeNull();
    expect(state().hoverOrigin).toBeNull();
  });

  test("another row or the map that took over meanwhile keeps the hover", () => {
    state().setHoveredRegion("berau", "list");
    state().endListHover("paser");
    expect(state().hoveredRegionId).toBe("berau");
    state().setHoveredRegion("paser", "map");
    state().endListHover("paser");
    expect(state().hoveredRegionId).toBe("paser");
    expect(state().hoverOrigin).toBe("map");
  });

  test("the list going away ends whichever row was pointed at, and leaves a map hover alone", () => {
    state().setHoveredRegion("kutai-barat", "list");
    state().endListHover();
    expect(state().hoveredRegionId).toBeNull();
    state().setHoveredRegion("kutai-barat", "map");
    state().endListHover();
    expect(state().hoveredRegionId).toBe("kutai-barat");
  });

  test("clearing the hover clears where it came from", () => {
    state().setHoveredRegion("paser", "map");
    state().setHoveredRegion(null);
    expect(state().hoverOrigin).toBeNull();
  });
});
