import type { LotLiftCallState, LotLiftEvidence } from "./callState";

export type LotLiftNextActionType = "call" | "email" | "meeting" | "manual_review" | "none";
export type LotLiftNextActionSource = "explicit_prospect" | "policy" | "dnc" | "none";

export interface LotLiftNextAction {
  type: LotLiftNextActionType;
  /** Canonical timestamp only when the prospect supplied a verified ISO value. */
  at: string | null;
  reason: string;
  source: LotLiftNextActionSource;
  evidence: LotLiftEvidence | null;
}

const none = (reason: string, source: LotLiftNextActionSource = "none"): LotLiftNextAction => ({ type: "none", at: null, reason, source, evidence: null });

/**
 * Deterministic and deliberately conservative: no language model chooses a date,
 * and the selected manual-review policy never sends messages or places calls.
 */
export function scheduleLotLiftNextAction(state: LotLiftCallState): LotLiftNextAction {
  if (state.do_not_contact) return { ...none("Do-not-contact suppression", "dnc"), evidence: state.dnc_evidence };
  const action = state.next_action.value?.toLowerCase() ?? "";
  const outcome = state.fit_status.value?.toLowerCase() ?? "";
  if (/not interested|no thanks/.test(action) || /not interested|disqual/.test(outcome)) return none("Prospect is not interested");
  if (/demo|meeting|calendar/.test(action)) return { type: "meeting", at: null, reason: "Prospect booked a demo or meeting", source: "explicit_prospect", evidence: state.next_action.evidence };
  if (/call|callback|call back/.test(action) && state.next_action.status === "verified") return { type: "manual_review", at: null, reason: "Callback requested; confirm the stated date/time", source: "explicit_prospect", evidence: state.next_action.evidence };
  if (/send|information|details/.test(action)) return { type: "manual_review", at: null, reason: "Information requested; prepare an approved email", source: "explicit_prospect", evidence: state.next_action.evidence };
  return { type: "manual_review", at: null, reason: "No answer or no explicit next step", source: "policy", evidence: null };
}
