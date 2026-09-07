import { invoke } from "@tauri-apps/api/core";

export const LOTLIFT_CALL_STATE_SCHEMA_VERSION = 1;

export interface LotLiftEvidence {
  segment_id: string;
  text: string;
}

export interface LotLiftRecurringObjection {
  kind: string;
  count: number;
  resolved: boolean;
  evidence: LotLiftEvidence[];
}

export interface LotLiftCallState {
  schema_version: number;
  call_id: string;
  revision: number;
  current_solution: string | null;
  quantified_pain: string[];
  authority: string | null;
  urgency: string | null;
  recurring_objections: LotLiftRecurringObjection[];
  prior_answers: string[];
  commitments: string[];
  open_questions: string[];
}

export function newLotLiftCallState(callId: string): LotLiftCallState {
  return {
    schema_version: LOTLIFT_CALL_STATE_SCHEMA_VERSION,
    call_id: callId,
    revision: 0,
    current_solution: null,
    quantified_pain: [],
    authority: null,
    urgency: null,
    recurring_objections: [],
    prior_answers: [],
    commitments: [],
    open_questions: [],
  };
}

export type CallStateEvent =
  | { type: "current-solution"; value: string }
  | { type: "pain"; value: string }
  | { type: "authority"; value: string }
  | { type: "urgency"; value: string }
  | { type: "objection"; kind: string; evidence: LotLiftEvidence }
  | { type: "answer"; value: string }
  | { type: "commitment"; value: string }
  | { type: "open-question"; value: string }
  | { type: "question-answered"; value: string };

const appendUnique = (values: string[], value: string) =>
  value.trim() && !values.some((existing) => existing.toLowerCase() === value.trim().toLowerCase())
    ? [...values, value.trim()]
    : values;

/** Deterministic reducer: all state changes remain evidence-addressable and revisioned. */
export function reduceLotLiftCallState(state: LotLiftCallState, event: CallStateEvent): LotLiftCallState {
  switch (event.type) {
    case "current-solution": return { ...state, current_solution: event.value.trim() || state.current_solution };
    case "pain": return { ...state, quantified_pain: appendUnique(state.quantified_pain, event.value) };
    case "authority": return { ...state, authority: event.value.trim() || state.authority };
    case "urgency": return { ...state, urgency: event.value.trim() || state.urgency };
    case "answer": return { ...state, prior_answers: appendUnique(state.prior_answers, event.value) };
    case "commitment": return { ...state, commitments: appendUnique(state.commitments, event.value) };
    case "open-question": return { ...state, open_questions: appendUnique(state.open_questions, event.value) };
    case "question-answered": return { ...state, open_questions: state.open_questions.filter((question) => question !== event.value) };
    case "objection": {
      const existing = state.recurring_objections.find((objection) => objection.kind === event.kind);
      const recurring_objections = existing
        ? state.recurring_objections.map((objection) => objection === existing
          ? { ...objection, count: objection.count + 1, evidence: [...objection.evidence, event.evidence] }
          : objection)
        : [...state.recurring_objections, { kind: event.kind, count: 1, resolved: false, evidence: [event.evidence] }];
      return { ...state, recurring_objections };
    }
  }
}

export async function persistLotLiftCallState(state: LotLiftCallState): Promise<LotLiftCallState> {
  const next = { ...state, revision: state.revision + 1 };
  await invoke("save_lotlift_call_state", { state: next });
  return next;
}

export function loadLotLiftCallState(callId: string): Promise<LotLiftCallState | null> {
  return invoke("load_lotlift_call_state", { callId });
}
