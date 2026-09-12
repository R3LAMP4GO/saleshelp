import { invoke } from "@tauri-apps/api/core";
import { log } from "../log";

export const LOTLIFT_CALL_STATE_SCHEMA_VERSION = 7;

export interface LotLiftEvidence {
  segment_id: string;
  text: string;
}

export type LotLiftFactStatus = "verified" | "inferred" | "unknown";

/** A captured value is only verified when the prospect said it in the attached segment. */
export interface LotLiftFieldValue<T> {
  value: T | null;
  status: LotLiftFactStatus;
  evidence: LotLiftEvidence | null;
}

export interface LotLiftRecurringObjection extends LotLiftFieldValue<string> {
  count: number;
  resolved: boolean;
}

export type LotLiftScalarField =
  | "dealership"
  | "contact_name"
  | "role"
  | "phone"
  | "email"
  | "current_solution"
  | "lead_arrival_point"
  | "workflow_owner"
  | "after_hours_process"
  | "response_speed"
  | "appointment_capability"
  | "follow_up_process"
  | "visibility_process"
  | "authority"
  | "urgency"
  | "renewal_date"
  | "close_opportunity"
  | "fit_status"
  | "disqualification_reason"
  | "next_action"
  | "next_action_at"
  | "selected_objection_route";

export type LotLiftListField =
  | "lead_sources"
  | "pain_points"
  | "quantified_pain"
  | "stakeholders"
  | "prior_answers"
  | "buying_signals"
  | "commitments"
  | "open_questions"
  | "decision_blockers"
  | "decision_stakeholders";

export interface LotLiftPendingAnswer {
  rep_segment_id: string;
  profile_id: string;
  profile_snapshot_version: string;
  move_id: string;
  kind: "confirmation" | "free-text" | "entity";
  target_field: LotLiftScalarField;
  created_revision: number;
}

export type LotLiftConversationStage =
  | "owner-identification"
  | "relevance-discovery"
  | "gap-confirmation"
  | "qualification"
  | "meeting-invitation"
  | "terminal"
  | "disqualified";

/** Persisted v7 call flow. Transitions only advance unless a terminal state takes precedence. */
export type LotLiftCallPhase = "GATEKEEPER" | "RIGHT_PERSON" | "DISCOVERY" | "GAP_FOUND" | "MEETING_ASK" | "TERMINAL";

export type LotLiftDiscoveryDimension = "lead-source" | "ownership" | "after-hours" | "response-speed" | "appointment" | "follow-up" | "visibility" | "pain" | "authority" | "urgency";

export interface LotLiftCallState {
  schema_version: number;
  call_id: string;
  revision: number;
  phase: LotLiftCallPhase;
  dealership: LotLiftFieldValue<string>;
  contact_name: LotLiftFieldValue<string>;
  role: LotLiftFieldValue<string>;
  phone: LotLiftFieldValue<string>;
  email: LotLiftFieldValue<string>;
  lead_sources: LotLiftFieldValue<string>[];
  current_solution: LotLiftFieldValue<string>;
  lead_arrival_point: LotLiftFieldValue<string>;
  workflow_owner: LotLiftFieldValue<string>;
  after_hours_process: LotLiftFieldValue<string>;
  response_speed: LotLiftFieldValue<string>;
  appointment_capability: LotLiftFieldValue<string>;
  follow_up_process: LotLiftFieldValue<string>;
  visibility_process: LotLiftFieldValue<string>;
  pain_points: LotLiftFieldValue<string>[];
  quantified_pain: LotLiftFieldValue<string>[];
  authority: LotLiftFieldValue<string>;
  stakeholders: LotLiftFieldValue<string>[];
  urgency: LotLiftFieldValue<string>;
  renewal_date: LotLiftFieldValue<string>;
  recurring_objections: LotLiftRecurringObjection[];
  stated_readiness: LotLiftFieldValue<string>;
  decision_blockers: LotLiftFieldValue<string>[];
  decision_stakeholders: LotLiftFieldValue<string>[];
  prior_answers: LotLiftFieldValue<string>[];
  buying_signals: LotLiftFieldValue<string>[];
  commitments: LotLiftFieldValue<string>[];
  open_questions: LotLiftFieldValue<string>[];
  close_opportunity: LotLiftFieldValue<string>;
  fit_status: LotLiftFieldValue<string>;
  disqualification_reason: LotLiftFieldValue<string>;
  do_not_contact: boolean;
  dnc_at: string | null;
  dnc_evidence: LotLiftEvidence | null;
  next_action: LotLiftFieldValue<string>;
  next_action_at: LotLiftFieldValue<string>;
  /** Deterministic route signal; never model-authored. */
  selected_objection_route: LotLiftFieldValue<string>;
  /** Deterministic coach metadata; never model-authored. */
  last_discovery_dimension: LotLiftDiscoveryDimension | null;
  last_move_id: string | null;
  pending_answer: LotLiftPendingAnswer | null;
  substantive_refusal_count: number;
}

