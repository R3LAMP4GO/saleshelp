import { LOTLIFT_METHODOLOGY_FRAMEWORKS } from "../../../sales-profiles/lotlift/methodology";
import { buildRelevantMethodologyContext, type RelevantMethodologyContext } from "../sales/methodologyRetrieval";
import type { KnowledgeSessionSnapshot } from "../sales/knowledgeStore";
import type { ResolvedSalesProfile } from "../sales/profiles";
import { deriveLotLiftConversationStage, type LotLiftCallState } from "./callState";
import type { LotLiftMoveCandidate } from "./nextMove";
import { retrieveApprovedLotLiftResponse } from "./objections";
import type { TranscriptSegment } from "../types";

export interface LotLiftMethodologyInput {
  state: LotLiftCallState;
  turn: TranscriptSegment;
  candidates: readonly LotLiftMoveCandidate[];
  resolvedProfile: ResolvedSalesProfile;
  knowledge: KnowledgeSessionSnapshot;
}

function objectionClass(text: string): string {
  const route = retrieveApprovedLotLiftResponse(text);
  if (route) return route.id;
  if (/\b(?:crm|vinsolutions|existing solution|already have|in house)\b/i.test(text)) return "crm";
  if (/\b(?:price|pricing|cost|expensive|budget)\b/i.test(text)) return "price";
  if (/\b(?:busy|bandwidth|resources?)\b/i.test(text)) return "busy";
  if (/\bnot interested\b/i.test(text)) return "not-interested";
  return "unknown";
}

function stateTags(state: LotLiftCallState): string[] {
  const tags: string[] = [];
  if (state.current_solution.value) tags.push("crm", "existing-solution");
  if (state.after_hours_process.value) tags.push("after-hours");
  if (state.pain_points.some((fact) => fact.value) || state.after_hours_process.value || state.visibility_process.value) tags.push("pain-verified");
  if (state.pending_answer) tags.push("pending-answer");
  return tags;
}

export function buildLotLiftMethodologyContext(input: LotLiftMethodologyInput): RelevantMethodologyContext {
  const candidateGuidance = input.candidates.slice(0, 4).map((candidate) => `${candidate.id}: ${candidate.approved_strategy} Avoid: ${candidate.prohibited_behavior}`).join("\n");
  return buildRelevantMethodologyContext({
    profileGuidance: `${input.resolvedProfile.behavior.objective}\n${candidateGuidance}`,
    attachments: input.resolvedProfile.knowledgeAttachments,
    indexes: input.knowledge.indexes,
    frameworks: LOTLIFT_METHODOLOGY_FRAMEWORKS,
    stage: deriveLotLiftConversationStage(input.state),
    candidateIds: input.candidates.map((candidate) => candidate.id),
    objectionClass: objectionClass(input.turn.text),
    stateTags: stateTags(input.state),
    currentWording: input.turn.text,
  });
}
