import { afterEach, describe, expect, it, vi } from "vitest";
import { newLotLiftCallState } from "./callState";
import { analyzeLotLiftTurn } from "./turnIntelligence";
import type { Settings, TranscriptSegment } from "../types";

const turn: TranscriptSegment = { id: "ollama-turn", text: "We use VinSolutions today.", source: "them", speaker: 0, isFinal: true, startMs: 400, endMs: 500 };
const conversation: TranscriptSegment[] = [
  { id: "earlier-prospect", text: "I am listening.", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100 },
  { id: "earlier-representative", text: "Thanks for taking my call.", source: "me", speaker: 1, isFinal: true, startMs: 200, endMs: 300 }, turn,
];
const settings = { llmProviders: { realtime: "ollama" }, models: { ollama: { realtime: "qwen3:4b" } }, ollamaApiKey: "", lotLiftLocalModelDeadlineMs: 4_000 } as unknown as Settings;
afterEach(() => vi.unstubAllGlobals());

describe("LotLift Ollama bounded selection", () => {
  it("requires native structured candidate selection and multiple prospect citations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: JSON.stringify({ selected_move_id: "terra-composition", spoken_response: "Got it. How are those online inquiries covered after hours?", grounding_segment_ids: ["ollama-turn"] }) } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await analyzeLotLiftTurn({ state: newLotLiftCallState("ollama"), turn, conversation, settings });
    expect(result).toMatchObject({ source: "model", move_id: "terra-composition", selected_move: { id: "terra-composition" } });
    const request = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(request).toMatchObject({ model: "qwen3:4b", think: false, stream: false, keep_alive: "30m", options: { num_predict: 160 } });
    expect(request.format.properties).toEqual({ selected_move_id: expect.any(Object), grounding_segment_ids: expect.any(Object), spoken_response: expect.any(Object) });
    const prompt = request.messages[1].content as string;
    const payload = JSON.parse(prompt.slice("SALES_DECISION_CONTEXT=".length, prompt.indexOf("\nReturn JSON only.")));
    expect(payload).toMatchObject({ latest_prospect_turn: { id: "ollama-turn" }, sales_script_stage: expect.any(Object), eligible_sales_moves: [expect.objectContaining({ id: "terra-composition", rule_ids: expect.any(Array), approved_strategy: expect.any(String) })] });
    expect(payload).toHaveProperty("previous_objections_and_rep_responses");
    expect(payload).toHaveProperty("previous_rep_questions");
    expect(payload).toHaveProperty("previous_objection_responses");
    expect(payload).toHaveProperty("stakeholder_context");
  });

  it("keeps price output free of commercial claims while permitting contextual wording", async () => {
    const priceTurn: TranscriptSegment = { ...turn, id: "price-turn", text: "This costs too much." };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: JSON.stringify({ selected_move_id: "terra-composition", spoken_response: "I hear you. Is the concern the spend itself or whether the value is clear?", grounding_segment_ids: ["price-turn"] }) } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await analyzeLotLiftTurn({ state: newLotLiftCallState("ollama-price"), turn: priceTurn, conversation: [priceTurn], settings });
    expect(result).toMatchObject({ source: "model", move_id: "terra-composition" });
    const request = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(request.format.properties.spoken_response).not.toHaveProperty("pattern");
    expect(request.messages[0].content).toContain("Never invent product capabilities, pricing, integrations, ROI");
  });
});
