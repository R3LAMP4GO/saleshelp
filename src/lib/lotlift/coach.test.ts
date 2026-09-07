import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

import { initLotLiftCoach } from "./coach";
import { LotLiftCallStateManager, type LotLiftCallState } from "./callState";
import { buildLotLiftEvaluations } from "./evaluations";
import { evalsFromDefs } from "../evaluations/presets";
import { useStore } from "../store";

describe("LotLift fast reply path", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    useStore.setState({ segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
  });

  it("turns a final prospect price objection into the one approved reply", async () => {
    const current = useStore.getState();
    useStore.setState({
      meetingStatus: "recording",
      meetingStartedAt: 1,
      meetingId: "call-one",
      settings: { ...current.settings, evaluations: evalsFromDefs(buildLotLiftEvaluations()) },
      segments: [],
      findings: [],
      findingSolutions: {},
      solutionFindingId: null,
    });
    cleanups.push(initLotLiftCoach());

    useStore.setState({ segments: [{
      id: "prospect-price-1", source: "them", speaker: 0, isFinal: true,
      startMs: 100, endMs: 500, text: "I’m not interested because this is too much money.",
    }] });
    await Promise.resolve();

    const state = useStore.getState();
    expect(state.findings).toMatchObject([{ id: "lotlift-prospect-price-1", title: "Price concern" }]);
    expect(state.findingSolutions["lotlift-prospect-price-1"]?.solution?.replies).toEqual([{
      kind: "reframe",
      reply: "That’s fair. Is the concern the monthly number, setup effort, comparison with another option, or that the return is not clear enough?",
      consideration: "Isolate the real concern before discussing scope or price.",
    }]);
    expect(state.solutionFindingId).toBe("lotlift-prospect-price-1");
  });

  it("keeps an earlier spouse concern in a later price response", async () => {
    const current = useStore.getState();
    useStore.setState({
      meetingStatus: "recording",
      meetingStartedAt: 2,
      meetingId: "call-two",
      settings: { ...current.settings, evaluations: evalsFromDefs(buildLotLiftEvaluations()) },
      findings: [],
      findingSolutions: {},
      solutionFindingId: null,
    });
    cleanups.push(initLotLiftCoach());
    useStore.setState({ segments: [
      { id: "prospect-wife-1", source: "them", speaker: 0, isFinal: true, startMs: 100, endMs: 300, text: "I need to talk to my wife first." },
      { id: "prospect-price-2", source: "them", speaker: 0, isFinal: true, startMs: 400, endMs: 700, text: "This is too much money for us." },
    ] });
    await Promise.resolve();

    expect(useStore.getState().findingSolutions["lotlift-prospect-price-2"]?.solution?.replies[0]?.reply)
      .toBe("That makes sense. When you talk with your wife, is the concern the monthly number, setup effort, comparison with another option, or that the return is not clear enough?");
  });

  it("deduplicates subscribers and resets state on meeting restart", async () => {
    const durable = new Map<string, LotLiftCallState>();
    const manager = new LotLiftCallStateManager({
      load: async (callId) => durable.get(callId) ?? null,
      save: async (state) => {
        const next = { ...state, revision: state.revision + 1 };
        durable.set(next.call_id, next);
        return next;
      },
    });
    const current = useStore.getState();
    useStore.setState({
      meetingStatus: "recording",
      meetingStartedAt: 10,
      meetingId: "call-a",
      settings: { ...current.settings, evaluations: evalsFromDefs(buildLotLiftEvaluations()) },
      segments: [],
      findings: [],
      findingSolutions: {},
      solutionFindingId: null,
    });
    cleanups.push(initLotLiftCoach(manager), initLotLiftCoach(manager));
    useStore.setState({ segments: [{
      id: "them-0", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100, text: "This costs too much.",
    }] });
    await manager.flush("lotlift-call-a");
    useStore.setState({ meetingStatus: "stopped" });
    await Promise.resolve();
    useStore.setState({
      meetingStatus: "recording",
      meetingStartedAt: 11,
      meetingId: "call-b",
      segments: [],
      findings: [],
      findingSolutions: {},
      solutionFindingId: null,
    });
    useStore.setState({ segments: [{
      id: "them-0", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100, text: "We already have a CRM.",
    }] });
    await manager.flush("lotlift-call-b");

    expect(durable.get("lotlift-call-a")?.recurring_objections.map(({ kind }) => kind)).toEqual(["price"]);
    expect(durable.get("lotlift-call-b")?.recurring_objections.map(({ kind }) => kind)).toEqual(["existing-solution"]);
    expect(useStore.getState().findings).toHaveLength(1);
  });
});