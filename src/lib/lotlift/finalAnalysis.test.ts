import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

import { invoke } from "@tauri-apps/api/core";
import { newLotLiftCallState } from "./callState";
import { analyzeLotLiftFinalCall, finalizeLotLiftCall, persistLotLiftFinalAnalysis, reconcileLotLiftFinalAnalysis, type LotLiftFinalAnalysisModelOutput } from "./finalAnalysis";
import { lotLiftFinalAnalysisFixtures } from "./finalAnalysis.fixtures";

type ModelFact = NonNullable<LotLiftFinalAnalysisModelOutput["summary"]>;
const fact = (value: string, segmentId: string, text: string): ModelFact => ({ value, status: "verified", evidence: { segment_id: segmentId, text } });

describe("LotLift final call analysis", () => {
  it.each(lotLiftFinalAnalysisFixtures)("grounds the $name golden fixture", async (fixture) => {
    const result = await analyzeLotLiftFinalCall({ state: fixture.state, transcript: fixture.transcript, model: async () => fixture.output, createdAt: "2026-09-07T12:00:00.000Z" });
    const expected = fixture.expected;
    if ("dnc" in expected) {
      expect(result).toMatchObject({ analysis_status: "dnc", do_not_contact: true, dnc_evidence: fixture.state.dnc_evidence });
      return;
    }
    for (const expectedFact of expected.facts) {
      const value = result[expectedFact.field];
      const actual = Array.isArray(value) ? value.find((item) => item.value === expectedFact.value) : value;
      expect(actual).toMatchObject({ value: expectedFact.value, evidence: expectedFact.evidence });
      expect(fixture.transcript.find((segment) => segment.id === expectedFact.evidence.segment_id)?.text).toContain(expectedFact.evidence.text);
    }
  });

  it("keeps verified Call State facts and records conflicting verified analysis facts", () => {
    const state = newLotLiftCallState("conflict");
    state.current_solution = fact("VinSolutions", "state", "We use VinSolutions.");
    const result = reconcileLotLiftFinalAnalysis(state, [
      { id: "state", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 1, text: "We use VinSolutions." },
      { id: "analysis", source: "them", speaker: 0, isFinal: true, startMs: 2, endMs: 3, text: "We use DealerSocket." },
    ], { current_solution: fact("DealerSocket", "analysis", "We use DealerSocket.") });
    expect(result.current_solution.value).toBe("VinSolutions");
    expect(result.contradictions).toEqual([expect.objectContaining({ field: "current_solution", final_analysis: expect.objectContaining({ value: "DealerSocket" }) })]);
  });

  it("drops unsupported evidence and ignores recorded DNC changes", () => {
    const state = newLotLiftCallState("untrusted");
    const result = reconcileLotLiftFinalAnalysis(state, [
      { id: "one", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 1, text: "We use VinSolutions." },
    ], { current_solution: fact("DealerSocket", "one", "We use VinSolutions."), do_not_contact: true });
    expect(result.current_solution.value).toBeNull();
    expect(result.validation_failures).toEqual(expect.arrayContaining([
      expect.stringContaining("current_solution"),
      expect.stringContaining("DNC"),
    ]));
  });

  it("marks malformed or unsupported model facts insufficient", () => {
    const state = newLotLiftCallState("malformed");
    const transcript = [{ id: "one", source: "them" as const, speaker: 0, isFinal: true, startMs: 0, endMs: 1, text: "We use VinSolutions." }];
    const malformed = { current_solution: { value: "VinSolutions", status: "verified" } } as unknown as LotLiftFinalAnalysisModelOutput;
    const result = reconcileLotLiftFinalAnalysis(state, transcript, malformed);
    expect(result).toMatchObject({ analysis_status: "insufficient_evidence", current_solution: { value: null } });
    expect(result.validation_failures).toEqual(expect.arrayContaining([expect.stringContaining("current_solution")]));
  });

  it("returns an evidence-empty snapshot when the deep provider fails", async () => {
    const result = await analyzeLotLiftFinalCall({
      state: newLotLiftCallState("provider-failure"),
      transcript: [{ id: "one", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 1, text: "Call us Tuesday." }],
      model: async () => { throw new Error("provider unavailable"); },
    });
    expect(result).toMatchObject({ analysis_status: "insufficient_evidence", crm_note: { value: null } });
  });

  it("does not send DNC calls to the model and preserves suppression verbatim", async () => {
    const fixture = lotLiftFinalAnalysisFixtures.find((item) => item.name === "do not contact")!;
    const result = await analyzeLotLiftFinalCall({ state: fixture.state, transcript: fixture.transcript, model: async () => { throw new Error("model must not run"); } });
    expect(result).toMatchObject({ analysis_status: "dnc", do_not_contact: true, dnc_at: fixture.state.dnc_at, dnc_evidence: fixture.state.dnc_evidence });
    expect(result.crm_note.value).toBeNull();
  });

  it("loads a saved Call State before explicitly finalizing it locally", async () => {
    const fixture = lotLiftFinalAnalysisFixtures[0];
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke)
      .mockResolvedValueOnce(fixture.state)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(undefined);
    const result = await finalizeLotLiftCall(fixture.state.call_id, fixture.transcript, undefined, async () => fixture.output);
    expect(result).toMatchObject({ revision: 1, source_call_state_revision: fixture.state.revision });
    expect(invoke).toHaveBeenNthCalledWith(1, "load_lotlift_call_state", { callId: fixture.state.call_id });
    expect(invoke).toHaveBeenNthCalledWith(2, "load_lotlift_final_analysis", { callId: fixture.state.call_id });
    expect(invoke).toHaveBeenNthCalledWith(3, "save_lotlift_final_analysis", { analysis: expect.objectContaining({ revision: 1 }) });
  });

  it("awaits local persistence before returning the revision", async () => {
    const result = reconcileLotLiftFinalAnalysis(newLotLiftCallState("persisted"), [], null, "2026-09-07T12:00:00.000Z");
    await expect(persistLotLiftFinalAnalysis(result)).resolves.toMatchObject({ revision: 1 });
    expect(invoke).toHaveBeenCalledWith("save_lotlift_final_analysis", { analysis: expect.objectContaining({ revision: 1 }) });
  });
});
