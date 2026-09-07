import { describe, expect, it } from "vitest";
import { newLotLiftCallState, reduceLotLiftCallState } from "./callState";

describe("LotLift Call State", () => {
  it("deduplicates facts and counts recurring objections with evidence", () => {
    const start = newLotLiftCallState("call_1");
    const withPain = reduceLotLiftCallState(start, { type: "pain", value: "  Three leads sat overnight " });
    const deduplicated = reduceLotLiftCallState(withPain, { type: "pain", value: "three leads sat overnight" });
    const once = reduceLotLiftCallState(deduplicated, { type: "objection", kind: "existing-solution", evidence: { segment_id: "s1", text: "We have a CRM." } });
    const twice = reduceLotLiftCallState(once, { type: "objection", kind: "existing-solution", evidence: { segment_id: "s2", text: "Our CRM already handles it." } });

    expect(twice.quantified_pain).toEqual(["Three leads sat overnight"]);
    expect(twice.recurring_objections).toEqual([{ kind: "existing-solution", count: 2, resolved: false, evidence: [
      { segment_id: "s1", text: "We have a CRM." },
      { segment_id: "s2", text: "Our CRM already handles it." },
    ] }]);
  });
});
