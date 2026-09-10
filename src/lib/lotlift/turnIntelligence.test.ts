import { afterEach, describe, expect, it, vi } from "vitest";
import { newLotLiftCallState, reduceLotLiftCallState } from "./callState";
import { analyzeLotLiftTurn, type LotLiftTurnModelOutput } from "./turnIntelligence";
import { log } from "../log";
import type { Settings, TranscriptSegment } from "../types";

afterEach(() => vi.restoreAllMocks());

const turn = (text: string, id = "turn-1"): TranscriptSegment => ({ id, text, source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100 });
const IDENTIFY_OWNER_RESPONSE = "Who owns paid online inquiry response there: the internet manager, BDC manager, sales manager, or someone else?";
const model = (output: Partial<LotLiftTurnModelOutput> & Record<string, unknown> = {}) => async () => ({ spoken_response: "Who owns paid online inquiry response there?", grounding_segment_id: "turn-1", ...output } as LotLiftTurnModelOutput);
const run = (text: string, output: Partial<LotLiftTurnModelOutput> & Record<string, unknown> = {}, conversation = [turn(text)]) => analyzeLotLiftTurn({ state: newLotLiftCallState("call-1"), turn: conversation[conversation.length - 1]!, conversation, model: model(output) });

describe("LotLift response composer", () => {
  it("uses the exact locally rendered approved option", async () => {
    const result = await run("Who is this?");
    expect(result).toMatchObject({ source: "model", move_id: "identify-owner", selected_move: { id: "identify-owner" } });
    expect(result.selected_move?.response).toBe("Who owns paid online inquiry response there: the internet manager, BDC manager, sales manager, or someone else?");
  });

  it("routes identity questions to O2, composes only identification, and falls back to O2", async () => {
    const settings = { userName: "Avery", llmProviders: { realtime: "ollama" }, models: { ollama: { realtime: "qwen3:8b" } }, lotLiftLocalModelDeadlineMs: 4_000 } as Settings;
    const identity = turn("Who is this?");
    const accepted = await analyzeLotLiftTurn({ state: newLotLiftCallState("identity"), turn: identity, conversation: [identity], settings, model: model({ spoken_response: "It’s Avery, founder of LotLift.", grounding_segment_id: "turn-1" }) });
    const continued = await analyzeLotLiftTurn({ state: newLotLiftCallState("identity-fallback"), turn: identity, conversation: [identity], settings, model: model({ spoken_response: "It’s Avery, founder of LotLift. What can I help with?", grounding_segment_id: "turn-1" }) });
    expect(accepted).toMatchObject({ source: "model", move_id: "O2", playbook_rule_ids: ["discovery:ownership"], selected_move: { response: "“It’s Avery, founder of LotLift.”" }, state_events: [expect.objectContaining({ type: "coaching-progress", move_id: "O2" })] });
    expect(continued).toMatchObject({ source: "fallback", fallback_reason: "invalid-output", move_id: "O2", selected_move: { response: "“It’s Avery, founder of LotLift.”" } });
  });

  it("resolves a valid prospect segment locally and retains only deterministic state events", async () => {
    const accepted = await run("I'm the sales manager.", { grounding_segment_id: "turn-1" });
    const unknown = await run("I'm the sales manager.", { grounding_segment_id: "unknown-turn" });
    expect(accepted).toMatchObject({ source: "model", state_events: [
      expect.objectContaining({ type: "capture", field: "workflow_owner" }),
      expect.objectContaining({ type: "capture", field: "authority" }),
      expect.objectContaining({ type: "coaching-progress", move_id: "identify-owner" }),
    ] });
    expect(unknown).toMatchObject({ source: "fallback", fallback_reason: "invalid-output", state_events: [], selected_move: { response: IDENTIFY_OWNER_RESPONSE } });
    expect(unknown.spoken_response).toBeUndefined();
  });

  it("rejects invalid spoken copy and missing or unknown grounding without raw diagnostics", async () => {
    const diagnostic = vi.spyOn(log, "info");
    const extraField = await run("Who is this?", { response_option_id: "identify-owner" });
    const missingGrounding = await run("Who is this?", { grounding_segment_id: undefined });
    const unknownGrounding = await run("Who is this?", { grounding_segment_id: "unknown-turn" });
    const inventedClaim = await run("Who is this?", { spoken_response: "LotLift will save you money on every lead.", grounding_segment_id: "turn-1" });
    const unapprovedVocabulary = await run("Who is this?", { spoken_response: "Astronaut, who owns paid online inquiry response there?", grounding_segment_id: "turn-1" });
    const objectiveMismatch = await run("Which online sources generate most buyer inquiries for you today?", { spoken_response: "Which online sources generate most buyer inquiries for you today?", grounding_segment_id: "turn-1" });
    expect(extraField.source).toBe("fallback");
    expect(missingGrounding).toMatchObject({ source: "fallback", fallback_reason: "invalid-output", selected_move: { response: IDENTIFY_OWNER_RESPONSE } });
    expect(unknownGrounding).toMatchObject({ source: "fallback", fallback_reason: "invalid-output", selected_move: { response: IDENTIFY_OWNER_RESPONSE } });
    expect(missingGrounding.spoken_response).toBeUndefined();
    expect(unknownGrounding.spoken_response).toBeUndefined();
    expect(inventedClaim.source).toBe("fallback");
    expect(unapprovedVocabulary.source).toBe("fallback");
    expect(objectiveMismatch).toMatchObject({ source: "fallback", fallback_reason: "invalid-output" });
    const validationDiagnostics = diagnostic.mock.calls.map(([, fields]) => fields).filter((fields) => fields?.event === "validation");
    expect(validationDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ validator_rejection_code: "schema", validator_rejection_subreason: null }),
      expect.objectContaining({ validator_rejection_code: "spoken-response", validator_rejection_subreason: "prohibited-commercial-claim" }),
      expect.objectContaining({ validator_rejection_code: "spoken-response", validator_rejection_subreason: "unapproved-vocabulary" }),
      expect.objectContaining({ validator_rejection_code: "spoken-response", validator_rejection_subreason: "objective-mismatch" }),
    ]));
    expect(JSON.stringify(validationDiagnostics)).not.toContain("Astronaut");
    expect(JSON.stringify(validationDiagnostics)).not.toContain("Which online sources generate most buyer inquiries for you today?");
  });

  it("permits a grounded price acknowledgement only on the approved price card", async () => {
    const diagnostic = vi.spyOn(log, "info");
    const priceTurn = turn("This costs too much.");
    const safe = await analyzeLotLiftTurn({
      state: newLotLiftCallState("safe-price"),
      turn: priceTurn,
      model: model({ spoken_response: "I hear the price concern. Is the setup effort or another option the concern?", grounding_segment_id: "turn-1" }),
    });
    const unsafe = await analyzeLotLiftTurn({
      state: newLotLiftCallState("unsafe-price"),
      turn: priceTurn,
      model: model({ spoken_response: "I hear the price concern. It costs $20 per month.", grounding_segment_id: "turn-1" }),
    });
    const wrongCard = await run("Who is this?", { spoken_response: "I hear the price concern. Is the setup effort or another option the concern?", grounding_segment_id: "turn-1" });
    expect(safe).toMatchObject({ source: "model", move_id: "price" });
    expect(unsafe).toMatchObject({ source: "fallback", fallback_reason: "invalid-output", move_id: "price" });
    expect(wrongCard).toMatchObject({ source: "fallback", fallback_reason: "invalid-output", move_id: "identify-owner" });
    expect(diagnostic.mock.calls.map(([, fields]) => fields).filter((fields) => fields?.event === "validation")).toEqual(expect.arrayContaining([
      expect.objectContaining({ validator_rejection_code: "schema", validator_rejection_subreason: null }),
      expect.objectContaining({ validator_rejection_code: "spoken-response", validator_rejection_subreason: "unapproved-price-mention" }),
    ]));
  });

  it("reports privacy-safe categories for every commercial claim guard", async () => {
    const diagnostic = vi.spyOn(log, "info");
    const priceTurn = turn("This costs too much.");
    const priceOutput = (spoken_response: string) => analyzeLotLiftTurn({ state: newLotLiftCallState("price-category"), turn: priceTurn, model: model({ spoken_response, grounding_segment_id: "turn-1" }) });
    const results = await Promise.all([
      run("Who is this?", { spoken_response: "We save $20. Who owns paid online inquiry response there?" }),
      priceOutput("I can offer a discount on the price. Is setup effort the concern?"),
      run("Who is this?", { spoken_response: "We guarantee availability. Who owns paid online inquiry response there?" }),
      run("Who is this?", { spoken_response: "I hear the price concern. Who owns paid online inquiry response there?" }),
      run("Who is this?", { spoken_response: "Who owns paid online inquiry response there? Is it the sales manager?" }),
    ]);
    expect(results.every((result) => result.source === "fallback")).toBe(true);
    const subreasons = diagnostic.mock.calls.map(([, fields]) => fields?.validator_rejection_subreason).filter(Boolean);
    expect(subreasons).toEqual(expect.arrayContaining(["monetary-amount", "quote-or-discount", "prohibited-commercial-claim", "unapproved-price-mention", "multiple-questions"]));
  });

  it("falls back to the deterministic response when card-constrained model output is invalid", async () => {
    const local = vi.fn(async (): Promise<LotLiftTurnModelOutput> => ({ spoken_response: "Who owns paid online inquiry response there?", grounding_segment_id: "turn-1" }));
    const result = await analyzeLotLiftTurn({
      state: newLotLiftCallState("spouse"),
      turn: turn("I need to talk to my wife before we make a decision."),
      relevantRuleIds: ["objection:spouse-partner"],
      model: local,
    });
    expect(result).toMatchObject({ source: "fallback", selected_move: { id: "spouse-partner" } });
    expect(local).toHaveBeenCalledOnce();
  });

  it("falls back to a spouse-aware approved response before a discovery question", async () => {
    const spouse = turn("I need to talk to my wife.");
    const result = await analyzeLotLiftTurn({
      state: newLotLiftCallState("spouse-fallback"),
      turn: spouse,
      conversation: [spouse],
      model: async () => { throw new Error("Local AI unavailable"); },
    });
    expect(result).toMatchObject({ source: "fallback", move_id: "spouse-partner" });
    expect(result.selected_move?.response).toBe("“I understand another decision-maker needs to weigh in. What will they want to know before they’re comfortable?”");
  });

  it("keeps DNC and hostile terminal closures outside the composer", async () => {
    const local = vi.fn(async () => model() as never);
    const dnc = await analyzeLotLiftTurn({ state: newLotLiftCallState("dnc"), turn: turn("Do not call again."), model: local });
    const hostile = await analyzeLotLiftTurn({ state: newLotLiftCallState("hostile"), turn: turn("You are an asshole."), model: local });
    expect(dnc).toMatchObject({ source: "hard-rule", event_type: "do_not_contact" });
    expect(hostile).toMatchObject({ source: "hard-rule", move_id: "abuse-close" });
    expect(local).not.toHaveBeenCalled();
  });

  it("falls back on timeout and full-transcript overflow", async () => {
    vi.useFakeTimers();
    const timing = analyzeLotLiftTurn({ state: newLotLiftCallState("timeout"), turn: turn("Who is this?"), timeoutMs: 50, model: async ({ signal }) => new Promise<LotLiftTurnModelOutput>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    await expect(timing).resolves.toMatchObject({ source: "fallback", fallback_reason: "timeout" });
    vi.useRealTimers();
    const overflow = Array.from({ length: 49 }, (_, index) => turn(`line ${index}`, `line-${index}`));
    const result = await analyzeLotLiftTurn({ state: newLotLiftCallState("overflow"), turn: overflow[48]!, conversation: overflow, model: model() });
    expect(result).toMatchObject({ source: "fallback", fallback_reason: "transcript-limit-exceeded" });
  });

  it("captures a valid email locally and asks confirmation for ambiguous email", async () => {
    const captured = await analyzeLotLiftTurn({ state: newLotLiftCallState("email"), turn: turn("Send it to John@SmithMotors.com."), model: model() });
    const ambiguous = await analyzeLotLiftTurn({ state: newLotLiftCallState("email-confirm"), turn: turn("Send it to john at smith dot com."), model: model() });
    expect(captured.state_events[0]).toMatchObject({ field: "email", fact: { value: "john@smithmotors.com", status: "verified" } });
    expect(ambiguous.source).toBe("hard-rule");
  });

  it("composes a wife-aware response with the locally selected spouse option and stage", async () => {
    const wife = turn("Not interested, I need to talk to my wife.");
    const result = await analyzeLotLiftTurn({
      state: newLotLiftCallState("wife-fixture"),
      turn: wife,
      conversation: [wife],
      model: model({
        spoken_response: "I understand you need to talk to your wife. What will they want to know before they’re comfortable?",
        grounding_segment_id: "turn-1",
      }),
    });
    expect(result).toMatchObject({ source: "model", move_id: "spouse-partner", selected_move: { stage: "owner-identification" }, spoken_response: "I understand you need to talk to your wife. What will they want to know before they’re comfortable?" });
    expect(result.state_events).toEqual([expect.objectContaining({ type: "coaching-progress", move_id: "identify-owner" })]);
  });

  it("retains the locally rendered meeting option after verified workflow and authority", async () => {
    const evidence = { segment_id: "seed", text: "confirmed" };
    let state = newLotLiftCallState("booking");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: { value: "manager", status: "verified", evidence } });
    state = reduceLotLiftCallState(state, { type: "capture", field: "authority", fact: { value: "owner", status: "verified", evidence } });
    state = reduceLotLiftCallState(state, { type: "append", field: "lead_sources", fact: { value: "Autotrader", status: "verified", evidence } });
    state = reduceLotLiftCallState(state, { type: "append", field: "pain_points", fact: { value: "unworked leads", status: "verified", evidence } });
    state = reduceLotLiftCallState(state, { type: "capture", field: "after_hours_process", fact: { value: "no coverage", status: "verified", evidence } });
    state = reduceLotLiftCallState(state, { type: "capture", field: "visibility_process", fact: { value: "no review", status: "verified", evidence } });
    const approvedResponse = "It sounds worth mapping the lead source, ownership, after-hours coverage, and visibility in a short 15-minute workflow check. Would you be open to that?";
    const result = await analyzeLotLiftTurn({ state, turn: turn("That sounds useful."), model: model({ spoken_response: approvedResponse, grounding_segment_id: "turn-1" }) });
    expect(result).toMatchObject({ source: "model", spoken_response: approvedResponse, selected_move: { response: approvedResponse } });
  });
});
