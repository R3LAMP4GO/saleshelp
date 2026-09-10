import type { TranscriptSegment } from "../types";
import {
  deriveLotLiftConversationStage,
  type CallStateEvent,
  type LotLiftCallState,
  type LotLiftConversationStage,
  type LotLiftDiscoveryDimension,
} from "./callState";
import { LOTLIFT_MOVE_RULES, LOTLIFT_POLICY_TACTICS, lotLiftPolicyContext, lotLiftTacticForMove, missingLotLiftTacticContext, type LotLiftClaimClass, type LotLiftPolicyTacticId } from "./policyPack";
import { lotLiftPlaybookRule, type LotLiftPlaybookRuleId } from "./playbook";
import { retrieveApprovedLotLiftResponse } from "./objections";
import { lotLiftIdentityResponse } from "./turnEngine";

export type LotLiftMoveSource = "approved-move" | "terminal-policy";

export interface LotLiftNextMove {
  id: string;
  title: string;
  goal: string;
  /** Deterministic wording shown before local inference completes. */
  response: string;
  fallback_response: string;
  stage: LotLiftConversationStage;
  source: LotLiftMoveSource;
  tactic_id: LotLiftPolicyTacticId;
  rule_ids: readonly LotLiftPlaybookRuleId[];
  allowed_claim_classes: readonly LotLiftClaimClass[];
  candidate_reason: string;
  approved_strategy: string;
  prohibited_behavior: string;
  discovery_dimension?: LotLiftDiscoveryDimension;
  state_events: CallStateEvent[];
}

/** Every candidate is policy-bounded and contains its own safe immediate fallback. */
export type LotLiftMoveCandidate = LotLiftNextMove;

