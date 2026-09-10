import { describe, expect, it } from "vitest";
import {
  applyLotLiftAiStatePatch,
  deriveLotLiftConversationStage,
  lotLiftAutomationEligibility,
  LotLiftCallStateManager,
  newLotLiftCallState,
  reduceLotLiftCallState,
  type LotLiftCallState,
  type LotLiftFieldValue,
} from "./callState";

const verified = (value: string, segmentId = "segment-1"): LotLiftFieldValue<string> => ({
  value,
  status: "verified",
  evidence: { segment_id: segmentId, text: `Prospect said ${value}` },
});

const inferred = (value: string): LotLiftFieldValue<string> => ({
  value,
  status: "inferred",
  evidence: { segment_id: "segment-2", text: `Indirectly suggests ${value}` },
});

describe("LotLift Call State", () => {
  it("initializes every scalar field as evidence-aware unknown", () => {
    const state = newLotLiftCallState("call_1");

    expect(state).toMatchObject({
      schema_version: 6,
      dealership: { value: null, status: "unknown", evidence: null },
      lead_arrival_point: { value: null, status: "unknown", evidence: null },
      renewal_date: { value: null, status: "unknown", evidence: null },
      stated_readiness: { value: null, status: "unknown", evidence: null },
      fit_status: { value: null, status: "unknown", evidence: null },
      next_action_at: { value: null, status: "unknown", evidence: null },
      selected_objection_route: { value: null, status: "unknown", evidence: null },
    });
    expect(state).toMatchObject({
      lead_sources: [], pain_points: [], stakeholders: [], decision_blockers: [], decision_stakeholders: [], buying_signals: [], recurring_objections: [],
    });
  });

  it("derives stages from verified evidence and records deterministic move progress", () => {
    let state = newLotLiftCallState("call-stage");
    expect(deriveLotLiftConversationStage(state)).toBe("owner-identification");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("BDC manager") });
    expect(deriveLotLiftConversationStage(state)).toBe("relevance-discovery");
    state = reduceLotLiftCallState(state, { type: "append", field: "lead_sources", fact: verified("AutoTrader") });
    expect(deriveLotLiftConversationStage(state)).toBe("gap-confirmation");
    state = reduceLotLiftCallState(state, { type: "append", field: "pain_points", fact: verified("Leads wait overnight") });
    expect(deriveLotLiftConversationStage(state)).toBe("qualification");
    state = reduceLotLiftCallState(state, { type: "capture", field: "authority", fact: verified("I make that decision") });
    state = reduceLotLiftCallState(state, { type: "coaching-progress", move_id: "workflow-check", discovery_dimension: "authority" });
    expect(deriveLotLiftConversationStage(state)).toBe("meeting-invitation");
    expect(state).toMatchObject({ last_move_id: "workflow-check", last_discovery_dimension: "authority" });
    state = reduceLotLiftCallState(state, { type: "coaching-progress", move_id: "close", substantive_refusal: true });
    state = reduceLotLiftCallState(state, { type: "coaching-progress", move_id: "close", substantive_refusal: true });
    expect(deriveLotLiftConversationStage(state)).toBe("terminal");
  });

  it("keeps explicit facts when a later inferred capture disagrees", () => {
    const verifiedSolution = reduceLotLiftCallState(newLotLiftCallState("call_1"), {
      type: "capture", field: "current_solution", fact: verified("VinSolutions"),
    });
    const afterInference = reduceLotLiftCallState(verifiedSolution, {
      type: "capture", field: "current_solution", fact: inferred("DealerSocket"),
    });

    expect(afterInference.current_solution).toEqual(verified("VinSolutions"));
  });

  it("keeps evidence on multi-value state and counts recurring objections", () => {
    const withSource = reduceLotLiftCallState(newLotLiftCallState("call_1"), {
      type: "append", field: "lead_sources", fact: verified("Autotrader"),
    });
    const withObjection = reduceLotLiftCallState(withSource, {
      type: "recurring-objection", fact: verified("price", "segment-3"),
    });
    const repeated = reduceLotLiftCallState(withObjection, {
      type: "recurring-objection", fact: inferred("price"),
    });

    expect(repeated.lead_sources).toEqual([verified("Autotrader")]);
    expect(repeated.recurring_objections).toEqual([{ ...verified("price", "segment-3"), count: 2, resolved: false }]);
  });

  it("preserves DNC evidence and blocks automatic outreach", () => {
    const dnc = reduceLotLiftCallState(newLotLiftCallState("call_1"), {
      type: "do-not-contact",
      at: "2026-09-07T12:00:00.000Z",
      evidence: { segment_id: "dnc-1", text: "Please don't call again." },
    });
    const patched = applyLotLiftAiStatePatch(dnc, {
      do_not_contact: false,
      dnc_at: null,
      dnc_evidence: null,
      current_solution: inferred("DealerSocket"),
    });

    expect(patched).toMatchObject({
      do_not_contact: true,
      dnc_at: "2026-09-07T12:00:00.000Z",
      dnc_evidence: { segment_id: "dnc-1", text: "Please don't call again." },
    });
    expect(lotLiftAutomationEligibility(patched)).toEqual({ call_eligible: false, sales_email_eligible: false, automatic_follow_up_eligible: false });
  });
});

describe("LotLift Call State lifecycle", () => {
  function storage(initial: Record<string, LotLiftCallState> = {}) {
    const saved: LotLiftCallState[] = [];
    const states = new Map(Object.entries(initial));
    return {
      saved,
      states,
      load: async (callId: string) => states.get(callId) ?? null,
      save: async (state: LotLiftCallState) => {
        const next = { ...state, revision: state.revision + 1 };
        states.set(next.call_id, next);
        saved.push(next);
        return next;
      },
    };
  }

  it("serializes evidence-aware events into monotonic durable revisions", async () => {
    const disk = storage();
    const manager = new LotLiftCallStateManager(disk);
    manager.record("call-a", "one", { type: "append", field: "pain_points", fact: verified("Leads sit overnight", "one") });
    manager.record("call-a", "two", { type: "capture", field: "workflow_owner", fact: verified("BDC manager", "two") });
    await manager.flush("call-a");

    expect(disk.saved.map(({ revision }) => revision)).toEqual([1, 2, 3]);
    expect(disk.states.get("call-a")).toMatchObject({
      pain_points: [verified("Leads sit overnight", "one")],
      workflow_owner: verified("BDC manager", "two"),
    });
  });

  it("persists an empty state when a call starts", async () => {
    const disk = storage();
    const manager = new LotLiftCallStateManager(disk);
    manager.activate("call-a");
    await manager.flush("call-a");

    expect(disk.states.get("call-a")).toMatchObject({ call_id: "call-a", revision: 1 });
  });

  it("reloads the expanded schema without losing captured evidence", async () => {
    const saved = reduceLotLiftCallState(newLotLiftCallState("call-a"), {
      type: "capture", field: "authority", fact: verified("General manager"),
    });
    const manager = new LotLiftCallStateManager(storage({ "call-a": { ...saved, revision: 1 } }));
    manager.activate("call-a");
    await manager.flush("call-a");

    expect(manager.stateFor("call-a")?.authority).toEqual(verified("General manager"));
  });
});
