import type { TranscriptSegment } from "../types";
import { deriveLotLiftConversationStage, type LotLiftCallState, type LotLiftFieldValue } from "./callState";
import { retrieveApprovedLotLiftResponse } from "./objections";
import { lotLiftPlaybookRule, type LotLiftPlaybookRuleId } from "./playbook";
import { LOTLIFT_COLD_CALL_POLICIES, coldCallStage, type LotLiftApprovedCallContext, type LotLiftColdCallStage } from "./turnEngine";

const RECENT_WINDOW_MS = 90_000;
const MAX_DURABLE_FACTS = 14;
const MAX_PREVIOUS_OBJECTIONS = 4;
const MAX_RECENT_DIALOGUE = 12;
const MAX_PRODUCT_FACTS = 8;
const MAX_TEXT_CHARS = 500;

export type LotLiftCallStage = "discovery" | "qualification" | "objection" | "close";

export type ContextPackFact = {
  field: string;
  value: string;
  status: LotLiftFieldValue<string>["status"];
  evidence_segment_id: string | null;
};

export type ContextPackObjection = {
  rule_id: LotLiftPlaybookRuleId | null;
  objection: string;
  prospect_text: string;
  rep_response: string | null;
  occurrences: number;
  at_ms: number | null;
};

export type LotLiftApprovedProductFact = { id: string; statement: string };

export type LotLiftStakeholderContext = {
  owner: ContextPackFact[];
  authority: ContextPackFact[];
  decision_stakeholders: ContextPackFact[];
  decision_blockers: ContextPackFact[];
};

export type LotLiftCompositionPayload = {
  composition_version: 2;
  /** Retained locally for validation/audit; never blindly put in the model prompt. */
  full_transcript: TranscriptSegment[];
  latest_prospect_turn: Pick<TranscriptSegment, "id" | "text">;
  recent_dialogue: Array<Pick<TranscriptSegment, "id" | "source" | "text">>;
  relevant_earlier_evidence: Array<Pick<TranscriptSegment, "id" | "source" | "text">>;
  durable_facts: ContextPackFact[];
  prior_objections: ContextPackObjection[];
  stakeholder_context: LotLiftStakeholderContext;
  sales_script_stage: { conversation_stage: import("./callState").LotLiftConversationStage; cold_call_stage: LotLiftColdCallStage };
  approved_objection_card: { id: string; rule_id: LotLiftPlaybookRuleId } | null;
  allowed_product_facts: LotLiftApprovedProductFact[];
};

export type LotLiftContextPack = {
  current_stage: LotLiftCallStage;
  cold_call_stage: LotLiftColdCallStage;
  approved_call_context: LotLiftApprovedCallContext;
  eligible_cold_call_cards: string[];
  durable_facts: ContextPackFact[];
  recent_dialogue: Array<Pick<TranscriptSegment, "id" | "source" | "startMs" | "endMs" | "text">>;
  previous_objections: ContextPackObjection[];
  approved_product_facts: LotLiftApprovedProductFact[];
  playbook_rules: Array<{
    id: LotLiftPlaybookRuleId;
    intent: string;
    objective: string;
    approved_strategy: string;
    prohibited_behavior: string;
    good_examples: string[];
  }>;
};

function boundedText(text: string, limit = MAX_TEXT_CHARS): string {
  return text.trim().slice(0, limit);
}

function values(field: string, facts: readonly LotLiftFieldValue<string>[]): ContextPackFact[] {
  return facts.flatMap((fact) => fact.value ? [{ field, value: boundedText(fact.value, 160), status: fact.status, evidence_segment_id: fact.evidence?.segment_id ?? null }] : []);
}

export function lotLiftDurableFacts(state: LotLiftCallState): ContextPackFact[] {
  const scalarFields = ["current_solution", "authority", "stated_readiness", "urgency", "next_action", "renewal_date", "lead_arrival_point", "workflow_owner", "after_hours_process", "visibility_process"] as const;
  const listFields = ["pain_points", "quantified_pain", "decision_stakeholders", "stakeholders", "decision_blockers", "commitments", "buying_signals", "prior_answers", "open_questions"] as const;
  return [
    ...scalarFields.flatMap((field) => values(field, [state[field]])),
    ...listFields.flatMap((field) => values(field, state[field])),
  ].slice(0, MAX_DURABLE_FACTS);
}

