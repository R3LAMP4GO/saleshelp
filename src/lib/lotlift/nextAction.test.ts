import { describe, expect, it } from "vitest";
import { newLotLiftCallState } from "./callState";
import { scheduleLotLiftNextAction } from "./nextAction";

const fact = (value: string) => ({ value, status: "verified" as const, evidence: { segment_id: "one", text: value } });

describe("deterministic next-action scheduling", () => {
  it("honors DNC permanently", () => { const state = newLotLiftCallState("dnc"); state.do_not_contact = true; expect(scheduleLotLiftNextAction(state)).toMatchObject({ type: "none", source: "dnc" }); });
  it("uses manual review for no answer and information requests", () => { const state = newLotLiftCallState("review"); expect(scheduleLotLiftNextAction(state).type).toBe("manual_review"); state.next_action = fact("Send me information"); expect(scheduleLotLiftNextAction(state)).toMatchObject({ type: "manual_review", source: "explicit_prospect" }); });
  it("does not schedule aggressive follow-up for not interested", () => { const state = newLotLiftCallState("no"); state.next_action = fact("Not interested"); expect(scheduleLotLiftNextAction(state).type).toBe("none"); });
  it("recognizes an explicit demo booking", () => { const state = newLotLiftCallState("demo"); state.next_action = fact("Demo booked"); expect(scheduleLotLiftNextAction(state)).toMatchObject({ type: "meeting", source: "explicit_prospect" }); });
});