const REFUSAL = /\b(?:not\s+(?:really\s+)?interested|no\s+thanks|not\s+a\s+priority|don'?t\s+(?:really\s+)?need\s+(?:it|this)|leave\s+(?:it|me|us)\s+alone)\b/i;
const ABUSE = /\b(?:fuck|fucking|shit|asshole|bitch|idiot|moron)\b/i;
const HARD_INTEGRATION = /\b(?:direct\s+)?(?:crm|dms)\s+integration\b.*\b(?:required|requirement|must\s+have|need)\b|\b(?:required|must\s+have|need)\b.*\b(?:direct\s+)?(?:crm|dms)\s+integration\b/i;
const UNSUPPORTED_FIT = /\b(?:we\s+(?:do\s+not|don't)\s+use\s+(?:cars\.com|cargurus|autotrader)|no\s+(?:online|marketplace)\s+inquiries|zero\s+(?:online|marketplace)\s+leads)\b/i;
const PAIN = /\b(?:(?:miss(?:ed|ing)?|los(?:e|ing))\s+(?:online\s+)?(?:leads?|inquir(?:y|ies))|recover(?:ing)?\b[^.?!]{0,80}\bleads?\b|leads?\s+(?:sit|wait|go\s+unworked)|not\s+(?:being\s+)?followed\s+up|fall(?:s|ing)\s+through\s+the\s+cracks)\b/i;
const AUTHORITY = /\b(?:i\s+(?:make|own|handle)\s+(?:that|the)\s+decision|my\s+decision|i['’]m\s+the\s+(?:owner|gm|general\s+manager|sales\s+manager|internet\s+manager|bdc\s+manager))\b/i;
const OWNER = /\b(?:i['’]m|i\s+am)\s+(?:the\s+)?(?:owner|gm|general\s+manager|sales\s+manager|internet\s+manager|bdc\s+manager)\b/i;
const PRICE_CONCERN = /\b(?:too expensive|sounds? expensive|too much money|no budget|can(?:not|'t) afford|costs? too much|(?:price|cost) (?:feels?|sounds?|is) (?:too )?high|how much(?: is it)?|what does (?:it|that) cost|pricing)\b/i;
const VALUE_UNCERTAINTY = /\b(?:value (?:is )?(?:not |isn['’]?t )?clear|whether (?:the )?value is clear|not sure (?:it['’]?s|it is|this is) worth)\b/i;

function boundedEvidence(turn: TranscriptSegment): string { return turn.text.trim().slice(0, 160); }
function progress(move_id: string, discovery_dimension?: LotLiftDiscoveryDimension, substantive_refusal = false): CallStateEvent {
  return { type: "coaching-progress", move_id, discovery_dimension, substantive_refusal };
}
function move(id: string, title: string, goal: string, response: string, stage: LotLiftConversationStage, source: LotLiftMoveSource, state_events: CallStateEvent[], discovery_dimension?: LotLiftDiscoveryDimension, candidate_reason = "deterministic policy route"): LotLiftNextMove {
  const tactic_id = lotLiftTacticForMove(id);
  const tactic = LOTLIFT_POLICY_TACTICS[tactic_id];
  const rule_ids = LOTLIFT_MOVE_RULES[id as keyof typeof LOTLIFT_MOVE_RULES];
  if (!rule_ids?.length) throw new Error(`LotLift move ${id} is missing policy rules.`);
  const primaryRule = lotLiftPlaybookRule(rule_ids[0]);
  return { id, title, goal, response, fallback_response: response, stage, source, tactic_id, rule_ids, allowed_claim_classes: tactic.allowed_claim_classes, candidate_reason, approved_strategy: primaryRule.approved_strategy, prohibited_behavior: primaryRule.prohibited_behavior, state_events, discovery_dimension };
}

/**
 * Produces deterministic, policy-bounded choices. The first candidate is the
 * immediate safe fallback; terminal policies deliberately produce exactly one.
 */
export type LotLiftMoveCandidateInput = {
  state: LotLiftCallState;
  turn: TranscriptSegment;
  conversation: readonly TranscriptSegment[];
  approvedRepIdentity?: string | null;
};

export function lotLiftMoveCandidates(input: LotLiftMoveCandidateInput): readonly LotLiftMoveCandidate[] {
  const { state, turn } = input;
  const text = turn.text.trim();
  const stage = deriveLotLiftConversationStage(state);
  const evidence = { segment_id: turn.id, text: boundedEvidence(turn) };
  const facts: CallStateEvent[] = [];
  if (OWNER.test(text)) facts.push({ type: "capture", field: "workflow_owner", fact: { value: text, status: "verified", evidence } });
  if (AUTHORITY.test(text)) facts.push({ type: "capture", field: "authority", fact: { value: text, status: "verified", evidence } });
  if (PAIN.test(text)) facts.push({ type: "append", field: "pain_points", fact: { value: text, status: "verified", evidence } });
  const one = (...args: Parameters<typeof move>) => [move(...args)];
  const hasFact = (items: readonly { value: string | null }[]) => items.some((fact) => Boolean(fact.value));
  const hasPain = hasFact(state.pain_points) || Boolean(state.after_hours_process.value) || Boolean(state.visibility_process.value);
  const hasStakeholder = hasFact(state.decision_stakeholders) || hasFact(state.stakeholders);
  const priceWasIsolated = input.conversation.some((segment) => segment.isFinal && segment.source === "me" && /monthly spend|setup effort|another option|feels worth|concern the spend/i.test(segment.text));

  if (stage === "terminal" || state.do_not_contact) return one("terminal-close", "Close the call", "Honor the prospect's terminal decision.", "Understood. I’ll leave it there. Thanks for your time.", "terminal", "terminal-policy", [progress("terminal-close")]);
  if (stage === "disqualified") return one("disqualified-close", "Not a fit", "Close without pursuing a meeting.", "Understood. I do not want to pretend this is the right fit. Thanks for your time.", "disqualified", "terminal-policy", [progress("disqualified-close")]);
  if (ABUSE.test(text)) return one("abuse-close", "End respectfully", "Do not pursue a meeting after abuse without explicit re-engagement.", "Understood. I’ll leave it there. Thanks for your time.", "terminal", "terminal-policy", [progress("abuse-close", undefined, true)]);
  if (HARD_INTEGRATION.test(text)) return one("hard-integration-close", "Not a fit", "A required direct CRM/DMS integration disqualifies this workflow.", "Understood. If direct CRM or DMS integration is required, I should not pretend this is the right fit. Thanks for your time.", "disqualified", "terminal-policy", [{ type: "capture", field: "disqualification_reason", fact: { value: "Required direct CRM/DMS integration", status: "verified", evidence } }, progress("hard-integration-close")]);
  if (UNSUPPORTED_FIT.test(text)) return one("unsupported-fit-close", "Not a fit", "Do not push a meeting for an unsupported lead workflow.", "That may mean LotLift is not worth adding. I’ll leave it there. Thanks for your time.", "disqualified", "terminal-policy", [{ type: "capture", field: "disqualification_reason", fact: { value: "Unsupported online inquiry workflow", status: "verified", evidence } }, progress("unsupported-fit-close")]);
  if (REFUSAL.test(text) && state.substantive_refusal_count >= 1) return one("second-no-close", "Close the call", "Respect the second substantive refusal.", "Understood. I’ll leave it there. Thanks for your time.", "terminal", "terminal-policy", [progress("second-no-close", undefined, true)]);
  if (REFUSAL.test(text)) {
    const rule = lotLiftPlaybookRule("objection:not-interested");
    return one("first-refusal", "Clarify the first refusal", "Ask one brief coverage question, then respect a second no.", rule.good_examples[0]!, stage, "approved-move", [...facts, progress("first-refusal", undefined, true)], undefined, "first substantive refusal receives the canonical one-question response");
  }

  const identityResponse = lotLiftIdentityResponse(turn, state, input.approvedRepIdentity);
  if (identityResponse) return one("O2", "Who is this?", "Identify the caller truthfully and wait for the prospect's next turn.", identityResponse, "owner-identification", "approved-move", [progress("O2")], undefined, "explicit identity question with configured representative identity");

  const routedObjection = retrieveApprovedLotLiftResponse(text, input.conversation.filter((segment) => segment.source === "them" && segment.id !== turn.id).map((segment) => segment.text));
  if (routedObjection && !["price", "price-with-spouse", "not-interested"].includes(routedObjection.id)) {
    const routeMoveId = ["busy", "call-later", "contract", "previous-caller"].includes(routedObjection.id) ? "timing-follow-up"
      : routedObjection.id === "send-information" ? "information-topic"
      : ["need-to-think", "spouse-partner", "staff-adoption", "build-it", "trial", "new-company"].includes(routedObjection.id) ? "decision-criteria"
      : ["existing-solution", "status-quo"].includes(routedObjection.id) ? "existing-workflow-coverage"
      : ["source-volume", "team-size"].includes(routedObjection.id) ? "fit-source-volume"
      : ["competitor", "comparison"].includes(routedObjection.id) ? "competitor-criteria"
      : ["direct-integration", "marketplace-coverage", "ai-automation", "data-security", "provider-authorization"].includes(routedObjection.id) ? "security-authorization"
      : "limitation-route";
    const rule = lotLiftPlaybookRule(routedObjection.rule_id);
    const candidate = move(routeMoveId, rule.intent, rule.objective, routedObjection.response, stage, "approved-move", [...facts, progress(routeMoveId)], undefined, `recognized ${routedObjection.rule_id} route`);
    return [{ ...candidate, rule_ids: [routedObjection.rule_id], approved_strategy: rule.approved_strategy, prohibited_behavior: rule.prohibited_behavior }];
  }

  if (PRICE_CONCERN.test(text)) {
    const candidates: LotLiftNextMove[] = [];
    candidates.push(priceWasIsolated
      ? move("price-next-criterion", "Clarify the remaining price criterion", "Advance beyond an already-asked price-versus-value question.", "That makes sense. What would need to be true for this to feel worth revisiting?", stage, "approved-move", [...facts, progress("price-next-criterion")], undefined, "price concern repeated after prior isolation")
      : move("price-isolation", "Isolate the price concern", "Learn whether the concern is affordability, setup, alternatives, or value before discussing price.", "I hear you. Is the concern the monthly spend itself, the setup effort, another option, or whether closing the gap feels worth it?", stage, "approved-move", [...facts, progress("price-isolation")], undefined, "explicit price concern without a prior isolation question"));
    if (hasPain) candidates.push(move("price-pain-value", "Connect price to stated workflow pain", "Use a verified coverage concern to clarify whether the spend feels worth solving.", "I hear you. Is the concern the spend itself, or whether fixing the coverage gap feels worth it?", stage, "approved-move", [...facts, progress("price-pain-value")], undefined, "price concern with earlier workflow pain"));
    if (hasStakeholder) candidates.push(move("price-stakeholder-criteria", "Clarify stakeholder criteria", "Learn the decision criterion without pressuring the stakeholder.", "That makes sense. What would the other decision-maker need to feel clear on before this is worth considering?", stage, "approved-move", [...facts, progress("price-stakeholder-criteria")], undefined, "price concern with a known decision stakeholder"));
    return candidates;
  }

  if (VALUE_UNCERTAINTY.test(text) && (state.selected_objection_route.value === "price-value" || state.decision_blockers.some((fact) => fact.value === "price/value uncertainty"))) {
    if (stage === "meeting-invitation" && !missingLotLiftTacticContext("scoped-next-step", lotLiftPolicyContext(state, turn)).length) return one("price-value-workflow-check", "Offer a value workflow check", "Offer the approved workflow check only after verified context.", "That makes sense—being clear on value matters before deciding. Would you be open to a short 15-minute workflow check?", "meeting-invitation", "approved-move", [...facts, progress("price-value-workflow-check")]);
    return one("price-value-uncertainty", "Clarify value uncertainty", "Clarify unresolved value without promising results.", "That makes sense—what would you need to understand about the workflow to feel clear on that?", stage, "approved-move", [...facts, progress("price-value-uncertainty")]);
  }

  if (/\b(?:we already have|we use|using)\b[^.?!]{0,50}\b(?:crm|vinsolutions|bdc|internet department)\b/i.test(text)) {
    const candidates = [move("crm-coverage", "Verify existing workflow coverage", "Respect the existing system and test the known handoff or after-hours workflow.", "That makes sense. When an inquiry comes in after hours, does it still get picked up right away in that workflow?", stage, "approved-move", [...facts, progress("crm-coverage")], undefined, "existing CRM or workflow mentioned")];
    if (hasPain) candidates.push(move("impact-coverage", "Clarify the known coverage gap", "Discuss the stated handoff concern without disparaging the CRM.", "Got it. What happens when that workflow cannot cover an inquiry right away?", stage, "approved-move", [...facts, progress("impact-coverage", "ownership")], "ownership", "existing CRM plus earlier coverage concern"));
    return candidates;
  }

  if (PAIN.test(text) && stage !== "meeting-invitation") return one("impact-coverage", "Lead recovery coverage", "Confirm how the stated impact is covered before offering a workflow check.", "It sounds like delayed online inquiries are creating a real impact. When one comes in, who owns it right away, especially after hours?", stage, "approved-move", [...facts, progress("impact-coverage", "ownership")], "ownership");
  if (stage === "owner-identification") return one("identify-owner", "Identify the workflow owner", "Find the person responsible for paid online inquiry coverage.", "Who owns paid online inquiry response there: the internet manager, BDC manager, sales manager, or someone else?", stage, "approved-move", [...facts, progress("identify-owner", "ownership")], "ownership");
  if (stage === "relevance-discovery") return one("lead-source", "Confirm lead sources", "Establish whether paid online inquiries are relevant.", "Which online sources generate most buyer inquiries for you today?", stage, "approved-move", [...facts, progress("lead-source", "lead-source")], "lead-source");
  if (stage === "gap-confirmation") {
    const dimension: LotLiftDiscoveryDimension = state.last_discovery_dimension === "after-hours" ? "visibility" : "after-hours";
    const response = dimension === "after-hours" ? "How is coverage handled when an online inquiry arrives after hours or the usual person is off?" : "How does the team verify that an online inquiry was owned and worked, rather than sitting in an inbox?";
    return one(`gap-${dimension}`, "Confirm the workflow gap", "Learn whether ownership or visibility leaves inquiries unworked.", response, stage, "approved-move", [...facts, progress(`gap-${dimension}`, dimension)], dimension);
  }
  if (stage === "qualification") return one("confirm-authority", "Confirm decision ownership", "Confirm who can decide on a workflow check.", "If you found a coverage gap, are you the person who would decide whether to review that workflow?", stage, "approved-move", [...facts, progress("confirm-authority", "authority")], "authority");
  if (!missingLotLiftTacticContext("scoped-next-step", lotLiftPolicyContext(state, turn)).length) return one("workflow-check", "Invite a 15-minute workflow check", "Offer the approved next step after a verified workflow gap, authority, and consent.", "It sounds worth mapping the lead source, ownership, after-hours coverage, and visibility in a short 15-minute workflow check. Would you be open to that?", "meeting-invitation", "approved-move", [...facts, progress("workflow-check")]);
  return one("confirm-authority", "Confirm decision ownership", "Clarify the remaining decision path before offering a workflow check.", "If you found a coverage gap, are you the person who would decide whether to review that workflow?", "qualification", "approved-move", [...facts, progress("confirm-authority", "authority")], "authority", "scoped next step is missing required context");
}

/** Compatibility boundary for callers that need the deterministic immediate fallback. */
export function selectLotLiftNextMove(input: LotLiftMoveCandidateInput): LotLiftNextMove {
  return lotLiftMoveCandidates(input)[0]!;
}