function recentDialogue(conversation: readonly TranscriptSegment[], turn: TranscriptSegment): LotLiftContextPack["recent_dialogue"] {
  const endMs = turn.endMs;
  return conversation
    .filter((segment) => segment.isFinal && segment.endMs >= endMs - RECENT_WINDOW_MS && segment.endMs <= endMs)
    .slice(-MAX_RECENT_DIALOGUE)
    .map(({ id, source, startMs, endMs: segmentEndMs, text }) => ({ id, source, startMs, endMs: segmentEndMs, text: boundedText(text) }));
}

export function lotLiftPriorObjections(state: LotLiftCallState, conversation: readonly TranscriptSegment[], turn: TranscriptSegment): ContextPackObjection[] {
  const finalized = conversation.filter((segment) => segment.isFinal);
  const prospects = finalized.filter((segment) => segment.source === "them" && segment.id !== turn.id);
  const priorLines: string[] = [];
  const transcriptObjections = prospects.flatMap((segment, index) => {
    const route = retrieveApprovedLotLiftResponse(segment.text, priorLines);
    priorLines.push(segment.text);
    if (!route) return [];
    const nextProspect = prospects[index + 1];
    const response = finalized.find((item) => item.source === "me" && item.startMs >= segment.endMs && (!nextProspect || item.endMs <= nextProspect.startMs));
    return [{ rule_id: route.rule_id, objection: route.id, prospect_text: boundedText(segment.text), rep_response: response ? boundedText(response.text) : null, occurrences: 1, at_ms: segment.endMs }];
  });
  const evidenceIds = new Set(prospects.map((segment) => segment.id));
  const durableObjections = state.recurring_objections.flatMap((objection) => {
    if (!objection.value || !objection.evidence || evidenceIds.has(objection.evidence.segment_id)) return [];
    return [{ rule_id: null, objection: boundedText(objection.value, 160), prospect_text: boundedText(objection.evidence.text), rep_response: null, occurrences: objection.count, at_ms: null }];
  });
  return [...durableObjections, ...transcriptObjections].slice(-MAX_PREVIOUS_OBJECTIONS);
}

function callStage(state: LotLiftCallState, turn: TranscriptSegment): LotLiftCallStage {
  if (retrieveApprovedLotLiftResponse(turn.text)) return "objection";
  if (state.commitments.some((fact) => fact.value) || state.next_action.value || state.stated_readiness.value) return "close";
  if (state.current_solution.value || state.pain_points.some((fact) => fact.value) || state.authority.value) return "qualification";
  return "discovery";
}

/** Selects bounded, decision-relevant evidence instead of sending an ever-growing transcript. */
export function buildLotLiftContextPack(
  state: LotLiftCallState,
  turn: TranscriptSegment,
  conversation: readonly TranscriptSegment[],
  ruleIds: readonly LotLiftPlaybookRuleId[],
  approvedProductFacts: readonly LotLiftApprovedProductFact[] = [],
  approvedCallContext: LotLiftApprovedCallContext = { representativeName: null, firstName: null, dealership: null },
): LotLiftContextPack {
  const playbookRules = ruleIds.slice(0, 3).map((id) => {
    const rule = lotLiftPlaybookRule(id);
    return {
      id,
      intent: rule.intent,
      objective: rule.objective,
      approved_strategy: rule.approved_strategy,
      prohibited_behavior: rule.prohibited_behavior,
      good_examples: rule.good_examples,
    };
  });
  return {
    current_stage: callStage(state, turn),
    cold_call_stage: coldCallStage(conversation),
    approved_call_context: approvedCallContext,
    eligible_cold_call_cards: LOTLIFT_COLD_CALL_POLICIES.filter((policy) => policy.permitted_prior_stages.includes(coldCallStage(conversation))).map((policy) => policy.card_id).slice(0, 8),
    durable_facts: lotLiftDurableFacts(state),
    recent_dialogue: recentDialogue(conversation, turn),
    previous_objections: lotLiftPriorObjections(state, conversation, turn),
    approved_product_facts: approvedProductFacts.slice(0, MAX_PRODUCT_FACTS).map(({ id, statement }) => ({ id, statement: boundedText(statement) })),
    playbook_rules: playbookRules,
  };
}

