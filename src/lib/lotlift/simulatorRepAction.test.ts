import { expect, it } from "vitest";
import { newLotLiftCallState, reduceLotLiftCallState } from "./callState";
import { simulatorExecutedRepAction } from "./simulatorRepAction";

const profile = { profileId: "lotlift-cold-outbound", snapshotVersion: "1-test" };
const o3 = { id: "O3", expectedAnswer: { kind: "confirmation" as const, targetField: "workflow_owner" } };

it("binds an explicit simulator I said this action to the actual REP segment", () => {
  const state = newLotLiftCallState("sim");
  const events = simulatorExecutedRepAction(state, profile, "sim-42", o3);
  const updated = events.reduce(reduceLotLiftCallState, state);
  expect(updated.pending_answer).toMatchObject({ rep_segment_id: "sim-42", profile_id: profile.profileId, move_id: "O3", kind: "confirmation", target_field: "workflow_owner" });
});

it("does not create a pending answer when a recommendation is only displayed", () => {
  const state = newLotLiftCallState("sim");
  expect(simulatorExecutedRepAction(state, profile, "sim-42")).toEqual([]);
  expect(state.pending_answer).toBeNull();
});
