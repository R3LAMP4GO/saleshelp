import type { TranscriptSegment } from "../types";
import {
  deriveLotLiftConversationStage,
  type CallStateEvent,
  type LotLiftCallState,
  type LotLiftConversationStage,
  type LotLiftDiscoveryDimension,
} from "./callState";
import { LOTLIFT_POLICY_TACTICS, lotLiftPolicyContext, lotLiftTacticForMove, missingLotLiftTacticContext, type LotLiftClaimClass, type LotLiftPolicyTacticId } from "./policyPack";

export type LotLiftMoveSource = "approved-move" | "terminal-policy";

export interface LotLiftNextMove {
  id: string;
  title: string;
  goal: string;
  response: string;
  stage: LotLiftConversationStage;
  source: LotLiftMoveSource;
  tactic_id: LotLiftPolicyTacticId;
  allowed_claim_classes: readonly LotLiftClaimClass[];
  /** Bounded rationale for local selection; never model-authored. */
  candidate_reason: string;
  discovery_dimension?: LotLiftDiscoveryDimension;
  state_events: CallStateEvent[];
}

export type LotLiftMoveCandidate = Pick<LotLiftNextMove, "id" | "title" | "goal" | "stage" | "candidate_reason">;

const REFUSAL = /\b(?:not\s+(?:really\s+)?interested|no\s+thanks|not\s+a\s+priority|don'?t\s+(?:really\s+)?need\s+(?:it|this)|leave\s+(?:it|me|us)\s+alone)\b/i;
const ABUSE = /\b(?:fuck|fucking|shit|asshole|bitch|idiot|moron)\b/i;
const HARD_INTEGRATION = /\b(?:direct\s+)?(?:crm|dms)\s+integration\b.*\b(?:required|requirement|must\s+have|need)\b|\b(?:required|must\s+have|need)\b.*\b(?:direct\s+)?(?:crm|dms)\s+integration\b/i;
const UNSUPPORTED_FIT = /\b(?:we\s+(?:do\s+not|don't)\s+use\s+(?:cars\.com|cargurus|autotrader)|no\s+(?:online|marketplace)\s+inquiries|zero\s+(?:online|marketplace)\s+leads)\b/i;
const PAIN = /\b(?:(?:miss(?:ed|ing)?|los(?:e|ing))\s+(?:online\s+)?(?:leads?|inquir(?:y|ies))|(?:recover(?:ing)?\b[^.?!]{0,80}\bleads?\b[^.?!]{0,40}\balready\s+lost|(?:online\s+)?lost\s+leads?)|leads?\s+(?:sit|wait|go\s+unworked)|not\s+(?:being\s+)?followed\s+up|fall(?:s|ing)\s+through\s+the\s+cracks)\b/i;
const AUTHORITY = /\b(?:i\s+(?:make|own|handle)\s+(?:that|the)\s+decision|my\s+decision|i['’]m\s+the\s+(?:owner|gm|general\s+manager|sales\s+manager|internet\s+manager|bdc\s+manager))\b/i;
const OWNER = /\b(?:i['’]m|i\s+am)\s+(?:the\s+)?(?:owner|gm|general\s+manager|sales\s+manager|internet\s+manager|bdc\s+manager)\b/i;
const PRICE_CONCERN = /\b(?:too expensive|too much money|no budget|can(?:not|'t) afford|costs? too much|price feels? high)\b/i;
const VALUE_UNCERTAINTY = /\b(?:value (?:is )?(?:not |isn['’]?t )?clear|whether (?:the )?value is clear|not sure (?:it['’]?s|it is|this is) worth)\b/i;

function boundedEvidence(turn: TranscriptSegment): string {
  return turn.text.trim().slice(0, 160);
}

function progress(moveId: string, discoveryDimension?: LotLiftDiscoveryDimension, substantiveRefusal = false): CallStateEvent {
  return { type: "coaching-progress", move_id: moveId, discovery_dimension: discoveryDimension, substantive_refusal: substantiveRefusal };
}

function move(
  id: string,
  title: string,
  goal: string,
  response: string,
  stage: LotLiftConversationStage,
  source: LotLiftMoveSource,
  state_events: CallStateEvent[],
  discovery_dimension?: LotLiftDiscoveryDimension,
  candidate_reason = "deterministic policy route",
): LotLiftNextMove {
  const tactic_id = lotLiftTacticForMove(id);
  return { id, title, goal, response, stage, source, tactic_id, allowed_claim_classes: LOTLIFT_POLICY_TACTICS[tactic_id].allowed_claim_classes, candidate_reason, state_events, discovery_dimension };
}

/**
 * Selects only repository-approved discovery and close language. It never uses
 * model text, calendar availability, or unsupported product claims.
 */
export function lotLiftMoveCandidates(input: { state: LotLiftCallState; turn: TranscriptSegment; conversation: readonly TranscriptSegment[] }): readonly LotLiftMoveCandidate[] {
  const move = selectLotLiftNextMove(input);
  return [{ id: move.id, title: move.title, goal: move.goal, stage: move.stage, candidate_reason: move.candidate_reason }];
}

export function selectLotLiftNextMove(input: { state: LotLiftCallState; turn: TranscriptSegment; conversation: readonly TranscriptSegment[] }): LotLiftNextMove {
  const { state, turn } = input;
  const text = turn.text.trim();
  const stage = deriveLotLiftConversationStage(state);
  const evidence = { segment_id: turn.id, text: boundedEvidence(turn) };
  const policyContext = lotLiftPolicyContext(state, turn);

  if (stage === "terminal" || state.do_not_contact) {
    return move("terminal-close", "Close the call", "Honor the prospect's terminal decision.", "Understood. I’ll leave it there. Thanks for your time.", "terminal", "terminal-policy", [progress("terminal-close")]);
  }
  if (stage === "disqualified") {
    return move("disqualified-close", "Not a fit", "Close without pursuing a meeting.", "Understood. I do not want to pretend this is the right fit. Thanks for your time.", "disqualified", "terminal-policy", [progress("disqualified-close")]);
  }
  if (ABUSE.test(text)) {
    return move("abuse-close", "End respectfully", "Do not pursue a meeting after abuse without explicit re-engagement.", "Understood. I’ll leave it there. Thanks for your time.", "terminal", "terminal-policy", [progress("abuse-close", undefined, true)]);
  }
  if (HARD_INTEGRATION.test(text)) {
    return move("hard-integration-close", "Not a fit", "A required direct CRM/DMS integration disqualifies this workflow.", "Understood. If direct CRM or DMS integration is required, I should not pretend this is the right fit. Thanks for your time.", "disqualified", "terminal-policy", [
      { type: "capture", field: "disqualification_reason", fact: { value: "Required direct CRM/DMS integration", status: "verified", evidence } },
      progress("hard-integration-close"),
    ]);
  }
  if (UNSUPPORTED_FIT.test(text)) {
    return move("unsupported-fit-close", "Not a fit", "Do not push a meeting for an unsupported lead workflow.", "That may mean LotLift is not worth adding. I’ll leave it there. Thanks for your time.", "disqualified", "terminal-policy", [
      { type: "capture", field: "disqualification_reason", fact: { value: "Unsupported online inquiry workflow", status: "verified", evidence } },
      progress("unsupported-fit-close"),
    ]);
  }
  if (REFUSAL.test(text) && state.substantive_refusal_count >= 1) {
    return move("second-no-close", "Close the call", "Respect the second substantive refusal.", "Understood. I’ll leave it there. Thanks for your time.", "terminal", "terminal-policy", [progress("second-no-close", undefined, true)]);
  }

  const facts: CallStateEvent[] = [];
  if (OWNER.test(text)) facts.push({ type: "capture", field: "workflow_owner", fact: { value: text, status: "verified", evidence } });
  if (AUTHORITY.test(text)) facts.push({ type: "capture", field: "authority", fact: { value: text, status: "verified", evidence } });
  if (PAIN.test(text)) facts.push({ type: "append", field: "pain_points", fact: { value: text, status: "verified", evidence } });

  const hasPriceValueRoute = state.selected_objection_route.status === "verified"
    && state.selected_objection_route.value === "price-value"
    || state.decision_blockers.some((blocker) => blocker.status === "verified" && blocker.value === "price/value uncertainty");
  const priceValueWorkflowCheckEligible = stage === "meeting-invitation";

  if (PRICE_CONCERN.test(text)) {
    return move("price-isolation", "Isolate the price concern", "Use the approved introductory price to learn whether price, setup effort, alternatives, or value is the real concern.", "I hear you. For the first 50 customers, the basic plan is $20 and everything included is $24.99. Is the concern the price itself, the setup effort, another option, or whether the value is clear?", stage, "approved-move", [...facts, progress("price-isolation")], undefined, "explicit price concern");
  }
  if (hasPriceValueRoute && VALUE_UNCERTAINTY.test(text)) {
    if (priceValueWorkflowCheckEligible && !missingLotLiftTacticContext("scoped-next-step", policyContext).length) {
      return move("price-value-workflow-check", "Offer a value workflow check", "Offer the approved 15-minute workflow check only after verified workflow and authority evidence.", "That makes sense—being clear on value matters before deciding. Since we have confirmed the workflow details, would you be open to a short 15-minute workflow check to map the lead source, ownership, after-hours coverage, and visibility?", "meeting-invitation", "approved-move", [...facts, progress("price-value-workflow-check")], undefined, "verified price/value concern with workflow and authority evidence");
    }
    return move("price-value-uncertainty", "Clarify value uncertainty", "Acknowledge unresolved value without promising recovered leads or return on investment.", "That makes sense—being clear on value matters before deciding. What would you need to understand about the workflow to feel clear on that?", stage, "approved-move", [...facts, progress("price-value-uncertainty")], undefined, "durable price/value concern");
  }

  if (PAIN.test(text) && stage !== "meeting-invitation") {
    return move("impact-coverage", "Lead recovery coverage", "Confirm how the stated impact is covered before offering a workflow check.", "It sounds like delayed online inquiries are creating a real impact. When one comes in, who owns it right away, especially after hours?", stage, "approved-move", [...facts, progress("impact-coverage", "ownership")], "ownership");
  }
  if (stage === "owner-identification") {
    return move("identify-owner", "Identify the workflow owner", "Find the person responsible for paid online inquiry coverage.", "Who owns paid online inquiry response there: the internet manager, BDC manager, sales manager, or someone else?", stage, "approved-move", [...facts, progress("identify-owner", "ownership")], "ownership");
  }
  if (stage === "relevance-discovery") {
    return move("lead-source", "Confirm lead sources", "Establish whether paid online inquiries are relevant.", "Which online sources generate most buyer inquiries for you today?", stage, "approved-move", [...facts, progress("lead-source", "lead-source")], "lead-source");
  }
  if (stage === "gap-confirmation") {
    const dimension: LotLiftDiscoveryDimension = state.last_discovery_dimension === "after-hours" ? "visibility" : "after-hours";
    const response = dimension === "after-hours"
      ? "How is coverage handled when an online inquiry arrives after hours or the usual person is off?"
      : "How does the team verify that an online inquiry was owned and worked, rather than sitting in an inbox?";
    return move(`gap-${dimension}`, "Confirm the workflow gap", "Learn whether ownership or visibility leaves inquiries unworked.", response, stage, "approved-move", [...facts, progress(`gap-${dimension}`, dimension)], dimension);
  }
  if (stage === "qualification") {
    return move("confirm-authority", "Confirm decision ownership", "Confirm who can decide on a workflow check.", "If you found a coverage gap, are you the person who would decide whether to review that workflow?", stage, "approved-move", [...facts, progress("confirm-authority", "authority")], "authority");
  }
  if (!missingLotLiftTacticContext("scoped-next-step", policyContext).length) {
    return move("workflow-check", "Invite a 15-minute workflow check", "Offer the approved next step after a verified workflow gap, authority, and consent.", "It sounds worth mapping the lead source, ownership, after-hours coverage, and visibility in a short 15-minute workflow check. Would you be open to that?", "meeting-invitation", "approved-move", [...facts, progress("workflow-check")]);
  }
  return move("confirm-authority", "Confirm decision ownership", "Clarify the remaining decision path before offering a workflow check.", "If you found a coverage gap, are you the person who would decide whether to review that workflow?", "qualification", "approved-move", [...facts, progress("confirm-authority", "authority")], "authority", "scoped next step is missing required context");
}
