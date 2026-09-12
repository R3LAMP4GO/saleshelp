import type { TranscriptSegment } from "../types";
import {
  deriveLotLiftCallPhase,
  deriveLotLiftConversationStage,
  reduceLotLiftCallState,
  type CallStateEvent,
  type LotLiftCallState,
  type LotLiftConversationStage,
  type LotLiftDiscoveryDimension,
} from "./callState";
import { LOTLIFT_MOVE_RULES, LOTLIFT_POLICY_TACTICS, lotLiftTacticForMove, type LotLiftClaimClass, type LotLiftPolicyTacticId } from "./policyPack";
import { lotLiftPlaybookRule, type LotLiftPlaybookRuleId } from "./playbook";
import { selectLotLiftColdCallCard } from "./turnEngine";
import { liveSpeechRejection } from "./responseComposer";
import { applyResolvedLotLiftMove, type ResolvedLotLiftScriptContext } from "./profileAdapter";
import type { ResolvedSalesProfile } from "../sales/profiles";
import { normalizeForIntent } from "./intentNormalization";
import { assimilatePendingAnswer } from "./pendingAnswer";
import { isDoNotContactRequest } from "./dnc";

export type LotLiftMoveSource = "approved-move" | "terminal-policy";
export type LotLiftResponseMode = "verbatim" | "template" | "compose";

