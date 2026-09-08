import type { TranscriptSegment } from "../types";
import type { LotLiftCallState } from "./callState";
import type { LotLiftPlaybookRuleId } from "./playbook";

export type LotLiftScriptCardId = "G1" | "D1" | "D3" | "C1" | "C3" | "P2" | "N1" | "N2";

export interface LotLiftScriptCard {
  id: LotLiftScriptCardId;
  trigger: string;
  required_call_context: string;
  exact_rep_sentence: string;
  follow_up_sentence: string;
  objective: string;
  prohibited_claims: string;
  appointment_booking_exit_condition: string;
  owner_approval_required: false;
  playbook_rule_id: LotLiftPlaybookRuleId;
  matches: (text: string, state: LotLiftCallState) => boolean;
}

const includes = (text: string, pattern: RegExp) => pattern.test(text);
const priceConcern = /\b(?:too expensive|too much money|no budget|can't afford|cannot afford|costs? too much)\b/i;
const secondNo = /\b(?:not interested|not a priority|no thanks)\b/i;

/**
 * Exact approved, non-owner-blocked cards from the review inventory. Cards that
 * require owner approval are deliberately absent, so they cannot display live.
 */
export const LOTLIFT_SCRIPT_CARDS: readonly LotLiftScriptCard[] = [
  {
    id: "G1",
    trigger: "“What is this regarding?”",
    required_call_context: "You are speaking to a gatekeeper; the process owner and configured rep name are available.",
    exact_rep_sentence: "“It’s about how the dealership covers paid online inquiries from marketplace listings. Could you let [process owner name] know [configured rep name] from LotLift called?”",
    follow_up_sentence: "“Is [process owner name] the owner of that process, or is there an internet-sales or sales manager I should speak with?”",
    objective: "Reach or correctly identify the owner, GM, sales manager, internet manager, or BDC manager.",
    prohibited_claims: "Do not say [process owner name] told you to call, that it is personal, that you are returning a call, or that this is not a sales call.",
    appointment_booking_exit_condition: "The process owner agrees to a specific 15-minute workflow call; otherwise record the correct owner or exit.",
    owner_approval_required: false,
    playbook_rule_id: "discovery:ownership",
    matches: (text) => includes(text, /what is this (?:about|regarding)/i),
  },
  {
    id: "D1",
    trigger: "“We’re not interested.”",
    required_call_context: "Decision-maker has made a reflex/brush-off statement; no known fit conclusion.",
    exact_rep_sentence: "“Fair enough. Most stores would not be looking for another tool. Before I close this out, is that because marketplace inquiries are already consistently covered there, or because that just is not a priority right now?”",
    follow_up_sentence: "“What would have to happen for lead-response coverage to become worth revisiting?”",
    objective: "Distinguish strong coverage from low priority or disqualify.",
    prohibited_claims: "Do not argue, pitch more features, or treat a reflex answer as proof of a problem.",
    appointment_booking_exit_condition: "Book only if a real coverage gap or future trigger is stated; otherwise close professionally.",
    owner_approval_required: false,
    playbook_rule_id: "objection:not-interested",
    matches: (text) => includes(text, secondNo) && !includes(text, priceConcern),
  },
  {
    id: "D3",
    trigger: "“We don’t get enough leads for this” or “We don’t use Cars.com / CarGurus / AutoTrader.”",
    required_call_context: "Lead volume or supported inbound source is unknown.",
    exact_rep_sentence: "“That may mean LotLift is not worth adding. Roughly how many paid online inquiries do you get in a normal month?”",
    follow_up_sentence: "“Which online sources generate most buyer inquiries, if any?”",
    objective: "Disqualify low-volume or unsupported workflows quickly.",
    prohibited_claims: "Do not force a sale or claim an unsupported source works.",
    appointment_booking_exit_condition: "Book only when an approved, meaningful source and a plausible coverage problem exist.",
    owner_approval_required: false,
    playbook_rule_id: "discovery:lead-source",
    matches: (text) => includes(text, /\b(?:don't|do not) get enough leads|\b(?:don't|do not) use (?:cars\.com|cargurus|autotrader)\b/i),
  },
  {
    id: "C1",
    trigger: "“We already have a CRM.”",
    required_call_context: "CRM is named or claimed; no verified workflow gap.",
    exact_rep_sentence: "“That makes sense. I would expect you to. When an online inquiry arrives, does it land directly in that workflow and get owned immediately, or is there still an inbox and handoff before it is worked?”",
    follow_up_sentence: "“Sounds like you have it buttoned up. LotLift probably is not useful there.”",
    objective: "Test for inbox, ownership, or after-hours gaps rather than replace a working CRM.",
    prohibited_claims: "Do not say their CRM is bad or promise CRM replacement/integration.",
    appointment_booking_exit_condition: "Book only if a concrete handoff gap is admitted.",
    owner_approval_required: false,
    playbook_rule_id: "objection:existing-crm",
    matches: (text) => includes(text, /\b(?:crm|bdc|internet department|salespeople handle|already handle)\b/i),
  },
  {
    id: "C3",
    trigger: "“We already use [competitor]” or “We tried something like this and it didn’t work.”",
    required_call_context: "Existing tool or prior failure is acknowledged.",
    exact_rep_sentence: "“Got it. What made you choose them, and what does that process handle well for you?”",
    follow_up_sentence: "“Is there anything the team still has to do manually around lead routing, after-hours response, or appointments?”",
    objective: "Learn actual requirements and leave a no-gap account alone.",
    prohibited_claims: "Do not conceal limitations or claim LotLift differs without approved evidence.",
    appointment_booking_exit_condition: "A meaningful manual or coverage gap worth mapping.",
    owner_approval_required: false,
    playbook_rule_id: "discovery:visibility",
    matches: (text) => includes(text, /\b(?:already use|tried something like this|tried a similar)\b/i),
  },
  {
    id: "P2",
    trigger: "“It’s too expensive” or “No budget.”",
    required_call_context: "A concern has been stated but not isolated.",
    exact_rep_sentence: "“I can see why you would want to be careful about another tool. When you say expensive, is the issue the monthly number itself, the setup effort, comparison with another option, or that the return is not clear enough?”",
    follow_up_sentence: "“So the real concern is [repeat it]. If we could address that through [a supported scope, success measure, or plan], would anything else stop you from moving forward?”",
    objective: "Isolate the real concern before discussing a supported scope.",
    prohibited_claims: "Do not discount before understanding the issue; do not guarantee ROI.",
    appointment_booking_exit_condition: "They identify a solvable, supported concern and accept a scoped review.",
    owner_approval_required: false,
    playbook_rule_id: "objection:no-budget",
    matches: (text) => includes(text, priceConcern),
  },
  {
    id: "N1",
    trigger: "A second substantive no after one clarification attempt.",
    required_call_context: "The prospect has already declined and has not invited more discussion.",
    exact_rep_sentence: "“Understood. I’ll leave it there. Thanks for your time.”",
    follow_up_sentence: "None — end the call immediately.",
    objective: "Respect the refusal and end professionally.",
    prohibited_claims: "Do not ask another question, offer a checklist, manufacture urgency, or schedule a callback.",
    appointment_booking_exit_condition: "None — immediately end the call.",
    owner_approval_required: false,
    playbook_rule_id: "objection:not-interested",
    matches: (text, state) => includes(text, secondNo)
      && state.recurring_objections.some((fact) => fact.value === "D1" || fact.value?.toLowerCase().includes("not interested")),
  },
  {
    id: "N2",
    trigger: "“We’re happy with what we have.”",
    required_call_context: "This is the first substantive refusal; no second no or opt-out was made.",
    exact_rep_sentence: "“Good—if it is working, you should keep it. What are you using today to make sure paid online inquiries do not sit unworked?”",
    follow_up_sentence: "“Would it be useful to talk through after-hours and ownership, or are you comfortable leaving it as-is?”",
    objective: "Learn one fact only if welcomed; otherwise exit gracefully.",
    prohibited_claims: "Do not badmouth their process, press after a second no, or manufacture urgency.",
    appointment_booking_exit_condition: "Only book if they explicitly request a further workflow discussion; otherwise close the call.",
    owner_approval_required: false,
    playbook_rule_id: "objection:existing-crm",
    matches: (text) => includes(text, /\b(?:happy with|working well|works fine)\b/i),
  },
] as const;

const BLOCKED_LIVE_TACTICS = /\b(?:wife|husband|spouse|partner|take (?:me|us) off|do not call|don't call|book|schedule|tuesday|thursday)\b/i;

/** One exact non-owner-blocked card, or no suggestion when context is unsafe or absent. */
export function selectLotLiftScriptCard(turn: TranscriptSegment, state: LotLiftCallState): LotLiftScriptCard | null {
  if (turn.source !== "them" || !turn.isFinal || BLOCKED_LIVE_TACTICS.test(turn.text)) return null;
  const secondRefusal = LOTLIFT_SCRIPT_CARDS.find((card) => card.id === "N1");
  if (secondRefusal?.matches(turn.text, state)) return secondRefusal;
  return LOTLIFT_SCRIPT_CARDS.find((card) => card.id !== "N1" && card.matches(turn.text, state)) ?? null;
}

const PLACEHOLDER = /\[([^\]]+)\]/g;
const safeConfiguredValue = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && !/[\[\]\r\n]/.test(trimmed) ? trimmed : null;
};

/** Resolves only configured identity and verified durable facts; unknown variables fail closed. */
export function renderLotLiftScriptCard(card: LotLiftScriptCard, state: LotLiftCallState, approvedRepIdentity: string | null | undefined): string | null {
  const processOwner = state.stakeholders.find((fact) => fact.status === "verified" && fact.evidence && safeConfiguredValue(fact.value));
  const variables: Record<string, string | null> = {
    "configured rep name": safeConfiguredValue(approvedRepIdentity),
    "process owner name": processOwner ? safeConfiguredValue(processOwner.value) : null,
  };
  let missing = false;
  const rendered = card.exact_rep_sentence.replace(PLACEHOLDER, (_, variable: string) => {
    const value = variables[variable];
    if (!value) missing = true;
    return value ?? "";
  });
  return missing || /\[[^\]]+\]/.test(rendered) ? null : rendered;
}
