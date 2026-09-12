import { describe, expect, it } from "vitest";
import { newLotLiftCallState, reduceLotLiftCallState } from "./callState";
import { deriveLotLiftCurrentTurnState, lotLiftMoveCandidates, selectLotLiftNextMove } from "./nextMove";
import type { TranscriptSegment } from "../types";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../../../sales-profiles/lotlift/profile";
import { resolveSalesProfile } from "../sales/profiles";

const turn = (text: string, id = "turn"): TranscriptSegment => ({ id, text, source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100 });
const verified = (value: string, id = "evidence") => ({ value, status: "verified" as const, evidence: { segment_id: id, text: value } });
const select = (state: ReturnType<typeof newLotLiftCallState>, text: string) => selectLotLiftNextMove({ state, turn: turn(text), conversation: [turn(text)], resolvedProfile: resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE) });

describe("Terra-first LotLift move selection", () => {
  it("sends ordinary speech to one Terra composition objective", () => {
    const move = select(newLotLiftCallState("normal"), "Can you explain what you mean?");
    expect(move).toMatchObject({ id: "terra-composition", response_mode: "compose", source: "approved-move" });
    expect(move.state_events).toEqual([]);
  });

  it("captures ownership once and keeps Terra from repeating it", () => {
    const prospect = turn("That's me.", "owner");
    const current = deriveLotLiftCurrentTurnState(newLotLiftCallState("owner"), prospect);
    const move = lotLiftMoveCandidates({ state: newLotLiftCallState("owner"), turn: prospect, conversation: [prospect], currentTurnState: current })[0]!;
    expect(current.state.workflow_owner).toMatchObject({ status: "verified" });
    expect(move).toMatchObject({ id: "terra-composition", stage: "relevance-discovery", discovery_dimension: "after-hours" });
    expect(move.response).not.toMatch(/who (?:owns|handles)/i);
  });

  it("keeps owner and purpose cards from preempting Terra after RIGHT_PERSON", () => {
    const prospect = turn("Yeah, that's me. What do you want?", "right-person");
    const current = deriveLotLiftCurrentTurnState(newLotLiftCallState("right-person"), prospect);
    const move = lotLiftMoveCandidates({ state: newLotLiftCallState("right-person"), turn: prospect, conversation: [prospect], currentTurnState: current })[0]!;
    expect(current.state.phase).toBe("RIGHT_PERSON");
    expect(move).toMatchObject({ id: "terra-composition", goal: "Continue with current-process discovery after responsibility is confirmed." });

    const later = lotLiftMoveCandidates({ state: current.state, turn: turn("Who are you and why are you calling?", "later"), conversation: [prospect, turn("Who are you and why are you calling?", "later")] })[0]!;
    expect(later.id).toBe("terra-composition");
  });

  it("treats existing-solution language after a first refusal as a Terra objection", () => {
    const first = turn("We're not interested.", "refusal");
    const initial = newLotLiftCallState("existing-solution");
    const afterFirst = deriveLotLiftCurrentTurnState(initial, first).events.reduce(reduceLotLiftCallState, initial);
    const second = turn("We've used VinSolutions for 10 years.", "crm");
    expect(lotLiftMoveCandidates({ state: afterFirst, turn: second, conversation: [first, second] })[0]).toMatchObject({ id: "terra-composition", source: "approved-move" });
  });

  it("retains exact identity, product, meeting, and exit hard rules", () => {
    expect(select(newLotLiftCallState("identity"), "Who's this?").id).toBe("O2");
    let state = reduceLotLiftCallState(newLotLiftCallState("product"), { type: "capture", field: "workflow_owner", fact: verified("I own it") });
    expect(select(state, "What exactly does LotLift do?")).toMatchObject({ id: "v7-product-answer", response_mode: "verbatim" });
    state = reduceLotLiftCallState(state, { type: "append", field: "pain_points", fact: verified("Leads wait until morning") });
    state = select(state, "Okay.").state_events.reduce(reduceLotLiftCallState, state);
    expect(select(state, "Tuesday works.").id).toBe("terminal-close");
    const refusalState = reduceLotLiftCallState(newLotLiftCallState("refusal"), { type: "coaching-progress", move_id: "terra-composition", substantive_refusal: true });
    expect(select(refusalState, "No thanks.").id).toBe("second-no-close");
  });

  it("keeps DNC, abuse, and unsupported mandatory fit deterministic", () => {
    const state = newLotLiftCallState("stops");
    expect(select(state, "Put me on your do not call list.").id).toBe("terminal-close");
    expect(select(state, "Fuck off.").id).toBe("abuse-close");
    expect(select(state, "We need a direct CRM integration.").id).toBe("hard-integration-close");
  });

  it("reduces response-speed, appointment, and follow-up facts without normal-route keyword selection", () => {
    const current = deriveLotLiftCurrentTurnState(newLotLiftCallState("workflow"), turn("We reply within five minutes, book appointments, and follow up for three days."));
    expect(current.state.response_speed.status).toBe("verified");
    expect(current.state.appointment_capability.status).toBe("verified");
    expect(current.state.follow_up_process.status).toBe("verified");
    expect(lotLiftMoveCandidates({ state: newLotLiftCallState("workflow"), turn: turn("We reply within five minutes, book appointments, and follow up for three days."), conversation: [turn("We reply within five minutes, book appointments, and follow up for three days.")], currentTurnState: current })[0]?.id).toBe("terra-composition");
  });
});
