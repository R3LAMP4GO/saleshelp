import { expect, it } from "vitest";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../../../sales-profiles/lotlift/profile";
import { newLotLiftCallState } from "./callState";
import { lotLiftMoveCandidates } from "./nextMove";
import {
  LOTLIFT_RESPONSE_COMPOSER_SYSTEM,
  buildLotLiftResponseCompositionContext,
  compositionPrompt,
  observationExtractionPrompt,
  validateLotLiftObservationExtraction,
  validateLotLiftResponseComposition,
} from "./responseComposer";
import { resolveSalesProfile } from "../sales/profiles";
import type { RelevantMethodologyContext } from "../sales/methodologyRetrieval";
import type { TranscriptSegment } from "../types";

const turn: TranscriptSegment = { id: "prospect-1", text: "I worry the staff will see this as spying.", source: "them", speaker: 1, isFinal: true, startMs: 0, endMs: 100 };
const state = newLotLiftCallState("methodology-prompt");
const resolvedProfile = resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE);
const candidates = lotLiftMoveCandidates({ state, turn, conversation: [turn], resolvedProfile });
const methodology: RelevantMethodologyContext = {
  authority: ["Safety and product truth outrank methodology.", "The active profile outranks methodology.", "Methodology is not call evidence."],
  profileGuidance: "Learn the workflow without making claims.",
  frameworks: [{ id: "disarm-and-diagnose", title: "Disarm", summary: "Lower resistance.", guidance: "Ask one diagnostic question.", sourceRef: `cold-calling-sucks@${"d".repeat(64)}`, location: "p. 90" }],
  support: [{ sourceRef: `cold-calling-sucks@${"d".repeat(64)}`, chunkId: "cold-calling-sucks:3", location: "Page 3", text: "This book-only sentence must never become prospect evidence." }],
  sourceRefs: [`cold-calling-sucks@${"d".repeat(64)}`], sourceCount: 1, chunkCount: 1, retrievalMs: 1,
};

function context() {
  return buildLotLiftResponseCompositionContext({ state, turn, conversation: [turn], candidates, responsePolicy: "composable", resolvedProfile, methodology, turnDirectives: { [candidates[0]!.id]: { objective: "Understand the concern.", approach: ["Acknowledge the concern.", "Ask one diagnostic question."], avoid: ["Do not defend the product."], relevant_call_evidence: [{ segment_id: turn.id, text: turn.text }], desired_progression: "Clarify the concern before advancing.", max_questions: 1, methodology_framework_id: "disarm-and-diagnose" } } });
}

it("sends an imperative turn strategy instead of raw methodology", () => {
  const prompt = compositionPrompt(context());
  const payload = JSON.parse(prompt.match(/SALES_DECISION_CONTEXT=(.*)\nReturn JSON only\./)?.[1] ?? "{}");
  expect(payload.active_profile.objective).toBe(resolvedProfile.behavior.objective);
  expect(payload.turn_strategies[candidates[0]!.id].objective).toBe("Understand the concern.");
  expect(payload.turn_strategies[candidates[0]!.id].methodology_framework_id).toBe("disarm-and-diagnose");
  expect(prompt).not.toContain("This book-only sentence");
  expect(payload.citation_evidence).toEqual([{ id: "prospect-1", text: turn.text }]);
  expect(payload.citation_evidence).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "cold-calling-sucks:3" })]));
  expect(prompt).toMatch(/follow its TURN STRATEGY imperatively/i);
  expect(prompt).toMatch(/silently.*framework names/i);
});

it("never injects profile methodology into live system instructions", () => {
  expect(LOTLIFT_RESPONSE_COMPOSER_SYSTEM).not.toContain("# Sales Methodology");
  expect(LOTLIFT_RESPONSE_COMPOSER_SYSTEM).not.toContain("DISARM");
});

it("cannot use methodology as grounding or memory evidence", () => {
  const composition = validateLotLiftResponseComposition({ selected_move_id: candidates[0]!.id, grounding_segment_ids: ["cold-calling-sucks:3"], spoken_response: "That makes sense. What concerns you most?" }, context());
  expect(composition).toMatchObject({ result: null, rejection_code: "schema" });
  expect(observationExtractionPrompt(context())).not.toContain("book-only sentence");
  expect(validateLotLiftObservationExtraction({ observations: [{ field: "pain_points", value: "book-only sentence", evidence_segment_id: "cold-calling-sucks:3" }] }, context())).toBeNull();
});
