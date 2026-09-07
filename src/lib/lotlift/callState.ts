import { invoke } from "@tauri-apps/api/core";
import { log } from "../log";

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

export interface LotLiftCallStateStorage {
  load(callId: string): Promise<LotLiftCallState | null>;
  save(state: LotLiftCallState): Promise<LotLiftCallState>;
}

type ManagedCallState = {
  state: LotLiftCallState;
  ready: Promise<void>;
  tail: Promise<void>;
  seenSegmentIds: Set<string>;
};

const tauriCallStateStorage: LotLiftCallStateStorage = {
  load: loadLotLiftCallState,
  save: persistLotLiftCallState,
};

/** One ordered state stream per call id; a failed save remains in memory for later saves. */
export class LotLiftCallStateManager {
  private readonly calls = new Map<string, ManagedCallState>();
  private readonly retiredCallIds = new Set<string>();

  constructor(
    private readonly storage: LotLiftCallStateStorage = tauriCallStateStorage,
    private readonly onPersistFailure: (message: string, error: unknown, callId: string) => void = (message, error, callId) =>
      log.warn(message, { callId, error: String(error) }),
  ) {}

  activate(callId: string): void {
    if (this.calls.has(callId) || this.retiredCallIds.has(callId)) return;
    const call: ManagedCallState = {
      state: newLotLiftCallState(callId),
      ready: Promise.resolve(),
      tail: Promise.resolve(),
      seenSegmentIds: new Set(),
    };
    this.calls.set(callId, call);
    call.ready = this.storage.load(callId).then((saved) => {
      if (saved) call.state = saved;
    }).catch((error) => {
      this.onPersistFailure("LotLift Call State load failed", error, callId);
    });
  }

  /** Claims a finalized segment once across every live coach subscriber. */
  record(callId: string, segmentId: string, event: CallStateEvent): boolean {
    this.activate(callId);
    const call = this.calls.get(callId);
    if (!call || call.seenSegmentIds.has(segmentId)) return false;
    call.seenSegmentIds.add(segmentId);
    call.tail = call.tail.then(async () => {
      await call.ready;
      call.state = reduceLotLiftCallState(call.state, event);
      try {
        call.state = await this.storage.save(call.state);
      } catch (error) {
        this.onPersistFailure("LotLift Call State save failed", error, callId);
        try {
          call.state = await this.storage.save(call.state);
        } catch (retryError) {
          this.onPersistFailure("LotLift Call State retry failed", retryError, callId);
        }
      }
    });
    return true;
  }

  async flush(callId: string): Promise<void> {
    const call = this.calls.get(callId);
    if (!call) return;
    await call.ready;
    await call.tail;
  }

  async retire(callId: string): Promise<void> {
    const call = this.calls.get(callId);
    this.retiredCallIds.add(callId);
    if (!call) return;
    await call.ready;
    await call.tail;
    if (this.calls.get(callId) === call) this.calls.delete(callId);
  }

  stateFor(callId: string): LotLiftCallState | null {
    return this.calls.get(callId)?.state ?? null;
  }
}