export const unknownLotLiftField = <T>(): LotLiftFieldValue<T> => ({ value: null, status: "unknown", evidence: null });

export function newLotLiftCallState(callId: string): LotLiftCallState {
  return {
    schema_version: LOTLIFT_CALL_STATE_SCHEMA_VERSION,
    call_id: callId,
    revision: 0,
    phase: "GATEKEEPER",
    dealership: unknownLotLiftField(),
    contact_name: unknownLotLiftField(),
    role: unknownLotLiftField(),
    phone: unknownLotLiftField(),
    email: unknownLotLiftField(),
    lead_sources: [],
    current_solution: unknownLotLiftField(),
    lead_arrival_point: unknownLotLiftField(),
    workflow_owner: unknownLotLiftField(),
    after_hours_process: unknownLotLiftField(),
    response_speed: unknownLotLiftField(),
    appointment_capability: unknownLotLiftField(),
    follow_up_process: unknownLotLiftField(),
    visibility_process: unknownLotLiftField(),
    pain_points: [],
    quantified_pain: [],
    authority: unknownLotLiftField(),
    stakeholders: [],
    urgency: unknownLotLiftField(),
    renewal_date: unknownLotLiftField(),
    recurring_objections: [],
    stated_readiness: unknownLotLiftField(),
    decision_blockers: [],
    decision_stakeholders: [],
    prior_answers: [],
    buying_signals: [],
    commitments: [],
    open_questions: [],
    close_opportunity: unknownLotLiftField(),
    fit_status: unknownLotLiftField(),
    disqualification_reason: unknownLotLiftField(),
    do_not_contact: false,
    dnc_at: null,
    dnc_evidence: null,
    next_action: unknownLotLiftField(),
    next_action_at: unknownLotLiftField(),
    selected_objection_route: unknownLotLiftField(),
    last_discovery_dimension: null,
    last_move_id: null,
    pending_answer: null,
    substantive_refusal_count: 0,
  };
}

export type CallStateEvent =
  | { type: "capture"; field: LotLiftScalarField; fact: LotLiftFieldValue<string> }
  | { type: "append"; field: LotLiftListField; fact: LotLiftFieldValue<string> }
  | { type: "recurring-objection"; fact: LotLiftFieldValue<string> }
  | { type: "decision-context"; readiness?: LotLiftFieldValue<string>; blockers: LotLiftFieldValue<string>[]; stakeholders: LotLiftFieldValue<string>[]; selected_objection_route?: LotLiftFieldValue<string> }
  | { type: "coaching-progress"; move_id: string; discovery_dimension?: LotLiftDiscoveryDimension; substantive_refusal?: boolean }
  | { type: "phase"; phase: LotLiftCallPhase }
  | { type: "pending-answer"; pending: LotLiftPendingAnswer | null }
  | { type: "do-not-contact"; at: string; evidence: LotLiftEvidence };

const scalarFields: readonly LotLiftScalarField[] = [
  "dealership", "contact_name", "role", "phone", "email", "current_solution", "lead_arrival_point",
  "workflow_owner", "after_hours_process", "visibility_process", "authority", "urgency", "renewal_date",
  "close_opportunity", "fit_status", "disqualification_reason", "next_action", "next_action_at", "selected_objection_route",
];

const listFields: readonly LotLiftListField[] = [
  "lead_sources", "pain_points", "quantified_pain", "stakeholders", "prior_answers", "buying_signals", "commitments", "open_questions", "decision_blockers", "decision_stakeholders",
];

function mergeLotLiftField<T>(existing: LotLiftFieldValue<T>, incoming: LotLiftFieldValue<T>): LotLiftFieldValue<T> {
  return existing.status === "verified" && incoming.status !== "verified" ? existing : incoming;
}

function mergeLotLiftFieldList(existing: LotLiftFieldValue<string>[], incoming: LotLiftFieldValue<string>[]): LotLiftFieldValue<string>[] {
  return incoming.reduce((merged, fact) => {
    if (!fact.value) return merged;
    const index = merged.findIndex((item) => item.value?.toLowerCase() === fact.value?.toLowerCase());
    return index < 0
      ? [...merged, fact]
      : merged.map((item, itemIndex) => itemIndex === index ? mergeLotLiftField(item, fact) : item);
  }, existing);
}

export type LotLiftAutomationEligibility = {
  call_eligible: boolean;
  sales_email_eligible: boolean;
  automatic_follow_up_eligible: boolean;
};