export interface LotLiftNextMove {
  id: string;
  title: string;
  goal: string;
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

export type LotLiftMoveCandidate = LotLiftNextMove;

const REFUSAL = /\b(?:not\s+(?:really\s+)?interested|no\s+thanks|not\s+a\s+priority|don'?t\s+(?:really\s+)?need\s+(?:it|this)|leave\s+(?:it|me|us)\s+alone)\b/i;
const ABUSE = /\b(?:fuck|fucking|shit|asshole|bitch|idiot|moron)\b/i;
const HARD_INTEGRATION = /\b(?:direct\s+)?(?:crm|dms)\s+integration\b.*\b(?:required|requirement|must\s+have|need)\b|\b(?:required|must\s+have|need)\b.*\b(?:direct\s+)?(?:crm|dms)\s+integration\b/i;
const UNSUPPORTED_FIT = /\b(?:we\s+(?:do\s+not|don't)\s+use\s+(?:cars\.com|cargurus|autotrader)|no\s+(?:online|marketplace)\s+inquiries|zero\s+(?:online|marketplace)\s+leads)\b/i;
const PAIN = /\b(?:(?:miss(?:ed|ing)?|los(?:e|ing))\s+(?:online\s+)?(?:leads?|inquir(?:y|ies))|recover(?:ing)?\b[^.?!]{0,80}\bleads?\b|leads?\s+(?:sit|wait|go\s+unworked)|not\s+(?:being\s+)?followed\s+up|fall(?:s|ing)\s+through\s+the\s+cracks)\b/i;
const AUTHORITY = /\b(?:i\s+(?:make|own|handle)\s+(?:that|the\s+decision)|my\s+decision|i['’]m\s+the\s+(?:owner|gm|general\s+manager|sales\s+manager|internet\s+manager|bdc\s+manager))\b/i;
const OWNER = /\b(?:i['’]m|i\s+am)\s+(?:the\s+)?(?:owner|gm|general\s+manager|sales\s+manager|internet\s+manager|bdc\s+manager)\b/i;
const OWNER_SELF_CONFIRMATION = /\bthat(?:'s| is)\s+me\b|\b(?:i['’]m|i\s+am)\s+(?:in\s+charge|responsible)|\bthat\s+falls\s+under\s+me\b|\b(?:online|paid\s+online)\s+leads?\s+(?:are|is)\s+mine\b|\bi\s+(?:handle|manage|own)\s+(?:that|them|online\s+leads?)\b/i;
const OWNER_CORRECTION = /\b(?:actually|no),?\s+(?:i|the\s+(?:internet|sales|bdc)\s+manager|[A-Z][a-z]+)\s+(?:handle|handles|own|owns|manage|manages|am\s+responsible)\b/i;
const CRM_MENTION = /\b(?:use|using)\s+([A-Z][A-Za-z0-9-]{2,})(?:\s+CRM)?\b/;
const AFTER_HOURS_GAP = /\b(?:after hours|overnight).{0,80}\b(?:sit|wait|unworked).{0,80}\b(?:morning|until)/i;
const RESPONSE_SPEED = /\b(?:respond|response|reply|replied|replying).{0,60}\b(?:minutes?|hours?|morning|immediately|quickly|slowly|next day)\b|\b(?:next morning|next day)\b/i;
const APPOINTMENT_CAPABILITY = /\b(?:book|booking|booked|set|setting|scheduled?|schedule).{0,60}\bappointments?\b|\bappointments?.{0,60}\b(?:book|set|schedule)/i;
const FOLLOW_UP_PROCESS = /\bfollow[- ]?up\b/i;
const LOTLIFT_PRODUCT_QUESTION = /\b(?:what(?:\s+exactly)?\s+does\s+lotlift\s+do|why\s+would\s+we\s+need\s+(?:this|lotlift))\b/i;
const MEETING_ACCEPTANCE = /\b(?:tuesday|thursday|that works|works for me|sounds good|let'?s do it|book it)\b/i;

function boundedEvidence(turn: TranscriptSegment): string { return turn.text.trim().slice(0, 160); }
function progress(move_id: string, discovery_dimension?: LotLiftDiscoveryDimension, substantive_refusal = false): CallStateEvent { return { type: "coaching-progress", move_id, discovery_dimension, substantive_refusal }; }

function baseMove(id: string, title: string, goal: string, response: string, stage: LotLiftConversationStage, source: LotLiftMoveSource, state_events: CallStateEvent[], discovery_dimension?: LotLiftDiscoveryDimension, candidate_reason = "deterministic policy route", profile?: ResolvedSalesProfile, context: ResolvedLotLiftScriptContext = {}): LotLiftNextMove {
  const configured = applyResolvedLotLiftMove({ id, title, goal, response, fallback_response: response, response_mode: source === "terminal-policy" || ["O2", "O3", "second-no-close", "workflow-check", "v7-product-answer"].includes(id) ? "verbatim" : "compose", stage, source, tactic_id: lotLiftTacticForMove(id), rule_ids: [], allowed_claim_classes: [], candidate_reason, approved_strategy: "", prohibited_behavior: "", state_events, discovery_dimension }, profile, context);
  const speechRejection = liveSpeechRejection(configured.response, id, configured.max_words);
  if (speechRejection) throw new Error(`LotLift move ${id} violates the live-speech contract: ${speechRejection}`);
  const tactic_id = configured.tactic_id;
  const rule_ids = LOTLIFT_MOVE_RULES[id as keyof typeof LOTLIFT_MOVE_RULES];
  if (!rule_ids?.length) throw new Error(`LotLift move ${id} is missing policy rules.`);
  const primaryRule = lotLiftPlaybookRule(rule_ids[0]);
  return { ...configured, tactic_id, rule_ids, allowed_claim_classes: LOTLIFT_POLICY_TACTICS[tactic_id].allowed_claim_classes, approved_strategy: primaryRule.approved_strategy, prohibited_behavior: primaryRule.prohibited_behavior };
}

export type LotLiftCurrentTurnState = { state: LotLiftCallState; events: CallStateEvent[] };
export type LotLiftMoveCandidateInput = { state: LotLiftCallState; turn: TranscriptSegment; conversation: readonly TranscriptSegment[]; currentTurnState?: LotLiftCurrentTurnState; approvedRepIdentity?: string | null; resolvedProfile?: ResolvedSalesProfile };

/** Applies only finalized current prospect evidence; coaching progress remains persistence-only. */
export function deriveLotLiftCurrentTurnState(state: LotLiftCallState, turn: TranscriptSegment): LotLiftCurrentTurnState {
  if (!turn.isFinal || turn.source !== "them") return { state, events: [] };
  const text = turn.text.trim();
  const evidence = { segment_id: turn.id, text: boundedEvidence(turn) };
  const events = [...assimilatePendingAnswer(state, turn)];
  let derived = events.reduce(reduceLotLiftCallState, state);
  const capture = (field: "workflow_owner" | "authority" | "current_solution" | "after_hours_process" | "response_speed" | "appointment_capability" | "follow_up_process", value: string, replaceVerified = false) => {
    if (derived[field].status === "verified" && !replaceVerified) return;
    const event: CallStateEvent = { type: "capture", field, fact: { value, status: "verified", evidence } };
    events.push(event); derived = reduceLotLiftCallState(derived, event);
  };
  if (OWNER.test(text) || OWNER_SELF_CONFIRMATION.test(text)) capture("workflow_owner", text);
  if (OWNER_CORRECTION.test(text)) capture("workflow_owner", text, true);
  if (AUTHORITY.test(text)) capture("authority", text);
  const crm = text.match(CRM_MENTION)?.[1];
  if (crm) capture("current_solution", crm);
  if (PAIN.test(text) || AFTER_HOURS_GAP.test(text)) { const event: CallStateEvent = { type: "append", field: "pain_points", fact: { value: text, status: "verified", evidence } }; events.push(event); derived = reduceLotLiftCallState(derived, event); }
  if (AFTER_HOURS_GAP.test(text)) capture("after_hours_process", text);
  if (REFUSAL.test(normalizeForIntent(text))) { const event = progress("terra-composition", undefined, true); events.push(event); derived = reduceLotLiftCallState(derived, event); }
  if (!/\?\s*$/.test(text) && RESPONSE_SPEED.test(text)) capture("response_speed", text);
  if (!/\?\s*$/.test(text) && APPOINTMENT_CAPABILITY.test(text)) capture("appointment_capability", text);
  if (!/\?\s*$/.test(text) && FOLLOW_UP_PROCESS.test(text)) capture("follow_up_process", text);
  return { state: derived, events };
}

function nextUnresolvedWorkflowQuestion(state: LotLiftCallState): string {
  if (!state.lead_sources.some((fact) => fact.status === "verified")) return "Which online sources generate most buyer inquiries today?";
  if (state.lead_arrival_point.status !== "verified") return "Where do those paid online inquiries arrive first today?";
  if (state.current_solution.status !== "verified") return "What system or workflow handles those inquiries today?";
  if (state.after_hours_process.status !== "verified") return "How is coverage handled when an inquiry arrives after hours?";
  if (state.response_speed.status !== "verified") return "How quickly does someone respond to a new online inquiry?";
  if (state.appointment_capability.status !== "verified") return "How does that first response move the customer toward an appointment?";
  if (state.follow_up_process.status !== "verified") return "What follow-up happens when the customer does not respond?";
  if (state.visibility_process.status !== "verified") return "How does the team verify an inquiry was owned and worked?";
  if (!state.pain_points.some((fact) => fact.status === "verified")) return "When that workflow breaks down, what happens to the inquiry or customer?";
  if (state.authority.status !== "verified") return "Are you the person who would decide whether to review that workflow?";
  return "Would you be open to mapping that workflow in a short 15-minute check?";
}

function terraObjective(state: LotLiftCallState): { goal: string; fallback: string; dimension?: LotLiftDiscoveryDimension } {
  const phase = deriveLotLiftCallPhase(state);
  if (phase === "GATEKEEPER") return { goal: "Identify the person responsible for online-inquiry coverage.", fallback: "Who handles the online leads there?", dimension: "ownership" };
  if (phase === "RIGHT_PERSON") return { goal: "Continue with current-process discovery after responsibility is confirmed.", fallback: "How are online leads handled today, especially after hours?", dimension: "after-hours" };
  if (phase === "GAP_FOUND" || phase === "MEETING_ASK") return { goal: "Offer the approved low-risk workflow check after a verified gap.", fallback: "Give me 15 minutes, I'll show you how LotLift handles that piece, and you can tell me if it makes sense. Is Tuesday or Thursday better?" };
  return { goal: "Address the current prospect context and advance one unresolved workflow detail.", fallback: nextUnresolvedWorkflowQuestion(state) };
}

/** Exact exits and scripts route locally; every other finalized prospect turn is composed by Terra. */
export function lotLiftMoveCandidates(input: LotLiftMoveCandidateInput): readonly LotLiftMoveCandidate[] {
  const { state, turn } = input;
  const text = turn.text.trim();
  const currentTurn = input.currentTurnState ?? deriveLotLiftCurrentTurnState(state, turn);
  const routingState = currentTurn.state;
  const stage = deriveLotLiftConversationStage(routingState);
  const phase = deriveLotLiftCallPhase(routingState);
  const facts = currentTurn.events;
  const scriptContext = { representativeName: input.approvedRepIdentity, firstName: routingState.contact_name.value, dealership: routingState.dealership.value };
  const move = (id: string, title: string, goal: string, response: string, moveStage: LotLiftConversationStage, source: LotLiftMoveSource, events: CallStateEvent[], dimension?: LotLiftDiscoveryDimension, reason?: string) => baseMove(id, title, goal, response, moveStage, source, events, dimension, reason, input.resolvedProfile, scriptContext);
  const one = (...args: Parameters<typeof move>) => [move(...args)];
  const evidence = { segment_id: turn.id, text: boundedEvidence(turn) };

  if (deriveLotLiftConversationStage(state) === "terminal" || routingState.do_not_contact || isDoNotContactRequest(text)) return one("terminal-close", "Close the call", "Honor the prospect's terminal decision.", "Understood. Thank you.", "terminal", "terminal-policy", isDoNotContactRequest(text) ? [{ type: "do-not-contact", at: new Date().toISOString(), evidence }, progress("terminal-close")] : [progress("terminal-close")]);
  if (stage === "disqualified") return one("disqualified-close", "Not a fit", "Close without pursuing a meeting.", "Understood. Thank you.", "disqualified", "terminal-policy", [progress("disqualified-close")]);
  if (ABUSE.test(text)) return one("abuse-close", "End respectfully", "Do not pursue a meeting after abuse.", "Understood. Thank you.", "terminal", "terminal-policy", [progress("abuse-close", undefined, true)]);
  if (HARD_INTEGRATION.test(text)) return one("hard-integration-close", "Not a fit", "A required direct CRM/DMS integration disqualifies this workflow.", "Understood. Thank you.", "disqualified", "terminal-policy", [{ type: "capture", field: "disqualification_reason", fact: { value: "Required direct CRM/DMS integration", status: "verified", evidence } }, progress("hard-integration-close")]);
  if (UNSUPPORTED_FIT.test(text)) return one("unsupported-fit-close", "Not a fit", "Do not push a meeting for an unsupported lead workflow.", "Understood. Thank you.", "disqualified", "terminal-policy", [{ type: "capture", field: "disqualification_reason", fact: { value: "Unsupported online inquiry workflow", status: "verified", evidence } }, progress("unsupported-fit-close")]);
  if (REFUSAL.test(normalizeForIntent(text)) && state.substantive_refusal_count >= 1) return one("second-no-close", "Close the call", "Respect the second substantive refusal.", "Understood. Thank you.", "terminal", "terminal-policy", [progress("second-no-close", undefined, true)]);
  if (phase === "GAP_FOUND") return one("workflow-check", "Offer a 15-minute workflow check", "Offer the exact workflow check only after a verified gap.", "Give me 15 minutes, I'll show you how LotLift handles that piece, and you can tell me if it makes sense. Is Tuesday or Thursday better?", "meeting-invitation", "approved-move", [...facts, { type: "phase", phase: "MEETING_ASK" }], undefined, "verified workflow gap");
  if (LOTLIFT_PRODUCT_QUESTION.test(text)) return one("v7-product-answer", "Answer the LotLift product question", "Answer the approved product truth before resuming discovery.", "Basically, we make sure the lead gets a response, somebody owns it, and the customer can move toward an appointment even when your team is busy or the store is closed.", stage, "approved-move", facts, undefined, "exact approved product explanation");
  const intentText = normalizeForIntent(text);
  const canUseColdCallCard = phase === "GATEKEEPER";
  if (canUseColdCallCard && /\b(?:who.?s this|who (?:is|are) this|who are you)\b/.test(intentText)) return one("O2", "Who is this?", "Identify the caller truthfully and wait.", input.approvedRepIdentity ? `This is ${input.approvedRepIdentity} with LotLift.` : "This is LotLift.", "owner-identification", "approved-move", [progress("O2")], undefined, "explicit identity question");
  const coldCallCard = canUseColdCallCard && /\b(?:what.?s this (?:about|regarding)|why (?:are you|did you)(?: call| calling))\b/.test(intentText) ? selectLotLiftColdCallCard(turn, routingState, input.conversation, input.approvedRepIdentity) : null;
  if (coldCallCard?.card.id === "O3") return one("O3", "Purpose and permission", "State the truthful purpose, then learn one workflow fact.", coldCallCard.response, "relevance-discovery", "approved-move", [progress("O3")], undefined, "explicit purpose question");
  if (phase === "MEETING_ASK" && MEETING_ACCEPTANCE.test(text)) return one("terminal-close", "Close after booking", "Confirm the agreed next step and end the call.", "Perfect. I'll send that over. Thanks.", "terminal", "terminal-policy", [...facts, { type: "phase", phase: "TERMINAL" }]);

  const objective = terraObjective(routingState);
  return [move("terra-composition", "Compose the current sales turn", objective.goal, objective.fallback, stage, "approved-move", facts, objective.dimension, "normal finalized prospect turn uses Terra composition")];
}

export function selectLotLiftNextMove(input: LotLiftMoveCandidateInput): LotLiftNextMove { return lotLiftMoveCandidates(input)[0]!; }
