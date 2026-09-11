import { expect, it } from "vitest";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../../../sales-profiles/lotlift/profile";
import { resolveSalesProfile } from "../sales/profiles";
import { newLotLiftCallState, reduceLotLiftCallState } from "./callState";
import { lotLiftMoveCandidates } from "./nextMove";
import { buildLotLiftTurnDirective, moveHasGuidedTurnStrategy } from "./turnDirective";
import type { TranscriptSegment } from "../types";

function turn(id: string, text: string): TranscriptSegment { return { id, text, source: "them", speaker: 1, isFinal: true, startMs: 0, endMs: 100 }; }
const profile = resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE);

it("builds the CRM directive directly from the editable profile strategy", () => {
  const crm = turn("crm", "We use VinSolutions.");
  const gap = turn("gap", "Late inquiries sometimes sit until morning.");
  let state = newLotLiftCallState("crm-directive");
  state = reduceLotLiftCallState(state, { type: "capture", field: "current_solution", fact: { value: "VinSolutions", status: "verified", evidence: { segment_id: crm.id, text: crm.text } } });
  state = reduceLotLiftCallState(state, { type: "capture", field: "after_hours_process", fact: { value: gap.text, status: "verified", evidence: { segment_id: gap.id, text: gap.text } } });
  const objection = turn("objection", "We already have a CRM though.");
  const candidate = lotLiftMoveCandidates({ state, turn: objection, conversation: [crm, gap, objection], resolvedProfile: profile })[0]!;
  expect(candidate.id).toBe("existing-workflow-coverage");
  expect(moveHasGuidedTurnStrategy(profile, candidate.id)).toBe(true);
  const directive = buildLotLiftTurnDirective({ state, turn: objection, candidate, resolvedProfile: profile });
  expect(directive.approach).toContain("Respect the existing system.");
  expect(directive.avoid).toContain("Do not criticize the CRM or claim replacement.");
  expect(directive.relevant_call_evidence.map((item) => item.segment_id)).toContain("gap");
  expect(directive.methodology_framework_id).toBeUndefined();
});

it("uses one framework only when the generic move has no profile strategy", () => {
  const owner = turn("owner", "I own the internet-lead workflow.");
  let state = newLotLiftCallState("novel-directive");
  state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: { value: owner.text, status: "verified", evidence: { segment_id: owner.id, text: owner.text } } });
  const objection = turn("objection", "I am concerned my sales guys are going to think I am spying on them.");
  const candidate = lotLiftMoveCandidates({ state, turn: objection, conversation: [owner, objection], resolvedProfile: profile })[0]!;
  expect(candidate.id).toBe("guided-objection-discovery");
  expect(moveHasGuidedTurnStrategy(profile, candidate.id)).toBe(false);
  const directive = buildLotLiftTurnDirective({ state, turn: objection, candidate, resolvedProfile: profile, framework: { id: "disarm-and-diagnose" } });
  expect(directive.methodology_framework_id).toBe("disarm-and-diagnose");
  expect(directive.approach).toContain("Distinguish trust or perception from workflow burden with one diagnostic question.");
  expect(directive.max_questions).toBe(1);
});