/** DNC is the single suppression source for future Frappe contact sync. */
export function lotLiftAutomationEligibility(state: LotLiftCallState): LotLiftAutomationEligibility {
  const eligible = !state.do_not_contact;
  return { call_eligible: eligible, sales_email_eligible: eligible, automatic_follow_up_eligible: eligible };
}

/** LLM output cannot change identity, revision, or deterministic suppression facts. */
export function applyLotLiftAiStatePatch(state: LotLiftCallState, patch: Partial<LotLiftCallState>): LotLiftCallState {
  const next = { ...state };
  for (const field of scalarFields) {
    const incoming = patch[field];
    if (incoming) next[field] = mergeLotLiftField(state[field], incoming);
  }
  for (const field of listFields) {
    const incoming = patch[field];
    if (incoming) next[field] = mergeLotLiftFieldList(state[field], incoming);
  }
  if (patch.recurring_objections) {
    next.recurring_objections = patch.recurring_objections.reduce((merged, objection) => {
      const index = merged.findIndex((item) => item.value?.toLowerCase() === objection.value?.toLowerCase());
      return index < 0
        ? [...merged, objection]
        : merged.map((item, itemIndex) => itemIndex === index
          ? { ...mergeLotLiftField(item, objection), count: Math.max(item.count, objection.count), resolved: item.resolved || objection.resolved }
          : item);
    }, state.recurring_objections);
  }
  return next;
}

/** Derives the durable v7 phase from terminal state and verified prospect evidence. */
const LOTLIFT_PHASE_ORDER: Record<LotLiftCallPhase, number> = { GATEKEEPER: 0, RIGHT_PERSON: 1, DISCOVERY: 2, GAP_FOUND: 3, MEETING_ASK: 4, TERMINAL: 5 };

/** Advances the durable v7 flow without allowing stale events to reopen earlier phases. */
export function advanceLotLiftCallPhase(state: LotLiftCallState, requested: LotLiftCallPhase): LotLiftCallPhase {
  const current = deriveLotLiftCallPhase(state);
  return LOTLIFT_PHASE_ORDER[requested] >= LOTLIFT_PHASE_ORDER[current] ? requested : current;
}

export function deriveLotLiftCallPhase(state: LotLiftCallState): LotLiftCallPhase {
  const verified = (fact: LotLiftFieldValue<string>) => fact.status === "verified" && Boolean(fact.value && fact.evidence);
  const anyVerified = (facts: readonly LotLiftFieldValue<string>[]) => facts.some(verified);
  if (state.do_not_contact || state.substantive_refusal_count >= 2 || verified(state.disqualification_reason)) return "TERMINAL";
  // Legacy snapshots have no phase; verified ownership is enough to permanently leave the gatekeeper.
  if (state.phase === "GATEKEEPER" && (verified(state.workflow_owner) || verified(state.role) || anyVerified(state.stakeholders))) return "RIGHT_PERSON";
  return state.phase;
}

/** Derives the bounded policy stage from terminal state and verified prospect evidence only. */
export function deriveLotLiftConversationStage(state: LotLiftCallState): LotLiftConversationStage {
  const verified = (fact: LotLiftFieldValue<string>) => fact.status === "verified" && Boolean(fact.value && fact.evidence);
  const anyVerified = (facts: readonly LotLiftFieldValue<string>[]) => facts.some(verified);
  if (state.do_not_contact || state.substantive_refusal_count >= 2) return "terminal";
  if (verified(state.disqualification_reason) || (verified(state.fit_status) && /disqualif|unsupported|not a fit/i.test(state.fit_status.value ?? ""))) return "disqualified";
  const ownerKnown = verified(state.role) || verified(state.workflow_owner) || anyVerified(state.stakeholders);
  if (!ownerKnown) return "owner-identification";
  const relevantWorkflow = anyVerified(state.lead_sources) || verified(state.lead_arrival_point) || verified(state.current_solution);
  if (!relevantWorkflow) return "relevance-discovery";
  const confirmedGap = anyVerified(state.pain_points) || anyVerified(state.quantified_pain);
  if (!confirmedGap) return "gap-confirmation";
  if (!verified(state.authority)) return "qualification";
  return "meeting-invitation";
}

