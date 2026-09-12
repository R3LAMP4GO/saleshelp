import type { TranscriptSegment } from "../types";
import type { MethodologyFramework } from "../sales/knowledge";
import type { ResolvedSalesProfile, SalesProfileMoveTurnStrategy } from "../sales/profiles";
import type { LotLiftCallState } from "./callState";
import type { LotLiftMoveCandidate } from "./nextMove";

export interface LotLiftTurnDirective {
  objective: string;
  approach: readonly string[];
  avoid: readonly string[];
  relevant_call_evidence: readonly { segment_id: string; text: string }[];
  desired_progression: string;
  max_questions: 1;
  methodology_framework_id?: string;
}

const GENERIC_APPROACH = ["Acknowledge the concern.", "Clarify what they mean with one diagnostic question.", "Do not pitch before understanding the concern."] as const;
const FRAMEWORK_APPROACH: Record<string, readonly string[]> = {
  "ledge-disrupt-ask": ["Acknowledge briefly and respectfully.", "Ask one small, natural next question."],
  "reflex-or-real": ["Use one question to distinguish a brush-off from a concrete constraint.", "Respect a further refusal."],
  "disarm-and-diagnose": ["Acknowledge the specific concern without defending the product.", "Ask one short diagnostic question."],
  "situational-price": ["Connect price to verified pain only when it helps clarify the concern.", "Distinguish value, timing, setup effort, or affordability without debating price."],
  "busy-as-bandwidth": ["Acknowledge the workload.", "Clarify whether the concern is timing, staffing, or workflow change effort."],
  "existing-solution": ["Respect the current solution.", "Use one verified workflow gap and let the prospect explain it."],
};

function profileStrategy(profile: ResolvedSalesProfile | undefined, moveId: string): SalesProfileMoveTurnStrategy | null {
  return profile?.behavior.moves.find((move) => move.id === moveId)?.turnStrategy ?? null;
}

function novelApproach(turn: TranscriptSegment): readonly string[] | null {
  if (/spying|monitor(?:ing)?|watching\s+(?:my|the)\s+(?:staff|team|sales)/i.test(turn.text)) return ["Acknowledge the specific trust concern.", "Do not defend the product yet.", "Distinguish trust or perception from workflow burden with one diagnostic question."];
  if (/tried|nobody used|didn['’]t use|did not use/i.test(turn.text)) return ["Acknowledge the prior attempt.", "Ask what made adoption fail: workflow burden, ownership, or team behavior.", "Do not claim this product is different yet."];
  return null;
}

function evidence(state: LotLiftCallState, turn: TranscriptSegment): readonly { segment_id: string; text: string }[] {
  const values = [state.current_solution, state.after_hours_process, ...state.pain_points].flatMap((fact) =>
    fact.value && fact.evidence?.segment_id ? [{ segment_id: fact.evidence.segment_id, text: fact.evidence.text.slice(0, 160) }] : []
  );
  if (!values.some((item) => item.segment_id === turn.id)) values.push({ segment_id: turn.id, text: turn.text.slice(0, 160) });
  return Object.freeze(values.slice(0, 4));
}

/** Deterministically compiles profile strategy plus, only when needed, one framework into model-ready behavior. */
export function buildLotLiftTurnDirective(input: { state: LotLiftCallState; turn: TranscriptSegment; candidate: LotLiftMoveCandidate; resolvedProfile?: ResolvedSalesProfile; framework?: Pick<MethodologyFramework, "id"> | null }): LotLiftTurnDirective {
  const strategy = profileStrategy(input.resolvedProfile, input.candidate.id);
  const framework = strategy ? null : input.framework ?? null;
  const approach = strategy?.approach ?? novelApproach(input.turn) ?? (framework ? FRAMEWORK_APPROACH[framework.id] ?? GENERIC_APPROACH : GENERIC_APPROACH);
  const avoid = strategy?.avoid ?? ["Do not invent product capabilities or prospect facts.", "Do not feature dump or argue."];
  const contextual = input.candidate.id === "contextual-response";
  return Object.freeze({
    objective: strategy?.objective ?? input.candidate.goal,
    approach: Object.freeze(contextual ? [...approach, "DISARM: acknowledge the latest prospect point directly.", "UNDERSTAND: use cited current-turn and verified call context without treating it as a new question.", "ADVANCE: give the smallest truthful answer or limitation before one useful follow-up toward the active objective."] : [...approach]),
    avoid: Object.freeze(contextual ? [...avoid, "Do not re-ask verified ownership, CRM, after-hours, or authority details."] : [...avoid]),
    relevant_call_evidence: evidence(input.state, input.turn),
    desired_progression: strategy?.desiredProgression ?? "Understand the concern before advancing the call.",
    max_questions: 1,
    ...(framework ? { methodology_framework_id: framework.id } : {}),
  });
}

export function moveHasGuidedTurnStrategy(profile: ResolvedSalesProfile | undefined, moveId: string): boolean {
  return Boolean(profileStrategy(profile, moveId));
}
