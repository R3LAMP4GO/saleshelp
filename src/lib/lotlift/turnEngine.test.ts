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
    expect(result?.response).toContain("Hi Maya, it’s Isaiah from LotLift.");
    expect(result?.response).toContain("30 seconds");
  });

  it.each(["Who is this?", "who is this", "Who's this?", "Who’s this?", "WHO'S THIS?", "Who are you?", "  Who’s   this?  "])("routes identity punctuation variants to O2: %s", (text) => {
    const result = selectLotLiftColdCallCard(turn(text), callState(), [], "Isaiah");
    expect(result).toMatchObject({ intent: "identity", card: { id: "O2" } });
    expect(result?.response).toBe("“It’s Isaiah, founder of LotLift.”");
  });

  it.each(["What's this regarding?", "What’s this regarding?", "What is this regarding?", "What's this about?", "What’s this about?", "Why are you calling?"])("routes clear purpose variants to O3: %s", (text) => {
    const result = selectLotLiftColdCallCard(turn(text), callState(), [], "Isaiah");
    expect(result).toMatchObject({ intent: "purpose", card: { id: "O3" } });
    expect(result?.response).toContain("who handles your online leads");
  });

  it("never reopens O3 once the workflow owner is verified", () => {
    const state = callState();
    state.workflow_owner = { value: "That would be me.", status: "verified", evidence: { segment_id: "owner", text: "That would be me." } };
    expect(selectLotLiftColdCallCard(turn("Why are you calling?"), state, [], "Isaiah")).toBeNull();
    expect(selectLotLiftColdCallCard(turn("How can I help?"), state, [], "Isaiah")).toBeNull();
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
    expect(selectLotLiftColdCallCard(turn("What’s this about?"), newLotLiftCallState("empty"), [], null)?.card.id).toBe("O3");
  });
});
