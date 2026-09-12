import type { TranscriptSegment } from "../types";
import {
  deriveLotLiftCallPhase,
  deriveLotLiftConversationStage,
  type CallStateEvent,
  type LotLiftCallState,
  type LotLiftConversationStage,
  type LotLiftDiscoveryDimension,
} from "./callState";
import { LOTLIFT_MOVE_RULES, LOTLIFT_POLICY_TACTICS, lotLiftPolicyContext, lotLiftTacticForMove, missingLotLiftTacticContext, type LotLiftClaimClass, type LotLiftPolicyTacticId } from "./policyPack";
import { lotLiftPlaybookRule, type LotLiftPlaybookRuleId } from "./playbook";
import { retrieveApprovedLotLiftResponse } from "./objections";
import { selectLotLiftColdCallCard } from "./turnEngine";
import { liveSpeechRejection } from "./responseComposer";
import { applyResolvedLotLiftMove, type ResolvedLotLiftScriptContext } from "./profileAdapter";
import type { ResolvedSalesProfile } from "../sales/profiles";
import { normalizeForIntent } from "./intentNormalization";
import { assimilatePendingAnswer } from "./pendingAnswer";
import { reduceLotLiftCallState } from "./callState";

export type LotLiftMoveSource = "approved-move" | "terminal-policy";
export type LotLiftResponseMode = "verbatim" | "template" | "compose";

