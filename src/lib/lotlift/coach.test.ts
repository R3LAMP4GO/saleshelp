import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

import { initLotLiftCoach } from "./coach";
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
      meetingStartedAt: 1,
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
      meetingStartedAt: 2,
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
});
