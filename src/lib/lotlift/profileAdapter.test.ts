import { expect, it } from "vitest";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../../../sales-profiles/lotlift/profile";
import { resolveSalesProfile } from "../sales/profiles";
import { newLotLiftCallState, reduceLotLiftCallState } from "./callState";
import { lotLiftMoveCandidates } from "./nextMove";
import { applyResolvedLotLiftMove } from "./profileAdapter";

it("uses the editable Terra composition strategy for normal concerns", () => {
  const profile = resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE);
  const turn = { id: "price", text: "This sounds expensive.", source: "them" as const, speaker: 0, isFinal: true, startMs: 0, endMs: 1 };
  const move = lotLiftMoveCandidates({ state: newLotLiftCallState("price"), turn, conversation: [turn], resolvedProfile: profile })[0]!;
  const configured = profile.behavior.moves.find((candidate) => candidate.id === "terra-composition");
  expect(move).toMatchObject({ id: "terra-composition", response_mode: "compose" });
  expect(configured?.turnStrategy?.objective).toContain("Disarm");
  expect(applyResolvedLotLiftMove(move, profile, {}).fallback_response).toBe(move.response);
});

it("uses a state-aware profile-owned fallback without template variables", () => {
  const profile = resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE);
  const neutral = { id: "neutral", text: "Can this integrate with our CRM?", source: "them" as const, speaker: 0, isFinal: true, startMs: 0, endMs: 1 };
  let state = newLotLiftCallState("generic");
  state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: { value: "I handle paid inquiries.", status: "verified", evidence: { segment_id: "owner", text: "I handle paid inquiries." } } });
  const move = lotLiftMoveCandidates({ state, turn: neutral, conversation: [neutral], resolvedProfile: profile })[0]!;
  expect(move).toMatchObject({ id: "terra-composition" });
  expect(move.response).not.toContain("[");
});
