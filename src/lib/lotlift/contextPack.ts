import type { TranscriptSegment } from "../types";
import type { LotLiftCallState, LotLiftFieldValue } from "./callState";
import { retrieveApprovedLotLiftResponse } from "./objections";
import { lotLiftPlaybookRule, type LotLiftPlaybookRuleId } from "./playbook";

const RECENT_WINDOW_MS = 90_000;
const MAX_DURABLE_FACTS = 14;
const MAX_PREVIOUS_OBJECTIONS = 4;
const MAX_TEXT_CHARS = 500;

export type LotLiftCallStage = "discovery" | "qualification" | "objection" | "close";

type ContextPackFact = {
  field: string;
  value: string;
  status: LotLiftFieldValue<string>["status"];
};

type ContextPackObjection = {
  rule_id: LotLiftPlaybookRuleId | null;
  objection: string;
  prospect_text: string;
  rep_response: string | null;
  occurrences: number;
  at_ms: number | null;
};

export type LotLiftApprovedProductFact = { id: string; statement: string };

export type LotLiftContextPack = {
  current_stage: LotLiftCallStage;
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
  return facts.flatMap((fact) => fact.value ? [{ field, value: boundedText(fact.value, 160), status: fact.status }] : []);
}

function durableFacts(state: LotLiftCallState): ContextPackFact[] {
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
    .map(({ id, source, startMs, endMs: segmentEndMs, text }) => ({ id, source, startMs, endMs: segmentEndMs, text: boundedText(text) }));
}

function priorObjections(state: LotLiftCallState, conversation: readonly TranscriptSegment[], turn: TranscriptSegment): ContextPackObjection[] {
  const finalized = conversation.filter((segment) => segment.isFinal);
  const prospects = finalized.filter((segment) => segment.source === "them" && segment.id !== turn.id);
  const transcriptObjections = prospects.flatMap((segment) => {
    const priorLines = prospects.filter((item) => item.endMs < segment.endMs).map((item) => item.text);
    const route = retrieveApprovedLotLiftResponse(segment.text, priorLines);
    if (!route) return [];
    const nextProspect = prospects.find((item) => item.startMs > segment.endMs);
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
    durable_facts: durableFacts(state),
    recent_dialogue: recentDialogue(conversation, turn),
    previous_objections: priorObjections(state, conversation, turn),
    approved_product_facts: approvedProductFacts.map(({ id, statement }) => ({ id, statement: boundedText(statement) })),
    playbook_rules: playbookRules,
  };
}
