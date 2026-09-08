import type { TranscriptSegment } from "../types";
import type { CallStateEvent, LotLiftCallState, LotLiftFieldValue } from "./callState";

const READY_TO_PROCEED = /\bnothing is stopping (?:me|us) from moving forward\b/i;
const SPOUSE_OR_PARTNER = /\b(?:wife|husband|spouse|partner)\b/i;
const TALK_TO_STAKEHOLDER = /\b(?:need|have) to talk to (?:my )?(wife|husband|spouse|partner)\b/i;

function verified(value: string, segment: TranscriptSegment): LotLiftFieldValue<string> {
  return { value, status: "verified", evidence: { segment_id: segment.id, text: segment.text } };
}

/** Final prospect transcript is the only decision-context source. */
export function lotLiftDecisionContextEvent(segment: TranscriptSegment): CallStateEvent | null {
  if (segment.source !== "them" || !segment.isFinal) return null;
  const readiness = READY_TO_PROCEED.test(segment.text) ? verified("ready to proceed", segment) : undefined;
  const stakeholder = TALK_TO_STAKEHOLDER.exec(segment.text)?.[1]?.toLowerCase();
  const stakeholders = stakeholder ? [verified(stakeholder, segment)] : [];
  const blockers = stakeholder ? [verified("consult decision stakeholder", segment)] : [];
  return readiness || blockers.length || stakeholders.length
    ? { type: "decision-context", readiness, blockers, stakeholders }
    : null;
}

export function isLotLiftSpousePartnerObjection(segment: TranscriptSegment): boolean {
  return segment.source === "them" && segment.isFinal && SPOUSE_OR_PARTNER.test(segment.text);
}

/** A change requires durable verified readiness plus this explicit new blocker. */
export function lotLiftDecisionContextChange(
  state: LotLiftCallState | null,
  current: CallStateEvent | null,
): LotLiftFieldValue<string> | null {
  if (!state || state.stated_readiness.status !== "verified" || !state.stated_readiness.evidence) return null;
  if (current?.type !== "decision-context") return null;
  const currentStakeholder = current.stakeholders.find((fact) => fact.status === "verified" && fact.evidence);
  const currentBlocker = current.blockers.find((fact) => fact.status === "verified" && fact.evidence);
  return currentStakeholder && currentBlocker ? state.stated_readiness : null;
}