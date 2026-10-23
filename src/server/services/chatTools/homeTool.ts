import type Anthropic from "@anthropic-ai/sdk";
import type { Home } from "../../../shared/auth.ts";
import { fmtKwh, fmtNumber } from "../../../shared/format.ts";
import { buildingTypeLabel, estimated, type ServerTool } from "./common.ts";
import { simulateSolar } from "./buildingTools.ts";

// The signed-in resident's own home, for the chat. The tool is built per request around the home the server
// read for the session's user, takes no input, and so cannot be pointed at anyone else's data.

export const GET_MY_HOME = "get_my_home";

export const myHomeDefinition: Anthropic.Tool = {
  name: GET_MY_HOME,
  description:
    "The home the signed-in resident marked on the map (region, type, floors, roof area, yearly electricity and where that number comes from, the rooftop solar the roof could hold) together with a rooftop solar simulation for it. Takes no input. Use it for questions about 'rumah saya' or 'atap saya'.",
  input_schema: { type: "object", properties: {} },
};

/** The home as short facts for the prompt line and the tool result. */
export function describeHome(home: Home): string {
  const where = home.regionName ? `di ${home.regionName}` : "di luar Kalimantan Timur";
  const source = home.kwhSource === "tagihan" ? "dari tagihan pengguna" : "perkiraan model";
  return (
    `${buildingTypeLabel(home.buildingType)} ${where}, ${home.floors} lantai, luas atap ${fmtNumber(home.roofAreaM2)} m2, ` +
    `listrik ${fmtKwh(home.kwhYear)} per tahun (${source}), atap muat panel hingga ${fmtNumber(home.potentialKwp, 1)} kWp`
  );
}

export function myHomeTool(home: Home): ServerTool {
  return {
    definition: myHomeDefinition,
    run: async (deps, _input, emit) => {
      const sim = await simulateSolar.run(
        deps,
        {
          lat: home.lat,
          lng: home.lng,
          roofAreaM2: home.roofAreaM2,
          kwhYear: Math.round(home.kwhYear),
          backupHours: 4,
          buildingType: home.buildingType,
        },
        emit,
      );
      return {
        result: {
          home: {
            region: home.regionName ?? "Di luar Kalimantan Timur",
            type: buildingTypeLabel(home.buildingType),
            buildingType: home.buildingType,
            floors: home.floors,
            roofAreaM2: home.roofAreaM2,
            kwhYear: Math.round(home.kwhYear),
            kwhYearText: estimated(`${fmtKwh(home.kwhYear)} per tahun`, home.kwhSource === "perkiraan"),
            kwhSource: home.kwhSource === "tagihan" ? "dari tagihan yang diisi pengguna" : "perkiraan model",
            potentialKwpText: estimated(`${fmtNumber(home.potentialKwp, 1)} kWp muat di atap`),
            interestedPv: home.interestedPv,
            lng: home.lng,
            lat: home.lat,
          },
          solar: "problem" in sim ? { problem: sim.problem } : sim.result,
        },
      };
    },
  };
}
