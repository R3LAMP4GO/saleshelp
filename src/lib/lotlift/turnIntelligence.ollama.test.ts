import { afterEach, describe, expect, it, vi } from "vitest";
import { newLotLiftCallState } from "./callState";
import { analyzeLotLiftTurn } from "./turnIntelligence";
import type { Settings, TranscriptSegment } from "../types";

const turn: TranscriptSegment = { id: "ollama-turn", text: "Who is this?", source: "them", speaker: 0, isFinal: true, startMs: 400, endMs: 500 };
const conversation: TranscriptSegment[] = [
  { id: "earlier-prospect", text: "I am listening.", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100 },
  { id: "earlier-representative", text: "Thanks for taking my call.", source: "me", speaker: 1, isFinal: true, startMs: 200, endMs: 300 },
  turn,
];
const settings = {
  llmProviders: { realtime: "ollama" },
  models: { ollama: { realtime: "qwen3:4b" } },
  ollamaApiKey: "",
  lotLiftLocalModelDeadlineMs: 4_000,
} as unknown as Settings;

afterEach(() => vi.unstubAllGlobals());

describe("LotLift Ollama structured selection", () => {
  it("accepts valid native Ollama structured output before the configured deadline", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: {
        content: JSON.stringify({
          spoken_response: "Who owns paid online inquiry response there?",
          grounding_segment_id: "ollama-turn",
        }),
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await analyzeLotLiftTurn({ state: newLotLiftCallState("ollama"), turn, conversation, settings });

    expect(result).toMatchObject({ source: "model", move_id: "identify-owner", selected_move: { id: "identify-owner" } });
    expect(result.fallback_reason).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/chat", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const request = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(request).toMatchObject({ model: "qwen3:4b", think: false, stream: false, keep_alive: "30m", options: { num_predict: 160 } });
    expect(request.format.properties).toEqual(expect.objectContaining({ spoken_response: expect.any(Object), grounding_segment_id: expect.any(Object) }));
    expect(request.format.properties.spoken_response).not.toHaveProperty("pattern");
    expect(request.format.properties.grounding_segment_id).toMatchObject({ type: "string", enum: ["earlier-prospect", "ollama-turn"] });
    expect(request.format.properties).not.toHaveProperty("grounding");
    expect(request.format.properties).not.toHaveProperty("grounding_text");
    expect(request.format.properties).not.toHaveProperty("response_option_id");
    expect(request.format.properties).not.toHaveProperty("stage");
    expect(request.format.properties).not.toHaveProperty("confidence");
    expect(request.format.properties).not.toHaveProperty("reason_code");
    expect(request.format.properties).not.toHaveProperty("state_events");
    const prompt = request.messages[1].content as string;
    expect(prompt).not.toContain("PRICE_CONCERN_CONTRACT");
    const payload = JSON.parse(prompt.slice("COMPOSITION_CONTEXT=".length, prompt.indexOf("\nReturn JSON only.")));
    expect(payload).toEqual(expect.objectContaining({
      final_transcript: [
        { id: "earlier-prospect", source: "them", text: "I am listening." },
        { id: "earlier-representative", source: "me", text: "Thanks for taking my call." },
        { id: "ollama-turn", source: "them", text: "Who is this?" },
      ],
      selected_response: { approved_response: "Who owns paid online inquiry response there: the internet manager, BDC manager, sales manager, or someone else?", objective: "Find the person responsible for paid online inquiry coverage." },
      selected_tactic: { id: "permission-and-route", allowed_claim_classes: ["prospect-evidence", "approved-policy-fact", "question"] },
    }));
    expect(payload).not.toHaveProperty("composition_version");
    expect(payload).not.toHaveProperty("prior_objections");
    expect(payload).not.toHaveProperty("stakeholder_context");
    expect(payload).not.toHaveProperty("sales_script_stage");
    expect(payload).not.toHaveProperty("approved_objection_card");
  });

  it("adds the no-commercial-output contract for an approved price tactic", async () => {
    const priceTurn: TranscriptSegment = { ...turn, id: "price-turn", text: "This costs too much." };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { content: JSON.stringify({ spoken_response: "I hear the price concern. Is the setup effort or another option the concern?", grounding_segment_id: "price-turn" }) },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await analyzeLotLiftTurn({ state: newLotLiftCallState("ollama-price"), turn: priceTurn, conversation: [priceTurn], settings });

    expect(result).toMatchObject({ source: "model", move_id: "price" });
    const request = JSON.parse(fetchMock.mock.calls[0]![1].body);
    const pricePattern = new RegExp(request.format.properties.spoken_response.pattern);
    expect(pricePattern.test("I hear the price concern. Which part feels uncertain?")).toBe(true);
    expect(pricePattern.test("I hear the price concern at $20.")).toBe(false);
    expect(pricePattern.test("I hear the price concern at €20 or £20.")).toBe(false);
    const prompt = request.messages[1].content as string;
    expect(prompt).toContain("PRICE_CONCERN_CONTRACT=For this approved price-related tactic");
    expect(prompt).toContain("ask exactly one diagnostic question");
    expect(prompt).toContain("Never output any number, currency, dollar amount, payment, quote, range, discount, or commercial offer");
  });
});
