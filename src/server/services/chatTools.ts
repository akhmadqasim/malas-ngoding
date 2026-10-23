import type Anthropic from "@anthropic-ai/sdk";
import type { AppDeps } from "../index.ts";
import { ACTION_TOOL_DEFINITIONS, ACTIONS, type ChatAction, type ClientActionName } from "./chatTools/actions.ts";
import { estimateBuildingAt, simulateSolar } from "./chatTools/buildingTools.ts";
import type { ServerTool } from "./chatTools/common.ts";
import { findPlaces } from "./chatTools/placeTools.ts";
import { getGridMix, getRecommendations, getRegionStats, listRegions } from "./chatTools/regionTools.ts";
import { getWeather } from "./chatTools/weatherTool.ts";

// The tools Claude can call in the chat, and the loop step that runs them. Server tools (chatTools/*Tools.ts)
// run here and their result goes back to Claude. Map actions (chatTools/actions.ts) run in the browser: the
// server checks the input, sends it to the client as an `action` event and tells Claude `{ ok: true }` at
// once. Tool results are JSON; every number Claude may quote is already formatted the Indonesian way and
// marked "(perkiraan)" when it is an estimate.

export type { ChatAction, ClientActionName };
export { DEFAULT_FOOTPRINT_M2 } from "./chatTools/buildingTools.ts";
export { buildingTypeLabel, KALTIM_AREA } from "./chatTools/common.ts";

/** Server-tool calls run per Claude reply; the rest get an error result (map actions are not counted). */
export const MAX_SERVER_TOOLS_PER_REPLY = 6;

const SERVER_TOOLS: ServerTool[] = [
  listRegions,
  getRegionStats,
  getGridMix,
  getRecommendations,
  estimateBuildingAt,
  simulateSolar,
  getWeather,
  findPlaces,
];
const SERVER_TOOLS_BY_NAME = new Map(SERVER_TOOLS.map((t) => [t.definition.name, t]));

/** Every chat tool, in a fixed order so the prompt prefix stays cacheable. */
export const CHAT_TOOLS: Anthropic.Tool[] = [...SERVER_TOOLS.map((t) => t.definition), ...ACTION_TOOL_DEFINITIONS];

const ALL_TOOL_NAMES = CHAT_TOOLS.map((t) => t.name).join(", ");

function asObject(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

const result = (id: string, value: unknown): Anthropic.ToolResultBlockParam => ({
  type: "tool_result",
  tool_use_id: id,
  content: JSON.stringify(value),
});
const failure = (id: string, problem: string): Anthropic.ToolResultBlockParam => ({
  type: "tool_result",
  tool_use_id: id,
  content: problem,
  is_error: true,
});

const TOO_MANY_TOOLS =
  `Terlalu banyak permintaan data dalam satu balasan: paling banyak ${MAX_SERVER_TOOLS_PER_REPLY} yang dijalankan. ` +
  "Permintaan ini tidak dijalankan; jawab dengan data yang sudah ada atau minta lagi di langkah berikutnya.";

/**
 * Runs the tool calls of one Claude reply. Map actions are checked and handed to `onAction` right away,
 * in the order Claude asked for them; server tools run concurrently, at most MAX_SERVER_TOOLS_PER_REPLY
 * of them. Returns one result per call, in the same order, to send back in a single user message.
 * Never throws: a failing or skipped tool becomes an error result.
 */
export async function runToolCalls(
  deps: AppDeps,
  calls: Anthropic.ToolUseBlock[],
  onAction: (action: ChatAction) => void,
): Promise<Anthropic.ToolResultBlockParam[]> {
  let serverCalls = 0;
  return Promise.all(
    calls.map(async (call): Promise<Anthropic.ToolResultBlockParam> => {
      const input = asObject(call.input);
      if (Object.hasOwn(ACTIONS, call.name)) {
        const name = call.name as ClientActionName;
        const checked = ACTIONS[name](input);
        if ("problem" in checked) return failure(call.id, checked.problem);
        onAction({ name, input: checked.input });
        return result(call.id, { ok: true });
      }
      const tool = SERVER_TOOLS_BY_NAME.get(call.name);
      if (!tool) {
        return failure(call.id, `Alat "${call.name.slice(0, 80)}" tidak ada. Alat yang tersedia: ${ALL_TOOL_NAMES}.`);
      }
      // Counted before the first await, so the cap follows the order of the calls.
      serverCalls += 1;
      if (serverCalls > MAX_SERVER_TOOLS_PER_REPLY) return failure(call.id, TOO_MANY_TOOLS);
      try {
        const out = await tool.run(deps, input, onAction);
        return "problem" in out ? failure(call.id, out.problem) : result(call.id, out.result);
      } catch (err) {
        console.warn(`chat tool ${call.name} failed:`, err instanceof Error ? err.message : "unknown error");
        return failure(call.id, "Data sedang tidak bisa dimuat. Sampaikan ke pengguna bahwa datanya belum bisa diambil sekarang.");
      }
    }),
  );
}
