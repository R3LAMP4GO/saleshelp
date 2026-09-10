import { describe, expect, it } from "vitest";
import { newLotLiftCallState, reduceLotLiftCallState } from "./callState";
import { LOTLIFT_MOVE_TACTICS, LOTLIFT_POLICY_TACTICS, LOTLIFT_TACTIC_RULES, lotLiftPolicyContext, missingLotLiftTacticContext, validateLotLiftPolicyPack } from "./policyPack";
import type { TranscriptSegment } from "../types";

const turn = (text: string, id = "turn"): TranscriptSegment => ({ id, text, source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100 });
const verified = (value: string, id = "evidence") => ({ value, status: "verified" as const, evidence: { segment_id: id, text: value } });

describe("LotLift policy pack", () => {
  it("validates every declarative tactic, rule, move, claim, and fallback", () => {
    expect(() => validateLotLiftPolicyPack()).not.toThrow();
    expect(Object.keys(LOTLIFT_MOVE_TACTICS)).toHaveLength(16);
  });

  it("rejects unknown moves, rules, fallbacks, and claim classes", () => {
    expect(() => validateLotLiftPolicyPack({ moveTactics: { ...LOTLIFT_MOVE_TACTICS, unknown: "workflow-discovery" } })).toThrow(/unknown move/);
    expect(() => validateLotLiftPolicyPack({ tacticRules: { ...LOTLIFT_TACTIC_RULES, "workflow-discovery": ["unknown:rule"] } })).toThrow(/unknown rule/);
    expect(() => validateLotLiftPolicyPack({ tactics: { ...LOTLIFT_POLICY_TACTICS, "workflow-discovery": { ...LOTLIFT_POLICY_TACTICS["workflow-discovery"], fallback_tactic: "unknown" as never } } })).toThrow(/undefined fallback/);
    expect(() => validateLotLiftPolicyPack({ tactics: { ...LOTLIFT_POLICY_TACTICS, "workflow-discovery": { ...LOTLIFT_POLICY_TACTICS["workflow-discovery"], allowed_claim_classes: ["unknown" as never] } } })).toThrow(/unapproved claim/);
  });

  it("blocks a scoped next step until every verified evidence gate and consent exists", () => {
    let state = newLotLiftCallState("gates");
    expect(missingLotLiftTacticContext("scoped-next-step", lotLiftPolicyContext(state, turn("Yes")))).toEqual(expect.arrayContaining(["supported-source", "workflow-owner", "gap", "authority-path"]));
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("BDC manager") });
    state = reduceLotLiftCallState(state, { type: "append", field: "lead_sources", fact: verified("AutoTrader") });
    state = reduceLotLiftCallState(state, { type: "append", field: "pain_points", fact: verified("Online inquiries wait overnight") });
    state = reduceLotLiftCallState(state, { type: "capture", field: "authority", fact: verified("I make the decision") });
    expect(missingLotLiftTacticContext("scoped-next-step", lotLiftPolicyContext(state, turn("Yes, I am open to that.")))).toEqual([]);
  });
});
