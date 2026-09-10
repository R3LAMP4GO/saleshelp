import type { TranscriptSegment } from "../types";
import type { LotLiftCallState } from "./callState";
import type { LotLiftPlaybookRuleId } from "./playbook";
import type { LotLiftScriptCard } from "./scriptCards";

export type LotLiftColdCallIntent = "greeting" | "identity" | "purpose" | "permission" | "brush-off" | "ownership" | "discovery" | "objection" | "stakeholder" | "scheduling";
export type LotLiftColdCallStage = "opening" | "discovery" | "qualification" | "close" | "terminal";

export type LotLiftApprovedCallContext = Readonly<{
  representativeName: string | null | undefined;
  firstName: string | null | undefined;
  dealership: string | null | undefined;
}>;

export type LotLiftColdCallPolicy = Readonly<{
  intent: LotLiftColdCallIntent;
  stage: LotLiftColdCallStage;
  card_id: string;
  playbook_rule_id: LotLiftPlaybookRuleId;
  permitted_prior_stages: readonly LotLiftColdCallStage[];
}>;

const safeValue = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && !/[\[\]\r\n]/.test(trimmed) ? trimmed : null;
};

export const LOTLIFT_COLD_CALL_POLICIES: readonly LotLiftColdCallPolicy[] = [
  { intent: "greeting", stage: "opening", card_id: "O1", playbook_rule_id: "discovery:ownership", permitted_prior_stages: ["opening"] },
  { intent: "identity", stage: "opening", card_id: "O2", playbook_rule_id: "discovery:ownership", permitted_prior_stages: ["opening"] },
  { intent: "purpose", stage: "opening", card_id: "O3", playbook_rule_id: "discovery:lead-source", permitted_prior_stages: ["opening"] },
  { intent: "permission", stage: "opening", card_id: "O3", playbook_rule_id: "discovery:lead-source", permitted_prior_stages: ["opening"] },
  { intent: "brush-off", stage: "opening", card_id: "D1", playbook_rule_id: "objection:not-interested", permitted_prior_stages: ["opening", "discovery", "qualification"] },
  { intent: "ownership", stage: "discovery", card_id: "G1", playbook_rule_id: "discovery:ownership", permitted_prior_stages: ["opening", "discovery"] },
  { intent: "discovery", stage: "discovery", card_id: "C1", playbook_rule_id: "discovery:lead-source", permitted_prior_stages: ["discovery"] },
  { intent: "objection", stage: "discovery", card_id: "D1", playbook_rule_id: "objection:not-interested", permitted_prior_stages: ["opening", "discovery", "qualification"] },
  { intent: "stakeholder", stage: "qualification", card_id: "G1", playbook_rule_id: "qualification:pain", permitted_prior_stages: ["qualification"] },
  { intent: "scheduling", stage: "close", card_id: "S1", playbook_rule_id: "qualification:pain", permitted_prior_stages: ["close"] },
] as const;

const card = (id: string, trigger: string, sentence: string, objective: string, rule: LotLiftPlaybookRuleId): LotLiftScriptCard => ({
  id: id as LotLiftScriptCard["id"], trigger, required_call_context: "Verified configured call context.", exact_rep_sentence: sentence, follow_up_sentence: "None — wait for the prospect.", objective, prohibited_claims: "Do not invent context or continue without a response.", appointment_booking_exit_condition: "Wait for a substantive response.", owner_approval_required: false, playbook_rule_id: rule, matches: () => false,
});

