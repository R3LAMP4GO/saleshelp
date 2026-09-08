import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

import { initLotLiftCoach } from "./coach";
import type { LotLiftTurnIntelligence } from "./turnIntelligence";
import { LotLiftCallStateManager, newLotLiftCallState, type LotLiftCallState } from "./callState";
import { buildLotLiftEvaluations } from "./evaluations";
import { evalsFromDefs } from "../evaluations/presets";
import { useStore } from "../store";

describe("LotLift fast reply path", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    const settings = useStore.getState().settings;
    useStore.setState({ segments: [], findings: [], findingSolutions: {}, solutionFindingId: null, settings: { ...settings, llmProviders: { ...settings.llmProviders, realtime: "groq" } } });
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
    expect(state.findings).toMatchObject([{ id: "lotlift-prospect-price-1", title: "“It’s too expensive” or “No budget.”" }]);
    expect(state.findingSolutions["lotlift-prospect-price-1"]?.solution?.replies).toEqual([{
      kind: "reframe",
      reply: "“I can see why you would want to be careful about another tool. When you say expensive, is the issue the monthly number itself, the setup effort, comparison with another option, or that the return is not clear enough?”",
      consideration: "Isolate the real concern before discussing a supported scope.",
    }]);
    expect(state.solutionFindingId).toBe("lotlift-prospect-price-1");
  });

  it("acknowledges DNC once and suppresses later sales responses", async () => {
    const manager = new LotLiftCallStateManager({
      load: async () => null,
      save: async (state) => ({ ...state, revision: state.revision + 1 }),
    });
    const current = useStore.getState();
    useStore.setState({
      meetingStatus: "recording",
      meetingStartedAt: 2,
      meetingId: "call-dnc",
      settings: { ...current.settings, evaluations: evalsFromDefs(buildLotLiftEvaluations()) },
      segments: [],
      findings: [],
      findingSolutions: {},
      solutionFindingId: null,
    });
    cleanups.push(initLotLiftCoach(manager));

    useStore.setState({ segments: [{
      id: "prospect-dnc", source: "them", speaker: 0, isFinal: true,
      startMs: 100, endMs: 300, text: "Please take us off your list.",
    }] });
    await manager.flush("lotlift-call-dnc");
    useStore.setState({ segments: [
      ...useStore.getState().segments,
      { id: "prospect-price-after-dnc", source: "them", speaker: 0, isFinal: true, startMs: 400, endMs: 700, text: "What does it cost?" },
    ] });

    expect(manager.stateFor("lotlift-call-dnc")).toMatchObject({
      do_not_contact: true,
      dnc_evidence: { segment_id: "prospect-dnc", text: "Please take us off your list." },
    });
    expect(useStore.getState().findings).toHaveLength(1);
    expect(useStore.getState().findingSolutions["lotlift-prospect-dnc"]?.solution?.replies[0]?.reply)
      .toBe("Absolutely. I’ll mark this number do-not-call. Thanks for letting me know.");
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
      .toBe("“I can see why you would want to be careful about another tool. When you say expensive, is the issue the monthly number itself, the setup effort, comparison with another option, or that the return is not clear enough?”");
  });

  it("uses loaded state and intervening spouse context for a later price turn", async () => {
    const manager = new LotLiftCallStateManager({ load: async (id) => ({ ...newLotLiftCallState(id), revision: 1, current_solution: { value: "VinSolutions", status: "verified", evidence: { segment_id: "saved", text: "We use VinSolutions." } } }), save: async (state) => ({ ...state, revision: state.revision + 1 }) });
    const analyzer = vi.fn(async () => ({ event_type: "objection" as const, confidence: 1, needs_coaching: true, playbook_rule_ids: ["objection:spouse-partner" as const], state_events: [], say: "Unapproved model copy", goal: "Learn the decision criteria and create a focused joint next step.", source: "model" as const }));
    const current = useStore.getState();
    useStore.setState({ meetingStatus: "recording", meetingStartedAt: 3, meetingId: "call-context", settings: { ...current.settings, llmProviders: { ...current.settings.llmProviders, realtime: "ollama" }, evaluations: evalsFromDefs(buildLotLiftEvaluations()) }, segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
    cleanups.push(initLotLiftCoach(manager, analyzer));
    useStore.setState({ segments: [
      { id: "wife", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 1, text: "I need to talk to my wife." },
      { id: "me", source: "me", speaker: 1, isFinal: true, startMs: 2, endMs: 3, text: "What matters to her?" },
      { id: "them", source: "them", speaker: 0, isFinal: true, startMs: 4, endMs: 5, text: "She cares about coverage." },
      { id: "price", source: "them", speaker: 0, isFinal: true, startMs: 6, endMs: 7, text: "This is too much money." },
    ] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(analyzer).toHaveBeenCalledWith(expect.objectContaining({ state: expect.objectContaining({ current_solution: expect.objectContaining({ value: "VinSolutions" }) }), conversation: expect.arrayContaining([expect.objectContaining({ id: "me" }), expect.objectContaining({ id: "wife" })]), relevantRuleIds: ["objection:no-budget"] }));
    expect(useStore.getState().findingSolutions["lotlift-price"]?.solution?.replies[0]?.reply).toBe("“I can see why you would want to be careful about another tool. When you say expensive, is the issue the monthly number itself, the setup effort, comparison with another option, or that the return is not clear enough?”");
  });

  it("does not display Ollama wording without a deterministic approved retrieval", async () => {
    const analyzer = vi.fn(async () => ({ event_type: "objection" as const, confidence: 1, needs_coaching: true, playbook_rule_ids: ["objection:no-budget" as const], state_events: [], say: "Unapproved model copy", goal: "Unapproved model goal", source: "model" as const }));
    const current = useStore.getState();
    useStore.setState({ meetingStatus: "recording", meetingStartedAt: 4, meetingId: "model-only-copy", settings: { ...current.settings, llmProviders: { ...current.settings.llmProviders, realtime: "ollama" }, evaluations: evalsFromDefs(buildLotLiftEvaluations()) }, segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
    cleanups.push(initLotLiftCoach(undefined, analyzer));
    useStore.setState({ segments: [{ id: "ambiguous", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 1, text: "Okay." }] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useStore.getState().findings).toEqual([]);
  });

  it("drops stale rapid prospect results", async () => {
    let resolveFirst!: (value: any) => void;
    const analyzer: (input: any) => Promise<LotLiftTurnIntelligence> = vi.fn((input: any) => input.turn.id === "first" ? new Promise<LotLiftTurnIntelligence>((resolve) => { resolveFirst = resolve; }) : Promise.resolve({ event_type: "none" as const, confidence: 1, needs_coaching: false, playbook_rule_ids: [], state_events: [], say: null, goal: null, source: "model" as const }));
    const durable = new Map<string, LotLiftCallState>();
    const manager = new LotLiftCallStateManager({ load: async (id) => durable.get(id) ?? null, save: async (state) => { const next = { ...state, revision: state.revision + 1 }; durable.set(next.call_id, next); return next; } });
    const current = useStore.getState();
    useStore.setState({ meetingStatus: "recording", meetingStartedAt: 4, meetingId: "call-stale", settings: { ...current.settings, llmProviders: { ...current.settings.llmProviders, realtime: "ollama" }, evaluations: evalsFromDefs(buildLotLiftEvaluations()) }, segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
    cleanups.push(initLotLiftCoach(manager, analyzer));
    useStore.setState({ segments: [{ id: "first", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 1, text: "This is too much money." }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    useStore.setState({ segments: [...useStore.getState().segments, { id: "second", source: "them", speaker: 0, isFinal: true, startMs: 2, endMs: 3, text: "Okay." }] });
    resolveFirst({ event_type: "objection", confidence: 1, needs_coaching: true, playbook_rule_ids: ["objection:no-budget"], state_events: [{ type: "recurring-objection", fact: { value: "money", status: "verified", evidence: { segment_id: "first", text: "money" } } }], say: "“I can see why you would want to be careful about another tool. When you say expensive, is the issue the monthly number itself, the setup effort, comparison with another option, or that the return is not clear enough?”", goal: "Isolate the actual concern before discussing scope or pricing.", source: "model" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await manager.flush("lotlift-call-stale");
    expect(useStore.getState().findings).toEqual([]);
    expect(durable.get("lotlift-call-stale")).toMatchObject({ recurring_objections: [] });
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

    expect(durable.get("lotlift-call-a")?.recurring_objections.map(({ value }) => value)).toEqual(["P2"]);
    expect(durable.get("lotlift-call-b")?.recurring_objections.map(({ value }) => value)).toEqual(["C1"]);
    expect(useStore.getState().findings).toHaveLength(1);
  });
  it("flags a verified decision-context contradiction while retaining both prospect statements", async () => {
    const current = useStore.getState();
    useStore.setState({
      meetingStatus: "recording", meetingStartedAt: 12, meetingId: "decision-context-contradiction",
      settings: { ...current.settings, evaluations: evalsFromDefs(buildLotLiftEvaluations()) },
      segments: [], findings: [], findingSolutions: {}, solutionFindingId: null,
    });
    cleanups.push(initLotLiftCoach());
    useStore.setState({ segments: [
      { id: "ready", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100, text: "Nothing is stopping me from moving forward." },
      { id: "wife", source: "them", speaker: 0, isFinal: true, startMs: 200, endMs: 300, text: "I need to talk to my wife." },
    ] });
    await Promise.resolve();

    expect(useStore.getState().findings.find((item) => item.id === "lotlift-wife")).toBeUndefined();
    expect(useStore.getState().findingSolutions["lotlift-wife"]).toBeUndefined();
  });

  it("keeps verified readiness through more than eight later turns", async () => {
    const manager = new LotLiftCallStateManager({ load: async () => null, save: async (state) => ({ ...state, revision: state.revision + 1 }) });
    const current = useStore.getState();
    useStore.setState({ meetingStatus: "recording", meetingStartedAt: 13, meetingId: "durable-decision-context", settings: { ...current.settings, evaluations: evalsFromDefs(buildLotLiftEvaluations()) }, segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
    cleanups.push(initLotLiftCoach(manager));
    const readiness = { id: "ready", source: "them" as const, speaker: 0, isFinal: true, startMs: 0, endMs: 100, text: "Nothing is stopping me from moving forward." };
    useStore.setState({ segments: [readiness] });
    await manager.flush("lotlift-durable-decision-context");
    expect(manager.stateFor("lotlift-durable-decision-context")).toMatchObject({ stated_readiness: { status: "verified", evidence: { segment_id: "ready", text: readiness.text } } });
    const laterTurns = Array.from({ length: 9 }, (_, index) => ({ id: `later-${index}`, source: "them" as const, speaker: 0, isFinal: true, startMs: 200 + index * 100, endMs: 250 + index * 100, text: "Okay." }));
    const spouse = { id: "partner-after-nine", source: "them" as const, speaker: 0, isFinal: true, startMs: 1_200, endMs: 1_300, text: "I need to talk to my partner first." };
    useStore.setState({ segments: [readiness, ...laterTurns, spouse] });
    await manager.flush("lotlift-durable-decision-context");

    expect(useStore.getState().findings.find((item) => item.id === "lotlift-partner-after-nine")).toBeUndefined();
  });

  it("uses the approved spouse-partner response without claiming a contradiction for a normal objection", async () => {
    const current = useStore.getState();
    useStore.setState({
      meetingStatus: "recording", meetingStartedAt: 13, meetingId: "normal-spouse-objection",
      settings: { ...current.settings, evaluations: evalsFromDefs(buildLotLiftEvaluations()) },
      segments: [], findings: [], findingSolutions: {}, solutionFindingId: null,
    });
    cleanups.push(initLotLiftCoach());
    useStore.setState({ segments: [{
      id: "partner", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100, text: "I need to talk to my partner first.",
    }] });
    await Promise.resolve();

    expect(useStore.getState().findings.find((item) => item.id === "lotlift-partner")).toBeUndefined();
  });

  it("never claims a contradiction when either verified decision fact is missing", async () => {
    const current = useStore.getState();
    useStore.setState({
      meetingStatus: "recording", meetingStartedAt: 14, meetingId: "missing-decision-fact",
      settings: { ...current.settings, evaluations: evalsFromDefs(buildLotLiftEvaluations()) },
      segments: [], findings: [], findingSolutions: {}, solutionFindingId: null,
    });
    cleanups.push(initLotLiftCoach());
    useStore.setState({ segments: [{
      id: "ready-only", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100, text: "Nothing is stopping me from moving forward.",
    }] });
    await Promise.resolve();

    expect(useStore.getState().findings.some((item) => item.title.toLowerCase().includes("decision context changed"))).toBe(false);
  });

  it("never claims a contradiction from an inferred earlier decision fact", async () => {
    const manager = new LotLiftCallStateManager({
      load: async (id) => ({
        ...newLotLiftCallState(id),
        stated_readiness: {
          value: "ready to proceed", status: "inferred",
          evidence: { segment_id: "inferred-ready", text: "Nothing is stopping me from moving forward." },
        },
      }),
      save: async (state) => ({ ...state, revision: state.revision + 1 }),
    });
    const current = useStore.getState();
    useStore.setState({
      meetingStatus: "recording", meetingStartedAt: 15, meetingId: "inferred-decision-fact",
      settings: { ...current.settings, evaluations: evalsFromDefs(buildLotLiftEvaluations()) },
      segments: [], findings: [], findingSolutions: {}, solutionFindingId: null,
    });
    cleanups.push(initLotLiftCoach(manager));
    useStore.setState({ segments: [{
      id: "wife-after-inference", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100, text: "I need to talk to my wife.",
    }] });
    await manager.flush("lotlift-inferred-decision-fact");

    expect(useStore.getState().findings.find((item) => item.id === "lotlift-wife-after-inference")).toBeUndefined();
  });
  it.each([
    ["existing CRM", "We already have a CRM for this.", "C1"],
    ["price", "I do not want another tool because it costs too much.", "P2"],
  ])("selects the exact %s card in a full live call", async (name, text, card) => {
    const current = useStore.getState();
    useStore.setState({ meetingStatus: "recording", meetingStartedAt: 20, meetingId: `script-${name}`, settings: { ...current.settings, evaluations: evalsFromDefs(buildLotLiftEvaluations()) }, segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
    cleanups.push(initLotLiftCoach());
    useStore.setState({ segments: [{ id: `turn-${name}`, source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 1, text }] });
    await Promise.resolve();
    expect(useStore.getState().findings.find((item) => item.id === `lotlift-turn-${name}`)?.evalIds).toEqual([`lotlift-${card}`]);
  });

  it("renders N1 after a durable prior refusal", async () => {
    const manager = new LotLiftCallStateManager({ load: async () => null, save: async (state) => ({ ...state, revision: state.revision + 1 }) });
    const current = useStore.getState();
    useStore.setState({ meetingStatus: "recording", meetingStartedAt: 22, meetingId: "second-no", settings: { ...current.settings, evaluations: evalsFromDefs(buildLotLiftEvaluations()) }, segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
    cleanups.push(initLotLiftCoach(manager));
    const first = { id: "first-no", source: "them" as const, speaker: 0, isFinal: true, startMs: 0, endMs: 1, text: "We are not interested." };
    useStore.setState({ segments: [first] });
    await manager.flush("lotlift-second-no");
    useStore.setState({ segments: [...useStore.getState().segments, { id: "second-no", source: "them", speaker: 0, isFinal: true, startMs: 2, endMs: 3, text: "No thanks, not interested." }] });
    await Promise.resolve();
    expect(useStore.getState().findings.find((item) => item.id === "lotlift-second-no")?.evalIds).toEqual(["lotlift-N1"]);
  });

  it.each(["What is this regarding?", "I need to talk to my partner first.", "Would Tuesday morning or Thursday afternoon work for 15 minutes?"])
  ("refuses absent owner context in a full live call", async (text) => {
    const current = useStore.getState();
    useStore.setState({ meetingStatus: "recording", meetingStartedAt: 21, meetingId: `blocked-${text}`, settings: { ...current.settings, evaluations: evalsFromDefs(buildLotLiftEvaluations()) }, segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
    cleanups.push(initLotLiftCoach());
    useStore.setState({ segments: [{ id: `turn-${text}`, source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 1, text }] });
    await Promise.resolve();
    expect(useStore.getState().findings).toEqual([]);
  });
});