import { describe, expect, it } from "vitest";
import { LotLiftCallStateManager, newLotLiftCallState, reduceLotLiftCallState, type LotLiftCallState } from "./callState";

describe("LotLift Call State", () => {
  it("deduplicates facts and counts recurring objections with evidence", () => {
    const start = newLotLiftCallState("call_1");
    const withPain = reduceLotLiftCallState(start, { type: "pain", value: "  Three leads sat overnight " });
    const deduplicated = reduceLotLiftCallState(withPain, { type: "pain", value: "three leads sat overnight" });
    const once = reduceLotLiftCallState(deduplicated, { type: "objection", kind: "existing-solution", evidence: { segment_id: "s1", text: "We have a CRM." } });
    const twice = reduceLotLiftCallState(once, { type: "objection", kind: "existing-solution", evidence: { segment_id: "s2", text: "Our CRM already handles it." } });

    expect(twice.quantified_pain).toEqual(["Three leads sat overnight"]);
    expect(twice.recurring_objections).toEqual([{ kind: "existing-solution", count: 2, resolved: false, evidence: [
      { segment_id: "s1", text: "We have a CRM." },
      { segment_id: "s2", text: "Our CRM already handles it." },
    ] }]);
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

  it("keeps Call B independent after Call A is retired", async () => {
    const disk = storage();
    const manager = new LotLiftCallStateManager(disk);
    manager.record("call-a", "a-budget", { type: "objection", kind: "price", evidence: { segment_id: "a-budget", text: "No budget." } });
    await manager.retire("call-a");
    manager.record("call-b", "b-crm", { type: "objection", kind: "existing-solution", evidence: { segment_id: "b-crm", text: "We have a CRM." } });
    await manager.flush("call-b");

    expect(disk.states.get("call-a")?.recurring_objections.map(({ kind }) => kind)).toEqual(["price"]);
    expect(disk.states.get("call-b")?.recurring_objections.map(({ kind }) => kind)).toEqual(["existing-solution"]);
  });

  it("serializes two rapid events without a revision conflict", async () => {
    const disk = storage();
    const manager = new LotLiftCallStateManager(disk);
    manager.record("call-a", "one", { type: "pain", value: "one" });
    manager.record("call-a", "two", { type: "pain", value: "two" });
    await manager.flush("call-a");

    expect(disk.saved.map(({ revision }) => revision)).toEqual([1, 2]);
    expect(disk.states.get("call-a")?.quantified_pain).toEqual(["one", "two"]);
  });

  it("serializes rapid events into monotonic durable revisions", async () => {
    const disk = storage();
    const manager = new LotLiftCallStateManager(disk);
    for (const [id, value] of [["one", "one"], ["two", "two"], ["three", "three"]] as const) {
      manager.record("call-a", id, { type: "pain", value });
    }
    await manager.flush("call-a");

    expect(disk.saved.map(({ revision }) => revision)).toEqual([1, 2, 3]);
    expect(disk.states.get("call-a")?.quantified_pain).toEqual(["one", "two", "three"]);
  });

  it("logs a rejected write and continues persisting later events", async () => {
    const disk = storage();
    let reject = true;
    const warnings: string[] = [];
    const manager = new LotLiftCallStateManager({
      ...disk,
      save: async (state) => {
        if (reject) {
          reject = false;
          throw new Error("disk unavailable");
        }
        return disk.save(state);
      },
    }, (message) => warnings.push(message));
    manager.record("call-a", "one", { type: "pain", value: "one" });
    manager.record("call-a", "two", { type: "pain", value: "two" });
    await manager.flush("call-a");

    expect(warnings).toContain("LotLift Call State save failed");
    expect(disk.states.get("call-a")?.quantified_pain).toEqual(["one", "two"]);
  });

  it("reloads v1 state for a repeated manager initialization", async () => {
    const saved = { ...newLotLiftCallState("call-a"), revision: 1, authority: "owner" };
    const disk = storage({ "call-a": saved });
    const manager = new LotLiftCallStateManager(disk);
    manager.activate("call-a");
    await manager.flush("call-a");

    expect(manager.stateFor("call-a")).toEqual(saved);
  });
});