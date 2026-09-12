import { describe, expect, it, vi } from "vitest";
import { newLotLiftCallState, reduceLotLiftCallState, type CallStateEvent } from "./callState";
import { analyzeLotLiftTurn, type LotLiftTurnModel, type LotLiftTurnModelOutput } from "./turnIntelligence";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../../../sales-profiles/lotlift/profile";
import { resolveSalesProfile } from "../sales/profiles";
import type { TranscriptSegment } from "../types";

const prospect = (id: string, text: string): TranscriptSegment => ({ id, text, source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100 });
const rep = (id: string, text: string): TranscriptSegment => ({ id, text, source: "me", speaker: 1, isFinal: true, startMs: 0, endMs: 100 });
const output = (spoken_response: string, id = "terra-composition"): LotLiftTurnModelOutput => ({ selected_move_id: id, spoken_response, grounding_segment_ids: ["turn"] });
const profile = resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE);

async function run(model: () => Promise<LotLiftTurnModelOutput>, state = newLotLiftCallState("test"), conversation: TranscriptSegment[] = [prospect("turn", "We use a CRM, but leads wait until morning.")], signal?: AbortSignal) {
  const turn = conversation[conversation.length - 1]!;
  return analyzeLotLiftTurn({ state, turn, conversation, model: async () => model(), resolvedProfile: profile, signal });
}

describe("Terra-first turn intelligence", () => {
  it("passes reduced state, actual dialogue, canonical policy, product facts, and one objective", async () => {
    const requests: Array<{ system: string; prompt: string }> = [];
    const result = await analyzeLotLiftTurn({ state: newLotLiftCallState("contract"), turn: prospect("turn", "We use a CRM, but leads wait until morning."), conversation: [rep("rep", "How are online inquiries handled today?"), prospect("turn", "We use a CRM, but leads wait until morning.")], model: async (request) => { requests.push(request); return output("That wait sounds frustrating. How are those inquiries covered after hours?"); }, resolvedProfile: profile });
    expect(result).toMatchObject({ source: "model", move_id: "terra-composition" });
    const prompt = requests[0]!.prompt;
    expect(prompt).toContain("recent_verbatim_dialogue");
    expect(prompt).toContain("conversation_policy");
    expect(prompt).toContain("approved_product_facts");
    expect(prompt).toContain("next_unresolved_workflow_detail");
    expect(prompt).toContain("terra-composition");
    expect(prompt).toContain("Gatekeeper");
  });

  it("never lets fallback display mutate a neutral call state", async () => {
    const initial = newLotLiftCallState("fallback-state");
    const neutral = prospect("neutral", "Can you tell me more?");
    const fallbackCases = [
      analyzeLotLiftTurn({ state: initial, turn: neutral, conversation: [neutral], model: async () => output("LotLift guarantees ROI. What is your budget?", "terra-composition"), resolvedProfile: profile }),
      analyzeLotLiftTurn({ state: initial, turn: neutral, conversation: [neutral], model: async () => { throw new Error("offline"); }, resolvedProfile: profile }),
      analyzeLotLiftTurn({ state: initial, turn: neutral, conversation: [neutral], model: async () => new Promise<LotLiftTurnModelOutput>(() => {}), timeoutMs: 1, resolvedProfile: profile }),
    ];
    const results = await Promise.all(fallbackCases);
    expect(results.map((result) => result.fallback_reason)).toEqual(["invalid-output", "model-error", "timeout"]);
    for (const result of results) {
      expect(result.state_events).toEqual([]);
      expect(result.state_events.reduce(reduceLotLiftCallState, initial)).toEqual(initial);
    }
  });

  it("uses exact hard rules without calling Terra", async () => {
    const model = vi.fn(async () => output("Unused response. How are leads handled?"));
    const result = await analyzeLotLiftTurn({ state: newLotLiftCallState("identity"), turn: prospect("turn", "Who's this?"), conversation: [prospect("turn", "Who's this?")], model, resolvedProfile: profile });
    expect(result).toMatchObject({ source: "hard-rule", move_id: "O2" });
    expect(model).not.toHaveBeenCalled();
  });

  it("falls back locally for rejected model output without model state events", async () => {
    const result = await run(async () => output("LotLift guarantees ROI. What is your budget?"));
    expect(result).toMatchObject({ source: "fallback", move_id: "terra-composition", fallback_reason: "invalid-output" });
    expect(result.state_events).toHaveLength(1);
  });

  it("falls back once for a model failure", async () => {
    const result = await run(async () => { throw new Error("offline"); });
    expect(result).toMatchObject({ source: "fallback", move_id: "terra-composition", fallback_reason: "model-error" });
    expect(result.state_events).toHaveLength(1);
  });

  it("contains a synchronous injected model failure in the same fallback", async () => {
    const turn = prospect("sync", "Can you tell me more?");
    const model = (() => { throw new Error("sync failure"); }) as unknown as LotLiftTurnModel;
    await expect(analyzeLotLiftTurn({ state: newLotLiftCallState("sync"), turn, conversation: [turn], model, resolvedProfile: profile })).resolves.toMatchObject({ source: "fallback", move_id: "terra-composition", fallback_reason: "model-error", state_events: [] });
  });

  it("cancels stale work without publishing a model response", async () => {
    const controller = new AbortController();
    const pending = run(() => new Promise((resolve) => setTimeout(() => resolve(output("That makes sense. How are leads covered after hours?")), 20)), newLotLiftCallState("cancel"), [prospect("turn", "Tell me more.")], controller.signal);
    controller.abort();
    await expect(pending).resolves.toMatchObject({ source: "fallback", fallback_reason: "cancelled", state_events: [] });
  });

  it("closes on DNC and second refusal deterministically", async () => {
    const dnc = await analyzeLotLiftTurn({ state: newLotLiftCallState("dnc"), turn: prospect("turn", "Do not call me again."), conversation: [prospect("turn", "Do not call me again.")], model: async () => output("Unused response. How are leads handled?"), resolvedProfile: profile });
    expect(dnc).toMatchObject({ source: "hard-rule", event_type: "do_not_contact" });
    const state = reduceLotLiftCallState(newLotLiftCallState("no"), { type: "coaching-progress", move_id: "terra-composition", substantive_refusal: true } as CallStateEvent);
    const refusal = await analyzeLotLiftTurn({ state, turn: prospect("turn", "No thanks."), conversation: [prospect("turn", "No thanks.")], model: async () => output("Unused response. How are leads handled?"), resolvedProfile: profile });
    expect(refusal).toMatchObject({ source: "hard-rule", move_id: "second-no-close" });
  });
});