export const LOTLIFT_COLD_CALL_CARDS = [
  card("O0", "Greeting / permission", "“Hi—this is LotLift. I’m calling about how paid online inquiries are handled. Do you have 30 seconds for one quick question?”", "Earn permission without claiming unverified identity or dealership context.", "discovery:ownership"),
  card("O1", "Greeting", "“Hey [first name]—it’s [configured rep name], founder of LotLift. I was looking at [dealership]’s used inventory on Cars.com, CarGurus, or AutoTrader. I’ll be straight with you, this is a cold call, but it’s a specific one. Can I take 30 seconds to tell you why I called?”", "Earn permission to ask one discovery question.", "discovery:ownership"),
  card("O2", "Who is this?", "“It’s [configured rep name], founder of LotLift.”", "Identify the caller truthfully and wait for their purpose question.", "discovery:ownership"),
  card("O3", "Purpose / permission", "“The pattern I’m trying to understand is this: a shopper sends a paid online inquiry late in the day, it lands in the shared inbox or gets handed around, everybody assumes somebody else has it, and by the next morning that shopper has messaged a few other stores. I’m not saying that happens at [dealership]—I do not know your process yet. LotLift is built to help independent dealers create a coverage workflow around approved inbound lead sources, so the team can see who owns the lead and move it into a consistent response and appointment process. Is that a process you feel really confident in today?”", "Learn one workflow fact; do not schedule yet.", "discovery:lead-source"),
] as const;

function contextFromState(state: LotLiftCallState, representativeName: string | null | undefined): LotLiftApprovedCallContext {
  return {
    representativeName,
    firstName: state.contact_name.status === "verified" ? state.contact_name.value : null,
    dealership: state.dealership.status === "verified" ? state.dealership.value : null,
  };
}

export function renderLotLiftColdCallCard(cardToRender: LotLiftScriptCard, context: LotLiftApprovedCallContext): string | null {
  const values: Record<string, string | null> = {
    "configured rep name": safeValue(context.representativeName),
    "first name": safeValue(context.firstName),
    dealership: safeValue(context.dealership),
  };
  let missing = false;
  const rendered = cardToRender.exact_rep_sentence.replace(/\[([^\]]+)\]/g, (_, key: string) => {
    const value = values[key];
    if (!value) missing = true;
    return value ?? "";
  });
  return missing ? null : rendered;
}

export function coldCallStage(conversation: readonly TranscriptSegment[]): LotLiftColdCallStage {
  const repText = conversation.filter((segment) => segment.source === "me" && segment.isFinal).map((segment) => segment.text).join(" ");
  if (/lead-response workflow check|would Tuesday morning or Thursday afternoon/i.test(repText)) return "close";
  if (/pattern I’m trying to understand|pattern i'm trying to understand/i.test(repText)) return "discovery";
  return "opening";
}

export function selectLotLiftColdCallCard(turn: TranscriptSegment, state: LotLiftCallState, conversation: readonly TranscriptSegment[], approvedRepIdentity: string | null | undefined): { card: LotLiftScriptCard; intent: LotLiftColdCallIntent; stage: LotLiftColdCallStage; response: string } | null {
  if (turn.source !== "them" || !turn.isFinal) return null;
  const text = turn.text.trim();
  const stage = coldCallStage(conversation);
  const context = contextFromState(state, approvedRepIdentity);
  const choose = (id: "O0" | "O1" | "O2" | "O3", intent: LotLiftColdCallIntent) => {
    const selected = LOTLIFT_COLD_CALL_CARDS.find((candidate) => candidate.id === id)!;
    const response = renderLotLiftColdCallCard(selected, context);
    return response ? { card: selected, intent, stage, response } : null;
  };
  const contextualOrDefault = (id: "O1" | "O2" | "O3", intent: LotLiftColdCallIntent) => choose(id, intent) ?? choose("O0", intent);
  if (/^(?:hello|hi|hey|good (?:morning|afternoon))\b[!. ]*$/i.test(text)) return contextualOrDefault("O1", "greeting");
  if (/\b(?:who (?:is|are) this|who's this)\b/i.test(text)) return contextualOrDefault("O2", "identity");
  if (/\b(?:what(?:['’]s| is) this about|why (?:are you|did you) call)\b/i.test(text)) return contextualOrDefault("O3", "purpose");
  if (/\bhow can I help\b/i.test(text)) return contextualOrDefault("O3", "purpose");
  if (/\b(?:yes|sure|go ahead|you have (?:30|thirty) seconds)\b/i.test(text) && stage === "opening") return contextualOrDefault("O3", "permission");
  return null;
}
