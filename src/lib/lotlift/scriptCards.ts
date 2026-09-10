import type { TranscriptSegment } from "../types";
import type { LotLiftCallState } from "./callState";
import type { LotLiftPlaybookRuleId } from "./playbook";

export type LotLiftScriptCardId = "O0" | "O1" | "O2" | "O3" | "G1" | "D1" | "D3" | "C1" | "C3" | "P2" | "S1" | "L1" | "T1" | "B1" | "V1" | "I1" | "N1" | "N2";

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
// Covers the hedged refusals common in live speech and imperfect STT, not only exact cheat-sheet wording.
const secondNo = /\b(?:not\s+(?:(?:really|that)\s+)?(?:(?:the\s+)?most\s+)?interested|not\s+(?:a\s+)?priority|no\s+thanks|(?:i|we)\s+(?:just\s+)?(?:do\s+not|don't)\s+(?:really\s+)?think\s+(?:we\s+)?need\s+(?:it|this)?)\b/i;

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
    exact_rep_sentence: "“Fair enough. Most stores wouldn’t be looking for another tool. Before I close this out, is that because marketplace inquiries are already consistently covered there, or because that just isn’t a priority right now?”",
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
    exact_rep_sentence: "“That makes sense. I’d expect you to. When an online inquiry comes in, does it go straight into that workflow and get picked up right away, or is there still an inbox or handoff first?”",
    follow_up_sentence: "“Sounds like you have it buttoned up. LotLift probably is not useful there.”",
    objective: "Test for inbox, ownership, or after-hours gaps rather than replace a working CRM.",
    prohibited_claims: "Do not say their CRM is bad or promise CRM replacement/integration.",
    appointment_booking_exit_condition: "Book only if a concrete handoff gap is admitted.",
    owner_approval_required: false,
    playbook_rule_id: "objection:existing-crm",
    matches: (text) => includes(text, /\b(?:crm|bdc|internet department|salespeople handle|already handle)\b/i) && !includes(text, /\b(?:integrat(?:e|ion)|direct (?:crm|dms))\b/i),
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
    exact_rep_sentence: "“I hear you. For the first 50 customers, the basic plan is $20 and everything included is $24.99. Is the concern the price itself, the setup effort, another option, or whether the value is clear?”",
    follow_up_sentence: "“So the real concern is [repeat it]. If we could address that through [a supported scope, success measure, or plan], would anything else stop you from moving forward?”",
    objective: "Isolate the actual concern while giving the approved introductory price.",
    prohibited_claims: "Do not discount before understanding the issue; do not guarantee ROI.",
    appointment_booking_exit_condition: "They identify a solvable, supported concern and accept a scoped review.",
    owner_approval_required: false,
    playbook_rule_id: "objection:no-budget",
    matches: (text) => includes(text, priceConcern),
  },
  {
    id: "S1",
    trigger: "“Send me information.”",
    required_call_context: "Prospect requests email material.",
    exact_rep_sentence: "“Happy to. So I don’t send generic software material, what are you most trying to understand: how it works with your current process, supported lead sources, security, or pricing?”",
    follow_up_sentence: "“After you look at that, would it make sense to spend 15 minutes and decide whether it is relevant?”",
    objective: "Send only relevant material and agree a real follow-up.",
    prohibited_claims: "Do not send generic material without learning what they need or treat sending as a next step.",
    appointment_booking_exit_condition: "A requested topic and follow-up are agreed, or the prospect declines follow-up.",
    owner_approval_required: false,
    playbook_rule_id: "objection:send-information",
    matches: (text) => includes(text, /\b(?:send|email)(?:\s+(?:me|us))?(?:\s+(?:some|more))?(?:\s+(?:info(?:rmation)?|details|a deck|material))?\b/i),
  },
  {
    id: "L1",
    trigger: "“Call me later.”",
    required_call_context: "Prospect asks to defer the conversation.",
    exact_rep_sentence: "“Happy to. What’s changing later that would make this a better conversation?”",
    follow_up_sentence: "“Would Tuesday at 10:30 or Thursday at 2:00 be less disruptive?”",
    objective: "Capture a real trigger and consented next step.",
    prohibited_claims: "Do not create a vague callback without a date, event, or consent.",
    appointment_booking_exit_condition: "A concrete time or trigger is captured, or the call is closed out.",
    owner_approval_required: false,
    playbook_rule_id: "objection:call-later",
    matches: (text) => includes(text, /\b(?:call|try|reach out) (?:me )?(?:back |again )?(?:later|another time)|call back|another time\b/i),
  },
  {
    id: "T1",
    trigger: "“We need to think about it.”",
    required_call_context: "Prospect needs time before deciding.",
    exact_rep_sentence: "“That’s fair. What’s the biggest thing you want to feel certain about before deciding?”",
    follow_up_sentence: "“Other than that concern, is anything else keeping you from a yes?”",
    objective: "Identify the unresolved decision concern.",
    prohibited_claims: "Do not force urgency or pretend uncertainty is resolved.",
    appointment_booking_exit_condition: "The concern and next step are explicit, or the prospect declines.",
    owner_approval_required: false,
    playbook_rule_id: "objection:need-to-think",
    matches: (text) => includes(text, /\b(?:need to think|think (?:about|over) it|sleep on it)\b/i),
  },
  {
    id: "B1",
    trigger: "“I’m busy / I don’t have time.”",
    required_call_context: "Prospect is unavailable now.",
    exact_rep_sentence: "“That’s exactly why I don’t want to pitch you in the middle of it. Is there a calmer 15-minute window this week to map the workflow, or should I close this out for now?”",
    follow_up_sentence: "None — respect the chosen time or close the call.",
    objective: "Respect time while seeking a consented alternative.",
    prohibited_claims: "Do not continue the pitch or assume a callback is welcome.",
    appointment_booking_exit_condition: "A specific window is accepted, or the prospect asks to close out.",
    owner_approval_required: false,
    playbook_rule_id: "objection:busy",
    matches: (text) => includes(text, /\b(?:busy|in (?:the middle of|a meeting)|bad time|(?:do not|don'?t) have time|no time)\b/i),
  },
  {
    id: "V1",
    trigger: "“We’re comparing competitors.”",
    required_call_context: "Prospect is evaluating alternatives.",
    exact_rep_sentence: "“That makes sense. What are you using to compare the options?”",
    follow_up_sentence: "“Where do you see LotLift as stronger or weaker right now?”",
    objective: "Learn criteria and remaining workflow gaps truthfully.",
    prohibited_claims: "Do not conceal limitations or make unsupported competitor claims.",
    appointment_booking_exit_condition: "Criteria and a relevant gap are identified, or the existing solution fully covers the need.",
    owner_approval_required: false,
    playbook_rule_id: "objection:competitor",
    matches: (text) => includes(text, /\b(?:comparing (?:competitors|options)|evaluate(?:ing)? (?:vendors|options)|another vendor)\b/i),
  },
  {
    id: "I1",
    trigger: "“Do you integrate with our CRM or DMS?”",
    required_call_context: "Prospect asks whether direct integration is available.",
    exact_rep_sentence: "“Today, LotLift isn’t a CRM or DMS integration. It works around approved inbox lead flows and appointment workflow. Is direct CRM/DMS integration a hard requirement, or are you trying to solve a specific handoff issue?”",
    follow_up_sentence: "If direct integration is required, I should not pretend this is the right fit.",
    objective: "State the current limitation and disqualify cleanly if required.",
    prohibited_claims: "Do not imply unsupported integration or future commitments.",
    appointment_booking_exit_condition: "Direct integration is not required, or the prospect is disqualified.",
    owner_approval_required: false,
    playbook_rule_id: "objection:direct-integration",
    matches: (text) => includes(text, /\b(?:integrat(?:e|ion)|direct (?:crm|dms))\b/i) && includes(text, /\b(?:crm|dms)\b/i),
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
    exact_rep_sentence: "“Good, if it’s working, you should keep it. What are you using today to make sure paid online inquiries don’t sit unworked?”",
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