export interface LotLiftNextMove {
  id: string;
  title: string;
  goal: string;
  /** Deterministic wording shown before local inference completes. */
  response: string;
  fallback_response: string;
  response_mode: LotLiftResponseMode;
  max_words?: number;
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
const OWNER_SELF_CONFIRMATION = /\bthat(?:'s| is)\s+me\b|\b(?:i['’]m|i\s+am)\s+(?:in\s+charge|responsible)|\bthat\s+falls\s+under\s+me\b|\b(?:online|paid\s+online)\s+leads?\s+(?:are|is)\s+mine\b|\bi\s+(?:handle|manage|own)\s+(?:that|them|online\s+leads?)\b/i;
const OWNER_CORRECTION = /\b(?:actually|no),?\s+(?:i|the\s+(?:internet|sales|bdc)\s+manager|[A-Z][a-z]+)\s+(?:handle|handles|own|owns|manage|manages|am\s+responsible)\b/i;
const PRICE_CONCERN = /\b(?:too expensive|sounds? expensive|too much money|no budget|can(?:not|'t) afford|costs? too much|(?:price|cost) (?:feels?|sounds?|is) (?:too )?high|how much(?: is it)?|what does (?:it|that) cost|pricing)\b/i;
const VALUE_UNCERTAINTY = /\b(?:value (?:is )?(?:not |isn['’]?t )?clear|whether (?:the )?value is clear|not sure (?:it['’]?s|it is|this is) worth)\b/i;
const LONG_TENURE_OR_STATUS_QUO = /\b(?:for\s+(?:\d+|many)\s+years?|for\s+decades?|worked\s+for\s+(?:years?|decades?)|happy\s+with\s+(?:what\s+we\s+have|our\s+(?:system|process|vendor|crm))|our\s+(?:dms|crm|process)\s+has\s+worked)\b/i;
const AI_SKEPTICISM = /\b(?:ai|artificial intelligence|hype|gimmick|replace\s+(?:my|our|the)?\s*(?:bdc|team|people|staff))\b/i;
const STAFF_ADOPTION = /\b(?:team\s+(?:already\s+)?ignores?\s+(?:half\s+)?(?:the\s+)?tools|(?:too\s+much\s+)?turnover\s+to\s+train|tried\s+software\s+like\s+this\s+before\s+and\s+nobody\s+used)\b/i;
const DIRECT_PRODUCT_QUESTION = /(?:\b(?:do|does|can|is|are|what|how|why)\b[^.?!]{0,60}\b(?:ai|artificial intelligence|automated?|auto[- ]?send|security|secure|integration|integrate)\b|\b(?:ai|artificial intelligence|automated?|auto[- ]?send|security|secure|integration|integrate)\b[^.?!]{0,60}\?)/i;
const SUBSTANTIVE_QUESTION = /\?|\b(?:what|why|how|when|where|who|do|does|can|could|would|will|is|are)\b[^.?!]{0,90}\b(?:you|this|that|it|we|lotlift|help|work|mean|calling|integrat|secure|ai|change|cost)/i;
const CRM_MENTION = /\b(?:use|using)\s+([A-Z][A-Za-z0-9-]{2,})(?:\s+CRM)?\b/;
const AFTER_HOURS_GAP = /\b(?:after hours|overnight).{0,80}\b(?:sit|wait|unworked).{0,80}\b(?:morning|until)/i;

function boundedEvidence(turn: TranscriptSegment): string { return turn.text.trim().slice(0, 160); }
function progress(move_id: string, discovery_dimension?: LotLiftDiscoveryDimension, substantive_refusal = false): CallStateEvent {
  return { type: "coaching-progress", move_id, discovery_dimension, substantive_refusal };
}
function baseMove(id: string, title: string, goal: string, response: string, stage: LotLiftConversationStage, source: LotLiftMoveSource, state_events: CallStateEvent[], discovery_dimension?: LotLiftDiscoveryDimension, candidate_reason = "deterministic policy route", profile?: ResolvedSalesProfile, context: ResolvedLotLiftScriptContext = {}): LotLiftNextMove {
  const configured = applyResolvedLotLiftMove({ id, title, goal, response, fallback_response: response, response_mode: source === "terminal-policy" || ["O2", "O3", "second-no-close"].includes(id) ? "verbatim" : "compose", stage, source, tactic_id: lotLiftTacticForMove(id), rule_ids: [], allowed_claim_classes: [], candidate_reason, approved_strategy: "", prohibited_behavior: "", state_events, discovery_dimension }, profile, context);
  const speechRejection = liveSpeechRejection(configured.response, id, configured.max_words);
  if (speechRejection) throw new Error(`LotLift move ${id} violates the live-speech contract: ${speechRejection}`);
  const tactic_id = configured.tactic_id;
  const tactic = LOTLIFT_POLICY_TACTICS[tactic_id];
  const rule_ids = LOTLIFT_MOVE_RULES[id as keyof typeof LOTLIFT_MOVE_RULES];
  if (!rule_ids?.length) throw new Error(`LotLift move ${id} is missing policy rules.`);
  const primaryRule = lotLiftPlaybookRule(rule_ids[0]);
  return { ...configured, tactic_id, rule_ids, allowed_claim_classes: tactic.allowed_claim_classes, approved_strategy: primaryRule.approved_strategy, prohibited_behavior: primaryRule.prohibited_behavior };
}

/**
 * Produces deterministic, policy-bounded choices. The first candidate is the
 * immediate safe fallback; terminal policies deliberately produce exactly one.
 */
export type LotLiftCurrentTurnState = { state: LotLiftCallState; events: CallStateEvent[] };

export type LotLiftMoveCandidateInput = {
  state: LotLiftCallState;
  turn: TranscriptSegment;
  conversation: readonly TranscriptSegment[];
  /** Caller-supplied shared snapshot keeps routing and composition on identical current evidence. */
  currentTurnState?: LotLiftCurrentTurnState;
  approvedRepIdentity?: string | null;
  resolvedProfile?: ResolvedSalesProfile;
};


/** Applies only finalized current prospect evidence; coaching-progress remains persistence-only. */
export function deriveLotLiftCurrentTurnState(state: LotLiftCallState, turn: TranscriptSegment): LotLiftCurrentTurnState {
  if (!turn.isFinal || turn.source !== "them") return { state, events: [] };
  const text = turn.text.trim();
  const evidence = { segment_id: turn.id, text: boundedEvidence(turn) };
  const events = [...assimilatePendingAnswer(state, turn)];
  let derived = events.reduce(reduceLotLiftCallState, state);
  const capture = (field: "workflow_owner" | "authority" | "current_solution" | "after_hours_process", value: string, replaceVerified = false) => {
    if (derived[field].status === "verified" && !replaceVerified) return;
    const event: CallStateEvent = { type: "capture", field, fact: { value, status: "verified", evidence } };
    events.push(event);
    derived = reduceLotLiftCallState(derived, event);
  };
  if (OWNER.test(text) || OWNER_SELF_CONFIRMATION.test(text)) capture("workflow_owner", text);
  if (OWNER_CORRECTION.test(text)) capture("workflow_owner", text, true);
  if (AUTHORITY.test(text)) capture("authority", text);
  const crm = text.match(CRM_MENTION)?.[1];
  if (crm) capture("current_solution", crm);
  if (PAIN.test(text) || AFTER_HOURS_GAP.test(text)) {
    const event: CallStateEvent = { type: "append", field: "pain_points", fact: { value: text, status: "verified", evidence } };
    events.push(event);
    derived = reduceLotLiftCallState(derived, event);
  }
  if (AFTER_HOURS_GAP.test(text)) capture("after_hours_process", text);
  return { state: derived, events };
}

function isSubstantiveQuestion(text: string): boolean {
  return SUBSTANTIVE_QUESTION.test(text);
}

function isNormalFactualProgression(currentTurn: LotLiftCurrentTurnState, text: string): boolean {
  if (currentTurn.events.some((event) => event.type === "capture" || event.type === "append")) return true;
  if (LONG_TENURE_OR_STATUS_QUO.test(text)) return false;
  const normalized = normalizeForIntent(text);
  if (/\b(?:no|not|don['’]?t|doesn['’]?t|can['’]?t|won['’]?t|wouldn['’]?t|isn['’]?t|aren['’]?t|never|problem|fit|worth|change|understand|confus|feel|seem|concern|think|believe|want|need|hope|see|sound)\b/.test(normalized)) return false;
  return /^(?:yeah|yes|yep|correct|right|sure|i (?:do|handle|manage|am)|we (?:use|get|have)|our |mostly\b|mainly\b|primarily\b)/.test(normalized);
}

/** Route all remaining substantive prospect context before ordinary factual discovery. */
function isContextualResponseEligible(input: LotLiftMoveCandidateInput, currentTurn: LotLiftCurrentTurnState): boolean {
  const hasConfiguredMove = input.resolvedProfile?.behavior.moves.some((move) => move.id === "contextual-response");
  const substantiveTurn = (input.turn.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) >= 3;
  return Boolean(hasConfiguredMove && input.turn.isFinal && input.turn.source === "them" && substantiveTurn
    && !isNormalFactualProgression(currentTurn, input.turn.text));
}

function nextUnresolvedWorkflowQuestion(state: LotLiftCallState): string {
  if (!state.lead_sources.some((fact) => fact.status === "verified")) return "Which online sources generate most buyer inquiries today?";
  if (state.lead_arrival_point.status !== "verified") return "Where do those paid online inquiries arrive first today?";
  if (state.current_solution.status !== "verified") return "What system or workflow handles those inquiries today?";
  if (state.after_hours_process.status !== "verified") return "How is coverage handled when an inquiry arrives after hours?";
  if (state.visibility_process.status !== "verified") return "How does the team verify an inquiry was owned and worked?";
  if (!state.pain_points.some((fact) => fact.status === "verified")) return "When that workflow breaks down, what happens to the inquiry or customer?";
  if (state.authority.status !== "verified") return "Are you the person who would decide whether to review that workflow?";
  return "Would you be open to mapping that workflow in a short 15-minute check?";
}

/** Safe deterministic fallback must address the actual concern rather than restart generic discovery. */
function contextualFallback(text: string, isPurposeQuestion: boolean, state: LotLiftCallState): string {
  if (/\bhow can i help\b/i.test(text)) return `I want to understand the workflow before assuming anything. ${nextUnresolvedWorkflowQuestion(state)}`;
  if (/spying|watching|intrusive/i.test(text)) return "I understand why that could feel like spying. What would be most useful to clarify?";
  if (LONG_TENURE_OR_STATUS_QUO.test(text)) return "I’m not assuming you need to change a process that has worked for years. What would be most useful to clarify?";
  if (/\b(?:ai|artificial intelligence)\b/i.test(text)) return "Fair question about AI—I don’t want to assume how it would fit your workflow. What would be most useful to clarify?";
  if (/\b(?:secure|security)\b/i.test(text)) return "I don’t want to assume details about security. What would be most useful to clarify?";
  if (/\b(?:integrat(?:e|ion)|crm|dms)\b/i.test(text)) return "I don’t want to assume integration details. What would be most useful to clarify?";
  if (/\buseful\b/i.test(text)) return "Fair question about what would be useful—I don’t want to assume. What would be most useful to clarify?";
  if (/\bhelp\b/i.test(text)) return "Fair question about how this could help—I don’t want to assume. What would be most useful to clarify?";
  if (isPurposeQuestion) return "I’m calling to understand the online inquiry workflow, not assume it needs changing. What would be most useful to clarify?";
  return "I want to understand that before assuming anything. What would be most useful to clarify?";
}

export function lotLiftMoveCandidates(input: LotLiftMoveCandidateInput): readonly LotLiftMoveCandidate[] {
  const { state, turn } = input;
  const text = turn.text.trim();
  const intentText = normalizeForIntent(text);
  const currentTurn = input.currentTurnState ?? deriveLotLiftCurrentTurnState(state, turn);
  const routingState = currentTurn.state;
  const scriptContext = { representativeName: input.approvedRepIdentity, firstName: routingState.contact_name.value, dealership: routingState.dealership.value };
  const move = (id: string, title: string, goal: string, response: string, moveStage: LotLiftConversationStage, source: LotLiftMoveSource, stateEvents: CallStateEvent[], discoveryDimension?: LotLiftDiscoveryDimension, candidateReason = "deterministic policy route") =>
    baseMove(id, title, goal, response, moveStage, source, stateEvents, discoveryDimension, candidateReason, input.resolvedProfile, scriptContext);
  const stage = deriveLotLiftConversationStage(routingState);
  const phase = deriveLotLiftCallPhase(routingState);
  const evidence = { segment_id: turn.id, text: boundedEvidence(turn) };
  const facts = currentTurn.events;
  const one = (...args: Parameters<typeof move>) => [move(...args)];
  const hasFact = (items: readonly { value: string | null }[]) => items.some((fact) => Boolean(fact.value));
  const hasPain = hasFact(routingState.pain_points) || Boolean(routingState.after_hours_process.value) || Boolean(routingState.visibility_process.value);
  const hasStakeholder = hasFact(routingState.decision_stakeholders) || hasFact(routingState.stakeholders);
  const priceWasIsolated = input.conversation.some((segment) => segment.isFinal && segment.source === "me" && /monthly spend|setup effort|another option|feels worth|concern the spend/i.test(segment.text));

  if (stage === "terminal" || routingState.do_not_contact) return one("terminal-close", "Close the call", "Honor the prospect's terminal decision.", "Understood. Thank you.", "terminal", "terminal-policy", [progress("terminal-close")]);
  if (stage === "disqualified") return one("disqualified-close", "Not a fit", "Close without pursuing a meeting.", "Understood. Thank you.", "disqualified", "terminal-policy", [progress("disqualified-close")]);
  if (ABUSE.test(text)) return one("abuse-close", "End respectfully", "Do not pursue a meeting after abuse without explicit re-engagement.", "Understood. Thank you.", "terminal", "terminal-policy", [progress("abuse-close", undefined, true)]);
  if (HARD_INTEGRATION.test(text)) return one("hard-integration-close", "Not a fit", "A required direct CRM/DMS integration disqualifies this workflow.", "Understood. Thank you.", "disqualified", "terminal-policy", [{ type: "capture", field: "disqualification_reason", fact: { value: "Required direct CRM/DMS integration", status: "verified", evidence } }, progress("hard-integration-close")]);
  if (UNSUPPORTED_FIT.test(text)) return one("unsupported-fit-close", "Not a fit", "Do not push a meeting for an unsupported lead workflow.", "Understood. Thank you.", "disqualified", "terminal-policy", [{ type: "capture", field: "disqualification_reason", fact: { value: "Unsupported online inquiry workflow", status: "verified", evidence } }, progress("unsupported-fit-close")]);
  if (REFUSAL.test(intentText) && routingState.substantive_refusal_count >= 1) return one("second-no-close", "Close the call", "Respect the second substantive refusal.", "Understood. Thank you.", "terminal", "terminal-policy", [progress("second-no-close", undefined, true)]);
  if (REFUSAL.test(intentText)) {
    return one("first-refusal", "Clarify the first refusal", "Ask one brief coverage question, then respect a second no.", "Totally fair. Before I go, how are paid online inquiries covered after hours?", stage, "approved-move", [...facts, progress("first-refusal", undefined, true)], undefined, "first substantive refusal receives the canonical one-question response");
  }

  const isIdentityQuestion = /\b(?:who (?:is|are) this|who(?:'s| is) this|who are you)\b/.test(intentText);
  const isPurposeQuestion = /\b(?:what(?:'s| is) this (?:about|regarding)|why (?:are you|did you)(?: call| calling)|how can i help)\b/.test(intentText);
  const isDirectQuestion = isPurposeQuestion || isSubstantiveQuestion(text) || /\b(?:what exactly do you do|why should i care|what are you (?:actually )?trying to sell|how does that help|why are you asking)\b/.test(intentText);
  const coldCallCard = isIdentityQuestion || isPurposeQuestion ? selectLotLiftColdCallCard(turn, routingState, input.conversation, input.approvedRepIdentity) : null;
  if (coldCallCard?.card.id === "O2") return one("O2", "Who is this?", "Identify the caller truthfully and wait for the prospect's next turn.", coldCallCard.response, "owner-identification", "approved-move", [progress("O2")], undefined, "explicit identity question with configured representative identity");
  if (coldCallCard?.card.id === "O3") return one("O3", "Purpose and permission", "State the truthful purpose, then learn one workflow fact.", coldCallCard.response, "relevance-discovery", "approved-move", [progress("O3")], undefined, "explicit purpose question follows identity or permission");
  const ownershipConfirmedThisTurn = facts.some((event) => event.type === "capture" && event.field === "workflow_owner" && event.fact.status === "verified");
  if (phase === "RIGHT_PERSON" && ownershipConfirmedThisTurn) {
    return one("right-person-process", "Begin right-person process discovery", "Start with the current online-lead process after the prospect confirms responsibility.", "How are you guys handling your online leads right now, especially after hours?", "relevance-discovery", "approved-move", [...facts, progress("right-person-process", "after-hours")], "after-hours", "confirmed right person advances directly to process discovery");
  }
  if (AI_SKEPTICISM.test(turn.text) && !DIRECT_PRODUCT_QUESTION.test(turn.text)) {
    return [baseMove("ai-skepticism", "Clarify AI concern", "Acknowledge AI skepticism, explain the workflow purpose, and learn the actual concern.", "Fair concern, the purpose is to understand the online-inquiry workflow before recommending anything. What specifically concerns you about AI in that workflow?", stage, "approved-move", [...facts, progress("ai-skepticism")], undefined, "AI skepticism requires safe workflow-purpose clarification", input.resolvedProfile, { representativeName: input.approvedRepIdentity })];
  }
  if (STAFF_ADOPTION.test(turn.text)) {
    const adoptionQuestion = /turnover|train/i.test(text)
      ? "What made training new people difficult with the last system?"
      : "What made the last attempt hard for the team to adopt?";
    return [baseMove("staff-adoption", "Clarify staff adoption concern", "Acknowledge the adoption concern and learn what made the prior effort difficult.", `That makes sense. ${adoptionQuestion}`, stage, "approved-move", [...facts, progress("staff-adoption")], undefined, "staff adoption concern requires neutral diagnosis of the prior effort", input.resolvedProfile, { representativeName: input.approvedRepIdentity, adoptionQuestion })];
  }
  const shouldPreferContextual = /spying/i.test(text) || LONG_TENURE_OR_STATUS_QUO.test(text) || DIRECT_PRODUCT_QUESTION.test(text);
  const existingCrmMention = routingState.workflow_owner.status === "verified" && /\b(?:we already have|we (?:already )?use|using)\b[^.?!]{0,50}\b(?:crm|vinsolutions|bdc|internet department)\b/i.test(text);
  const routedObjection = shouldPreferContextual || existingCrmMention ? null : retrieveApprovedLotLiftResponse(text, input.conversation.filter((segment) => segment.source === "them" && segment.id !== turn.id).map((segment) => segment.text));
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

  if (VALUE_UNCERTAINTY.test(text) && (routingState.selected_objection_route.value === "price-value" || routingState.decision_blockers.some((fact) => fact.value === "price/value uncertainty"))) {
    if (stage === "meeting-invitation" && !missingLotLiftTacticContext("scoped-next-step", lotLiftPolicyContext(routingState, turn)).length) return one("price-value-workflow-check", "Offer a value workflow check", "Offer the approved workflow check only after verified context.", "That makes sense—being clear on value matters before deciding. Would you be open to a short 15-minute workflow check?", "meeting-invitation", "approved-move", [...facts, progress("price-value-workflow-check")]);
    return one("price-value-uncertainty", "Clarify value uncertainty", "Clarify unresolved value without promising results.", "That makes sense—what would you need to understand about the workflow to feel clear on that?", stage, "approved-move", [...facts, progress("price-value-uncertainty")]);
  }

  if (existingCrmMention) {
    const candidates = [move("crm-coverage", "Verify existing workflow coverage", "Respect the existing system and test the known handoff or after-hours workflow.", "That makes sense. When an inquiry comes in after hours, does it still get picked up right away in that workflow?", stage, "approved-move", [...facts, progress("crm-coverage")], undefined, "existing CRM or workflow mentioned")];
    if (hasPain) candidates.push(move("impact-coverage", "Clarify the known coverage gap", "Discuss the stated handoff concern without disparaging the CRM.", "Got it. What happens when that workflow cannot cover an inquiry right away?", stage, "approved-move", [...facts, progress("impact-coverage", "ownership")], "ownership", "existing CRM plus earlier coverage concern"));
    return candidates;
  }

  if (PAIN.test(text) && stage !== "meeting-invitation") return one("impact-coverage", "Lead recovery coverage", "Confirm how the stated impact is covered before offering a workflow check.", "It sounds like delayed online inquiries are creating a real impact. When one comes in, who owns it right away, especially after hours?", stage, "approved-move", [...facts, progress("impact-coverage", "ownership")], "ownership");
  if (isContextualResponseEligible(input, currentTurn)) {
    const fallback = contextualFallback(text, isPurposeQuestion, routingState);
    return [baseMove("contextual-response", "Respond to the prospect's context", "Answer or acknowledge the current point safely, then clarify one useful unresolved detail.", fallback, stage, "approved-move", [...facts, progress("contextual-response")], undefined, isDirectQuestion ? "substantive direct question after deterministic and known routes" : "remaining substantive prospect context after deterministic and known routes", input.resolvedProfile, { ...scriptContext, contextualQuestion: fallback })];
  }
  if (stage === "owner-identification") return one("identify-owner", "Identify the workflow owner", "Find the person responsible for paid online inquiry coverage.", "Who owns paid online inquiry response there: the internet manager, BDC manager, sales manager, or someone else?", stage, "approved-move", [...facts, progress("identify-owner", "ownership")], "ownership");
  if (stage === "relevance-discovery") return one("lead-source", "Confirm lead sources", "Establish whether paid online inquiries are relevant.", "Which online sources generate most buyer inquiries for you today?", stage, "approved-move", [...facts, progress("lead-source", "lead-source")], "lead-source");
  if (stage === "gap-confirmation") {
    const afterHoursKnown = routingState.after_hours_process.status === "verified";
    const visibilityKnown = routingState.visibility_process.status === "verified";
    if (!afterHoursKnown && routingState.last_discovery_dimension !== "after-hours") return one("gap-after-hours", "Confirm after-hours coverage", "Learn how paid online inquiries are covered after hours.", "How is coverage handled when an online inquiry arrives after hours or the usual person is off?", stage, "approved-move", [...facts, progress("gap-after-hours", "after-hours")], "after-hours");
    if (!visibilityKnown) return one("gap-visibility", "Confirm inquiry visibility", "Learn how the team verifies an inquiry was owned and worked.", "How does the team verify that an online inquiry was owned and worked, rather than sitting in an inbox?", stage, "approved-move", [...facts, progress("gap-visibility", "visibility")], "visibility");
    return one("gap-impact", "Confirm workflow impact", "Learn the impact of any remaining coverage gap before qualifying.", "When that workflow breaks down, what tends to happen to the inquiry or the customer?", stage, "approved-move", [...facts, progress("gap-impact", "pain")], "pain");
  }
  if (stage === "qualification") return one("confirm-authority", "Confirm decision ownership", "Confirm who can decide on a workflow check.", "If you found a coverage gap, are you the person who would decide whether to review that workflow?", stage, "approved-move", [...facts, progress("confirm-authority", "authority")], "authority");
  if (!missingLotLiftTacticContext("scoped-next-step", lotLiftPolicyContext(routingState, turn)).length) return one("workflow-check", "Invite a 15-minute workflow check", "Offer the approved next step after a verified workflow gap, authority, and consent.", "It sounds worth mapping the lead source, ownership, after-hours coverage, and visibility in a short 15-minute workflow check. Would you be open to that?", "meeting-invitation", "approved-move", [...facts, progress("workflow-check")]);
  return one("confirm-authority", "Confirm decision ownership", "Clarify the remaining decision path before offering a workflow check.", "If you found a coverage gap, are you the person who would decide whether to review that workflow?", "qualification", "approved-move", [...facts, progress("confirm-authority", "authority")], "authority", "scoped next step is missing required context");
}

/** Compatibility boundary for callers that need the deterministic immediate fallback. */
export function selectLotLiftNextMove(input: LotLiftMoveCandidateInput): LotLiftNextMove {
  return lotLiftMoveCandidates(input)[0]!;
}