function fullTranscript(conversation: readonly TranscriptSegment[]): LotLiftCompositionPayload["full_transcript"] {
  return conversation.filter((segment) => segment.isFinal).map((segment) => ({ ...segment }));
}

/** Exact prospect evidence referenced by durable memory, plus the earlier objection turn. */
function relevantEarlierEvidence(state: LotLiftCallState, turn: TranscriptSegment, conversation: readonly TranscriptSegment[]): LotLiftCompositionPayload["relevant_earlier_evidence"] {
  const ids = new Set(lotLiftDurableFacts(state).map((fact) => fact.evidence_segment_id).filter((id): id is string => Boolean(id)));
  const text = turn.text.toLowerCase();
  if (/price|cost|budget|expensive/.test(text)) {
    for (const fact of [...state.pain_points, ...state.decision_stakeholders, ...state.decision_blockers, state.after_hours_process, state.current_solution]) {
      if (fact.evidence?.segment_id) ids.add(fact.evidence.segment_id);
    }
  }
  return conversation.filter((segment) => segment.isFinal && segment.source === "them" && segment.id !== turn.id && ids.has(segment.id)).slice(-8).map(({ id, source, text: evidenceText }) => ({ id, source, text: boundedText(evidenceText) }));
}

function stakeholderContext(state: LotLiftCallState): LotLiftStakeholderContext {
  return {
    owner: values("workflow_owner", [state.workflow_owner]),
    authority: values("authority", [state.authority]),
    decision_stakeholders: values("decision_stakeholders", state.decision_stakeholders),
    decision_blockers: values("decision_blockers", state.decision_blockers),
  };
}

/** Full, role-aware composition payload. Limits are detected by the composer; this never truncates. */
export function buildLotLiftCompositionPayload(
  state: LotLiftCallState,
  turn: TranscriptSegment,
  conversation: readonly TranscriptSegment[],
  ruleIds: readonly LotLiftPlaybookRuleId[],
  approvedProductFacts: readonly LotLiftApprovedProductFact[] = [],
  _approvedCallContext: LotLiftApprovedCallContext = { representativeName: null, firstName: null, dealership: null },
): LotLiftCompositionPayload {
  const route = retrieveApprovedLotLiftResponse(turn.text);
  const transcript = fullTranscript(conversation);
  const context = buildLotLiftContextPack(state, turn, transcript, ruleIds, approvedProductFacts, _approvedCallContext);
  return {
    composition_version: 2,
    full_transcript: transcript,
    latest_prospect_turn: { id: turn.id, text: boundedText(turn.text) },
    recent_dialogue: context.recent_dialogue.map(({ id, source, text }) => ({ id, source, text })),
    relevant_earlier_evidence: relevantEarlierEvidence(state, turn, transcript),
    durable_facts: lotLiftDurableFacts(state).slice(0, MAX_DURABLE_FACTS),
    prior_objections: lotLiftPriorObjections(state, conversation, turn).slice(-MAX_PREVIOUS_OBJECTIONS),
    stakeholder_context: stakeholderContext(state),
    sales_script_stage: { conversation_stage: deriveLotLiftConversationStage(state), cold_call_stage: coldCallStage(conversation) },
    approved_objection_card: route && ruleIds.includes(route.rule_id) ? { id: route.id, rule_id: route.rule_id } : null,
    allowed_product_facts: approvedProductFacts.slice(0, MAX_PRODUCT_FACTS).map(({ id, statement }) => ({ id, statement: boundedText(statement) })),
  };
}