/** Deterministic reducer: verified prospect facts resist later inferred replacements. */
export function reduceLotLiftCallState(state: LotLiftCallState, event: CallStateEvent): LotLiftCallState {
  switch (event.type) {
    case "pending-answer": return { ...state, pending_answer: event.pending, revision: state.revision + 1 };
    case "do-not-contact": return state.do_not_contact
      ? state
      : { ...state, do_not_contact: true, dnc_at: event.at, dnc_evidence: event.evidence };
    case "capture": {
      const next = { ...state, [event.field]: mergeLotLiftField(state[event.field], event.fact) };
      return event.field === "workflow_owner" && event.fact.status === "verified" && event.fact.value
        ? { ...next, phase: deriveLotLiftCallPhase(next) === "GATEKEEPER" ? "RIGHT_PERSON" : deriveLotLiftCallPhase(next) }
        : next;
    }
    case "append": {
      const next = { ...state, [event.field]: mergeLotLiftFieldList(state[event.field], [event.fact]) };
      return (event.field === "pain_points" || event.field === "quantified_pain") && deriveLotLiftCallPhase(state) !== "GATEKEEPER"
        ? { ...next, phase: advanceLotLiftCallPhase(state, "GAP_FOUND") }
        : next;
    }
    case "phase": return { ...state, phase: advanceLotLiftCallPhase(state, event.phase) };
    case "coaching-progress": {
      const requestedPhase = event.move_id === "right-person-process" ? "DISCOVERY"
        : event.move_id === "workflow-check" ? "MEETING_ASK"
        : state.phase;
      return {
        ...state,
        phase: advanceLotLiftCallPhase(state, requestedPhase),
        last_move_id: event.move_id,
        last_discovery_dimension: event.discovery_dimension ?? state.last_discovery_dimension,
        substantive_refusal_count: event.substantive_refusal ? Math.min(2, state.substantive_refusal_count + 1) : state.substantive_refusal_count,
      };
    }
    case "decision-context": {
      const explicit = (fact: LotLiftFieldValue<string>) => fact.status === "verified" && !!fact.value && !!fact.evidence;
      return {
        ...state,
        stated_readiness: event.readiness && explicit(event.readiness) ? mergeLotLiftField(state.stated_readiness, event.readiness) : state.stated_readiness,
        decision_blockers: mergeLotLiftFieldList(state.decision_blockers, event.blockers.filter(explicit)),
        decision_stakeholders: mergeLotLiftFieldList(state.decision_stakeholders, event.stakeholders.filter(explicit)),
        selected_objection_route: event.selected_objection_route && explicit(event.selected_objection_route)
          ? mergeLotLiftField(state.selected_objection_route, event.selected_objection_route)
          : state.selected_objection_route,
      };
    }
    case "recurring-objection": {
      const index = state.recurring_objections.findIndex((item) => item.value?.toLowerCase() === event.fact.value?.toLowerCase());
      if (index < 0) return { ...state, recurring_objections: [...state.recurring_objections, { ...event.fact, count: 1, resolved: false }] };
      return {
        ...state,
        recurring_objections: state.recurring_objections.map((item, itemIndex) => itemIndex === index
          ? { ...mergeLotLiftField(item, event.fact), count: item.count + 1, resolved: item.resolved }
          : item),
      };
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
  private readonly doNotContactCallIds = new Set<string>();

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
    let hasSavedState = false;
    call.ready = this.storage.load(callId).then((saved) => {
      if (!saved) return;
      hasSavedState = true;
      // Older persisted calls did not have coach-progress fields; preserve facts while migrating in memory.
      call.state = { ...newLotLiftCallState(callId), ...saved, schema_version: LOTLIFT_CALL_STATE_SCHEMA_VERSION };
      if (saved.do_not_contact) this.doNotContactCallIds.add(callId);
    }).catch((error) => {
      this.onPersistFailure("LotLift Call State load failed", error, callId);
    });
    call.tail = call.ready.then(async () => {
      if (hasSavedState) return;
      try {
        call.state = await this.storage.save(call.state);
      } catch (error) {
        this.onPersistFailure("LotLift Call State initial save failed", error, callId);
      }
    });
  }

  /** Claims a finalized segment once across every live coach subscriber. */
  record(callId: string, segmentId: string, event: CallStateEvent | readonly CallStateEvent[]): boolean {
    this.activate(callId);
    const call = this.calls.get(callId);
    if (!call || call.seenSegmentIds.has(segmentId)) return false;
    call.seenSegmentIds.add(segmentId);
    const events = Array.isArray(event) ? event : [event];
    if (events.some((item) => item.type === "do-not-contact")) this.doNotContactCallIds.add(callId);
    call.tail = call.tail.then(async () => {
      await call.ready;
      for (const item of events) call.state = reduceLotLiftCallState(call.state, item);
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

  isDoNotContact(callId: string): boolean {
    return this.doNotContactCallIds.has(callId) || this.calls.get(callId)?.state.do_not_contact === true;
  }

  stateFor(callId: string): LotLiftCallState | null {
    return this.calls.get(callId)?.state ?? null;
  }
}
