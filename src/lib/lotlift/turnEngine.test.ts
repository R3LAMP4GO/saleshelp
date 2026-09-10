import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "../types";
import { newLotLiftCallState } from "./callState";
import { selectLotLiftColdCallCard } from "./turnEngine";

const turn = (text: string): TranscriptSegment => ({ id: text, source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 1, text });

function callState() {
  const state = newLotLiftCallState("call");
  state.contact_name = { value: "Maya", status: "verified", evidence: { segment_id: "contact", text: "Maya" } };
  state.dealership = { value: "Northside Motors", status: "verified", evidence: { segment_id: "dealer", text: "Northside Motors" } };
  return state;
}

describe("LotLift cold-call turn engine", () => {
  it("renders the approved opening for a greeting with only verified context", () => {
    const result = selectLotLiftColdCallCard(turn("Hello"), callState(), [], "Isaiah");
    expect(result).toMatchObject({ intent: "greeting", card: { id: "O1" } });
    expect(result?.response).toContain("Hey Maya—it’s Isaiah, founder of LotLift.");
    expect(result?.response).toContain("Northside Motors");
  });

  it("answers identity without exposing an ownership question", () => {
    const result = selectLotLiftColdCallCard(turn("Who is this?"), callState(), [], "Isaiah");
    expect(result?.response).toBe("“It’s Isaiah, founder of LotLift.”");
  });

  it("uses approved problem framing for a purpose question, not gatekeeper copy", () => {
    const result = selectLotLiftColdCallCard(turn("What's this about?"), callState(), [], "Isaiah");
    expect(result?.card.id).toBe("O3");
    expect(result?.response).toContain("The pattern I’m trying to understand");
  });

  it("uses the context-free permission card when configured profile facts are unavailable", () => {
    const state = newLotLiftCallState("call");
    expect(selectLotLiftColdCallCard(turn("Hello"), state, [], "Isaiah")?.card.id).toBe("O0");
    expect(selectLotLiftColdCallCard(turn("Who is this?"), state, [], null)?.card.id).toBe("O0");
  });

  it("continues with approved purpose framing after permission or a help question", () => {
    const state = callState();
    expect(selectLotLiftColdCallCard(turn("Sure, go ahead"), state, [], "Isaiah")?.card.id).toBe("O3");
    expect(selectLotLiftColdCallCard(turn("How can I help?"), state, [], "Isaiah")?.card.id).toBe("O3");
    expect(selectLotLiftColdCallCard(turn("What’s this about?"), newLotLiftCallState("empty"), [], null)?.card.id).toBe("O0");
  });
});
