import type { TranscriptSegment } from "../types";
import type { CallStateEvent, LotLiftCallState, LotLiftPendingAnswer } from "./callState";
import type { ResolvedSalesProfile } from "../sales/profiles";
import { normalizeForIntent } from "./intentNormalization";

const affirmative = /^(?:oh,? )?(?:yes|yeah|yep|yeah,? (?:this|that)(?:'s| is| would be) me|that(?:'s| is| would be) me|i do|i handle (?:them|those)|yeah,? i handle (?:them|those)|that's my department)[.!]*$/;
const negative = /^(?:no|no,? .+|our .+ (?:handles|does)|that's (?:the|our) .+(?:manager|bdc))[.!]*$/;

export function pendingAnswerFromExecutedMove(profileId: string, profileSnapshotVersion: string, repSegmentId: string, move: { id: string; expectedAnswer?: { kind: "confirmation" | "free-text" | "entity"; targetField: string } }, revision: number): LotLiftPendingAnswer | null {
  const expected = move.expectedAnswer;
  if (!expected || !["workflow_owner", "after_hours_process", "current_solution", "authority"].includes(expected.targetField)) return null;
  return { rep_segment_id: repSegmentId, profile_id: profileId, profile_snapshot_version: profileSnapshotVersion, move_id: move.id, kind: expected.kind, target_field: expected.targetField as LotLiftPendingAnswer["target_field"], created_revision: revision };
}

/** Records only a finalized rep question that strongly matches one declared profile answer semantic. */
export function pendingAnswerFromActualRepSpeech(profile: ResolvedSalesProfile, state: LotLiftCallState, segment: TranscriptSegment): LotLiftPendingAnswer | null {
  if (segment.source !== "me" || !segment.isFinal) return null;
  const text = normalizeForIntent(segment.text);
  const move = profile.behavior.moves.find((candidate) => {
    const target = candidate.expectedAnswer?.targetField;
    if (!target) return false;
    if (target === "workflow_owner") return /\b(?:who handles|who owns|who is responsible for)\b[\s\S]{0,100}\b(?:online\s+(?:leads?|inquir(?:y|ies))|paid\s+online)\b/.test(text);
    if (target === "after_hours_process") return /\b(?:after hours|late inquiries?|overnight)\b/.test(text) && /\b(?:what happens|how (?:is|are)|who)\b/.test(text);
    if (target === "current_solution") return /\b(?:what system|which crm|what crm|what do you use)\b/.test(text);
    if (target === "authority") return /\b(?:who decides|who approves|are you the person who decides)\b/.test(text);
    return false;
  });
  return move ? pendingAnswerFromExecutedMove(profile.profileId, profile.snapshotVersion, segment.id, move, state.revision) : null;
}

/** Narrow, matching-only answer assimilation; original prospect text is retained as evidence. */
export function assimilatePendingAnswer(state: LotLiftCallState, turn: TranscriptSegment): CallStateEvent[] {
  const pending = state.pending_answer;
  if (!pending || turn.source !== "them" || !turn.isFinal) return [];
  const evidence = { segment_id: turn.id, text: turn.text };
  const normalized = normalizeForIntent(turn.text);
  if (pending.kind === "confirmation") {
    if (affirmative.test(normalized)) return [{ type: "capture", field: pending.target_field, fact: { value: turn.text, status: "verified", evidence } }, { type: "pending-answer", pending: null }];
    if (negative.test(normalized)) {
      const role = turn.text.match(/\b(?:sales manager|internet manager|bdc manager|bdc)\b/i)?.[0];
      const events: CallStateEvent[] = [{ type: "pending-answer", pending: null }];
      if (role) events.unshift({ type: "capture", field: "workflow_owner", fact: { value: role, status: "verified", evidence } });
      return events;
    }
    return [];
  }
  if (pending.kind === "free-text" && normalized.length >= 8 && !/^(?:no|not interested|stop calling)[.!]*$/.test(normalized)) return [{ type: "capture", field: pending.target_field, fact: { value: turn.text, status: "verified", evidence } }, { type: "pending-answer", pending: null }];
  return [];
}
