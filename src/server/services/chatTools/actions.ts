import type Anthropic from "@anthropic-ai/sdk";
import { inRange, latParam, lngParam, oneOf, point, REGION_PARAM, region } from "./common.ts";

// Map actions run in the browser: the server checks the input, sends it to the client as an `action`
// event and tells Claude `{ ok: true }` at once.

const LAYERS = ["regions", "plants", "buildings"] as const;
const METRICS = ["co2", "kwh"] as const;
const RAIN_MODES = ["auto", "on", "off"] as const;
const TABS = ["energi", "emisi", "surya", "cuaca"] as const;

export const ACTION_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "fly_to_region",
    description: "Map action: fly the 3D map to a kabupaten/kota so the user sees the region you are talking about.",
    input_schema: { type: "object", properties: { region: REGION_PARAM }, required: ["region"] },
  },
  {
    name: "fly_to",
    description:
      "Map action: fly the camera to a point. Zoom 6 shows all of Kaltim, 10 a city, 14 a district, 17.5 single buildings.",
    input_schema: {
      type: "object",
      properties: {
        lng: lngParam("the point"),
        lat: latParam("the point"),
        zoom: { type: "number", minimum: 0, maximum: 22, description: "Map zoom level." },
      },
      required: ["lng", "lat", "zoom"],
    },
  },
  {
    name: "select_building_at",
    description:
      "Map action: fly to a point, select the building there and open its panel; the app measures that building and estimates its electricity and CO2. Use it to show the user a specific building.",
    input_schema: {
      type: "object",
      properties: { lng: lngParam("the building"), lat: latParam("the building") },
      required: ["lng", "lat"],
    },
  },
  {
    name: "toggle_layer",
    description:
      "Map action: show or hide a map layer: regions (the 3D region columns), plants (power plants) or buildings (3D buildings).",
    input_schema: {
      type: "object",
      properties: { layer: { type: "string", enum: [...LAYERS] }, visible: { type: "boolean" } },
      required: ["layer", "visible"],
    },
  },
  {
    name: "set_metric",
    description: "Map action: colour and raise the regions by CO2 emissions (co2) or by electricity use (kwh).",
    input_schema: { type: "object", properties: { metric: { type: "string", enum: [...METRICS] } }, required: ["metric"] },
  },
  {
    name: "set_rain",
    description: "Map action: the rain effect on the map: auto (follows the live weather), on or off.",
    input_schema: { type: "object", properties: { mode: { type: "string", enum: [...RAIN_MODES] } }, required: ["mode"] },
  },
  {
    name: "open_tab",
    description:
      "Map action: open a tab of the building panel: energi (electricity use), emisi (CO2 and everyday equivalents), surya (solar simulation) or cuaca (weather and solar forecast). Works when a building is selected.",
    input_schema: { type: "object", properties: { tab: { type: "string", enum: [...TABS] } }, required: ["tab"] },
  },
];

export type ClientActionName =
  | "fly_to_region"
  | "fly_to"
  | "select_building_at"
  | "toggle_layer"
  | "set_metric"
  | "set_rain"
  | "open_tab";

/** A map action for the browser, with its input checked and normalised (region aliases resolved to ids). */
export interface ChatAction {
  name: ClientActionName;
  input: Record<string, unknown>;
}

type Checked = { input: Record<string, unknown> } | { problem: string };

/** Checks and normalises the input of each map action Claude can call. */
export const ACTIONS: Record<ClientActionName, (i: Record<string, unknown>) => Checked> = {
  fly_to_region: (i) => {
    const r = region(i.region);
    return "problem" in r ? r : { input: { region: r.id } };
  },
  fly_to: (i) => {
    const p = point(i);
    if ("problem" in p) return p;
    if (!inRange(i.zoom, 0, 22)) return { problem: "zoom harus berupa angka dari 0 sampai 22." };
    return { input: { lng: p.lng, lat: p.lat, zoom: i.zoom } };
  },
  select_building_at: (i) => {
    const p = point(i);
    return "problem" in p ? p : { input: { lng: p.lng, lat: p.lat } };
  },
  toggle_layer: (i) => {
    const layer = oneOf(i.layer, LAYERS);
    if (!layer) return { problem: `layer harus salah satu dari: ${LAYERS.join(", ")}.` };
    if (typeof i.visible !== "boolean") return { problem: "visible harus true atau false." };
    return { input: { layer, visible: i.visible } };
  },
  set_metric: (i) => {
    const metric = oneOf(i.metric, METRICS);
    return metric ? { input: { metric } } : { problem: `metric harus salah satu dari: ${METRICS.join(", ")}.` };
  },
  set_rain: (i) => {
    const mode = oneOf(i.mode, RAIN_MODES);
    return mode ? { input: { mode } } : { problem: `mode harus salah satu dari: ${RAIN_MODES.join(", ")}.` };
  },
  open_tab: (i) => {
    const tab = oneOf(i.tab, TABS);
    return tab ? { input: { tab } } : { problem: `tab harus salah satu dari: ${TABS.join(", ")}.` };
  },
};
