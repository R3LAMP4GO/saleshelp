import { describe, expect, it } from "vitest";
import { newLotLiftCallState, reduceLotLiftCallState } from "./callState";
import { assimilatePendingAnswer, pendingAnswerFromExecutedMove } from "./pendingAnswer";
import { lotLiftMoveCandidates } from "./nextMove";

const repMove = { id: "O3", expectedAnswer: { kind: "confirmation" as const, targetField: "workflow_owner" } };
const prospect = (id: string, text: string) => ({ id, text, source: "them" as const, speaker: 0, isFinal: true, startMs: 0, endMs: 1 });
function pending(move: { id: string; expectedAnswer: { kind: "confirmation" | "free-text" | "entity"; targetField: string } } = repMove) {
  const state = newLotLiftCallState("pending");
  const action = pendingAnswerFromExecutedMove("lotlift-cold-outbound", "snapshot", "rep-1", move, state.revision);
  return reduceLotLiftCallState(state, { type: "pending-answer", pending: action });
}

describe("pending profile answers", () => {
  it("does not create a pending answer from a displayed recommendation", () => {
    expect(newLotLiftCallState("display-only").pending_answer).toBeNull();
  });

  it("captures a role-specific negative owner without marking the contact as owner", () => {
    const events = assimilatePendingAnswer(pending(), prospect("no", "No, our sales manager handles that."));
    const state = events.reduce(reduceLotLiftCallState, pending());
    expect(state.workflow_owner).toMatchObject({ value: "sales manager", status: "verified" });
    expect(state.pending_answer).toBeNull();
  });

  it("captures a natural owner confirmation and clears the pending question", () => {
    const events = assimilatePendingAnswer(pending(), prospect("owner", "Oh, that would be me."));
    const state = events.reduce(reduceLotLiftCallState, pending());
    expect(state.workflow_owner).toMatchObject({ value: "Oh, that would be me.", status: "verified" });
    expect(state.pending_answer).toBeNull();
    expect(lotLiftMoveCandidates({ state, turn: prospect("owner", "Oh, that would be me."), conversation: [] })[0]?.id).toBe("lead-source");
  });

  it("captures free-text after-hours evidence only for an executed question", () => {
    const answer = "Sometimes the ones that come in late sit until the next morning.";
    const afterHours = { id: "gap-after-hours", expectedAnswer: { kind: "free-text" as const, targetField: "after_hours_process" } };
    const events = assimilatePendingAnswer(pending(afterHours), prospect("late", answer));
    const state = events.reduce(reduceLotLiftCallState, pending(afterHours));
    expect(state.after_hours_process).toMatchObject({ value: answer, status: "verified", evidence: { segment_id: "late", text: answer } });
    expect(assimilatePendingAnswer(newLotLiftCallState("unrelated"), prospect("late", answer))).toEqual([]);
  });

  it("leaves ambiguous or unrelated prospect speech pending", () => {
    const state = pending();
    expect(assimilatePendingAnswer(state, prospect("interrupt", "Can you send me an email?"))).toEqual([]);
    expect(state.pending_answer?.move_id).toBe("O3");
  });
});
