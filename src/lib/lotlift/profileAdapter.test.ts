import { expect, it } from "vitest";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../../../sales-profiles/lotlift/profile";
import { resolveSalesProfile } from "../sales/profiles";
import { newLotLiftCallState, reduceLotLiftCallState } from "./callState";
import { lotLiftMoveCandidates } from "./nextMove";
import { applyResolvedLotLiftMove } from "./profileAdapter";

it("uses the editable profile script for every price route", () => {
  const profile = resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE);
  const turn = { id: "price", text: "This sounds expensive.", source: "them" as const, speaker: 0, isFinal: true, startMs: 0, endMs: 1 };
  const priceMove = lotLiftMoveCandidates({ state: newLotLiftCallState("price"), turn, conversation: [turn], resolvedProfile: profile }).find((move) => move.id === "price-isolation");
  expect(priceMove).toBeDefined();
  for (const id of ["price-isolation", "price-pain-value", "price-stakeholder-criteria"] as const) expect(profile.behavior.moves.find((move) => move.id === id)?.script).toBeTruthy();
  const configured = profile.behavior.moves.find((move) => move.id === "price-isolation");
  expect(configured?.script).toBe("Yeah, I get it. Is it that there's no budget for anything new right now, or you haven't seen enough value yet to justify it?");
  const applied = applyResolvedLotLiftMove(priceMove!, profile, {});
  expect(applied.response).toBe(configured?.script);
  expect(applied.fallback_response).toBe(applied.response);
});

it("uses the profile-owned contextual fallback without unresolved template variables", () => {
  const profile = resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE);
  const neutral = { id: "neutral", text: "Can this integrate with our CRM?", source: "them" as const, speaker: 0, isFinal: true, startMs: 0, endMs: 1 };
  let state = newLotLiftCallState("generic");
  state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: { value: "I handle paid inquiries.", status: "verified", evidence: { segment_id: "owner", text: "I handle paid inquiries." } } });
  const genericMove = lotLiftMoveCandidates({ state, turn: neutral, conversation: [neutral], resolvedProfile: profile })[0]!;

  const applied = applyResolvedLotLiftMove(genericMove, profile, {});
  expect(genericMove.id).toBe("contextual-response");
  expect(genericMove.response).toContain("integration details");
  expect(applied.response).toBe(genericMove.response);
  expect(applied.fallback_response).toBe(genericMove.response);
});
