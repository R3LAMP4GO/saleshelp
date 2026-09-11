import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
import { initLotLiftCoach } from "./coach";
import { LotLiftCallStateManager } from "./callState";
import type { LotLiftTurnIntelligence } from "./turnIntelligence";
import { useStore } from "../store";
import { getLotLiftLiveStatus, setLotLiftLiveStatus } from "./liveStatus";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../../../sales-profiles/lotlift/profile";
import { resolveSalesProfile } from "../sales/profiles";

describe("LotLift Coach immediate path", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    useStore.setState({ meetingStatus: "stopped", segments: [], findings: [], findingSolutions: {}, solutionFindingId: null, selfSpeakerKey: null });
    setLotLiftLiveStatus("Listening");
  });

  it("activates SalesPilot from the selected profile without LotLift evaluations", async () => {
    const analyzer = vi.fn(async (): Promise<LotLiftTurnIntelligence> => ({ event_type: "response", confidence: 1, needs_coaching: true, playbook_rule_ids: [], state_events: [], selected_move: null, move_id: null, source: "fallback" }));
    const current = useStore.getState();
    useStore.setState({ meetingStatus: "recording", meetingId: "profile-call", salesMetadata: { ...current.salesMetadata!, salesProfileId: "lotlift-cold-outbound" }, settings: { ...current.settings, evaluations: [] }, segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
    cleanups.push(initLotLiftCoach(new LotLiftCallStateManager(), analyzer, "lotlift-cold-outbound"));
    useStore.setState({ segments: [{ id: "prospect", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 1, text: "This sounds expensive." }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(analyzer).toHaveBeenCalledOnce();
    expect(useStore.getState().findings).toHaveLength(1);
    expect(useStore.getState().solutionFindingId).toBeNull();
    expect(getLotLiftLiveStatus()).toBe("Suggestion ready");
  });

  it("assimilates a finalized actual rep question before selecting contextual response", async () => {
    const analyzer = vi.fn(async (_input: { state: { pending_answer: unknown } }): Promise<LotLiftTurnIntelligence> => ({ event_type: "response", confidence: 1, needs_coaching: true, playbook_rule_ids: [], state_events: [], selected_move: null, move_id: null, source: "fallback" }));
    const current = useStore.getState();
    useStore.setState({ meetingStatus: "recording", meetingId: "owner-flow", salesMetadata: { ...current.salesMetadata!, salesProfileId: "lotlift-cold-outbound", resolvedProfile: resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE) }, settings: { ...current.settings, evaluations: [] }, segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
    cleanups.push(initLotLiftCoach(new LotLiftCallStateManager(), analyzer, "lotlift-cold-outbound"));
    useStore.setState({ segments: [
      { id: "rep-owner", source: "me", speaker: 1, isFinal: true, startMs: 0, endMs: 1, text: "Who handles paid online inquiry response here?" },
      { id: "owner", source: "them", speaker: 0, isFinal: true, startMs: 2, endMs: 3, text: "Yeah, this is me." },
    ] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useStore.getState().findingSolutions["lotlift-owner"]?.solution?.replies[0]?.reply).toContain("Which online sources generate most buyer inquiries");
    const [analysisInput] = analyzer.mock.calls[0] ?? [];
    expect(analysisInput?.state.pending_answer).toMatchObject({ target_field: "workflow_owner" });
    useStore.setState({ segments: [...useStore.getState().segments, { id: "why", source: "them", speaker: 0, isFinal: true, startMs: 4, endMs: 5, text: "Guys, why are you calling?" }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reply = useStore.getState().findingSolutions["lotlift-why"]?.solution?.replies[0]?.reply ?? "";
    expect(reply).toContain("I’m calling to understand the online inquiry workflow");
    expect(reply).not.toMatch(/is that you|who handles|who owns/i);
    expect(useStore.getState().solutionFindingId).toBeNull();
  });

  it("renders one fallback then ignores a stale model completion", async () => {
    let resolveFirst!: (result: LotLiftTurnIntelligence) => void;
    const analyzer = vi.fn((input: { turn: { id: string } }) => input.turn.id === "first"
      ? new Promise<LotLiftTurnIntelligence>((resolve) => { resolveFirst = resolve; })
      : Promise.resolve({ event_type: "response" as const, confidence: 1, needs_coaching: true, playbook_rule_ids: [], state_events: [], selected_move: null, move_id: null, source: "fallback" as const }));
    const current = useStore.getState();
    useStore.setState({ meetingStatus: "recording", meetingId: "stale-call", settings: { ...current.settings, evaluations: [] }, segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
    cleanups.push(initLotLiftCoach(new LotLiftCallStateManager(), analyzer));
    useStore.setState({ segments: [{ id: "first", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 1, text: "This sounds expensive." }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    useStore.setState({ segments: [...useStore.getState().segments, { id: "second", source: "them", speaker: 0, isFinal: true, startMs: 2, endMs: 3, text: "Okay." }] });
    resolveFirst({ event_type: "response", confidence: 1, needs_coaching: true, playbook_rule_ids: [], state_events: [], selected_move: null, move_id: null, source: "model", spoken_response: "Stale output." });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useStore.getState().findings).toHaveLength(2);
    expect(useStore.getState().findingSolutions["lotlift-second"]?.solution?.replies[0]?.reply).not.toBe("Stale output.");
  });

  it("persists DNC and never sends that turn to local selection", async () => {
    const analyzer = vi.fn();
    const current = useStore.getState();
    useStore.setState({ meetingStatus: "recording", meetingId: "dnc-call", settings: { ...current.settings, evaluations: [] }, segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
    cleanups.push(initLotLiftCoach(new LotLiftCallStateManager(), analyzer));
    useStore.setState({ segments: [{ id: "dnc", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 1, text: "Take us off your list." }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(analyzer).not.toHaveBeenCalled();
    expect(useStore.getState().findings).toHaveLength(1);
    expect(useStore.getState().findings[0]?.id).toBe("lotlift-dnc");
    useStore.setState({ segments: [...useStore.getState().segments, { id: "later", source: "them", speaker: 0, isFinal: true, startMs: 2, endMs: 3, text: "Actually, what is this?" }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(analyzer).not.toHaveBeenCalled();
    expect(useStore.getState().findings).toHaveLength(1);
  });

  it("ignores partial prospect speech until it finalizes", async () => {
    const analyzer = vi.fn(async (): Promise<LotLiftTurnIntelligence> => ({ event_type: "response", confidence: 1, needs_coaching: true, playbook_rule_ids: [], state_events: [], selected_move: null, move_id: null, source: "fallback" }));
    const current = useStore.getState();
    useStore.setState({ meetingStatus: "recording", meetingId: "partial-call", settings: { ...current.settings, evaluations: [] }, segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
    cleanups.push(initLotLiftCoach(new LotLiftCallStateManager(), analyzer));
    useStore.setState({ segments: [{ id: "partial", source: "them", speaker: 0, isFinal: false, startMs: 0, endMs: 1, text: "This sounds" }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(analyzer).not.toHaveBeenCalled();
    expect(useStore.getState().findings).toHaveLength(0);
  });
});
