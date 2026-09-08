import { afterEach, expect, it } from "vitest";
import { useStore } from "../store";
import { customSalesMeetingMetadata, salesMeetingMetadata } from "./meeting";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../../../sales-profiles/lotlift/profile";
import { initSalesPilotCoach } from "./liveCoach";
import { validateCustomSalesProfile } from "./customProfiles";

const profile = validateCustomSalesProfile({ id: "89e711c1-e6e5-4c96-a136-cc96e162bc3c", businessName: "Acme", modeName: "Demo", sourceName: "playbook.md", playbookText: "# Acme\n\n## Call objective\nBook a product demo.\n\n## Script stages\n### stage:opening\nOpen the conversation.\n### stage:discovery\nLearn the workflow.\n### stage:close\nBook the demo.\n\n## Objection rules\n### rule:not-interested\nClarify the concern.\n\n## Product facts\n### product:lead-routing\n**Statement:** Acme routes approved leads to assigned owners.\n**Category:** capability", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; useStore.setState({ meetingStatus: "idle", meetingId: null, salesMetadata: null, segments: [], findings: [], findingSolutions: {}, solutionFindingId: null }); });

it("coaches a compiled custom profile once and exposes its stage", async () => {
  const state = useStore.getState();
  useStore.setState({ meetingStatus: "recording", meetingId: "sales-call", salesMetadata: customSalesMeetingMetadata(profile, {}, "2026-01-01T00:00:00.000Z"), segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
  cleanup = initSalesPilotCoach(async () => ({ needs_coaching: true, say: "Acme routes approved leads to assigned owners.", current_stage: "opening", next_stage: "discovery", customer_evidence: [], product_claims: [{ sentence: "Acme routes approved leads to assigned owners.", product_fact_id: "lead-routing" }], source: "model" }));
  useStore.setState({ segments: [{ id: "turn", source: "them", speaker: 0, text: "Tell me more.", isFinal: true, startMs: 0, endMs: 10 }] });
  await Promise.resolve();
  expect(useStore.getState().findings).toMatchObject([{ id: "sales-pilot-turn", detail: "Stage: discovery" }]);
  expect(useStore.getState().findingSolutions["sales-pilot-turn"]?.solution?.replies[0]?.reply).toBe("Acme routes approved leads to assigned owners.");
  expect(state.settings).toBeDefined();
});

it("coaches the built-in LotLift profile", async () => {
  useStore.setState({ meetingStatus: "recording", meetingId: "lotlift", salesMetadata: salesMeetingMetadata(LOTLIFT_COLD_OUTBOUND_PROFILE, {}, "2026-01-01T00:00:00.000Z"), segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
  cleanup = initSalesPilotCoach(async () => ({ needs_coaching: true, say: "LotLift helps teams create a workflow for approved inbound lead sources.", current_stage: "opening", next_stage: "discovery", customer_evidence: [], product_claims: [{ sentence: "LotLift helps teams create a workflow for approved inbound lead sources.", product_fact_id: "approved-inbound-workflow" }], source: "model" }));
  useStore.setState({ segments: [{ id: "lotlift-turn", source: "them", speaker: 0, text: "Tell me more.", isFinal: true, startMs: 0, endMs: 10 }] });
  await Promise.resolve();
  expect(useStore.getState().findings).toMatchObject([{ id: "sales-pilot-lotlift-turn", title: "LotLift sales playbook" }]);
});

it("only progresses through ordered stages", async () => {
  useStore.setState({ meetingStatus: "recording", meetingId: "stages", salesMetadata: customSalesMeetingMetadata(profile, {}, "2026-01-01T00:00:00.000Z"), segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
  const observed: string[] = [];
  const replies = [["opening", "discovery"], ["opening", "close"], ["discovery", "close"]] as const;
  cleanup = initSalesPilotCoach(async (input) => {
    observed.push((input as { currentStage?: string }).currentStage ?? "missing");
    const [current_stage, next_stage] = replies[observed.length - 1]!;
    return { needs_coaching: true, say: "Acme routes approved leads to assigned owners.", current_stage, next_stage, customer_evidence: [], product_claims: [{ sentence: "Acme routes approved leads to assigned owners.", product_fact_id: "lead-routing" }], source: "model" };
  });
  for (const [id, endMs] of [["one", 10], ["two", 20], ["three", 30]] as const) {
    useStore.setState({ segments: [...useStore.getState().segments, { id, source: "them", speaker: 0, text: "Tell me more.", isFinal: true, startMs: endMs - 5, endMs }] });
    await Promise.resolve();
  }
  expect(observed).toEqual(["opening", "discovery", "discovery"]);
  expect(useStore.getState().findings.map((finding) => finding.detail)).toEqual(["Stage: discovery", "Stage: close"]);
});

it("records do-not-contact and stops later coaching", async () => {
  useStore.setState({ meetingStatus: "recording", meetingId: "dnc", salesMetadata: customSalesMeetingMetadata(profile, {}, "2026-01-01T00:00:00.000Z"), segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
  let calls = 0;
  cleanup = initSalesPilotCoach(async () => { calls += 1; return { needs_coaching: false, say: null, current_stage: "opening", next_stage: "opening", customer_evidence: [], product_claims: [], source: "model" }; });
  useStore.setState({ segments: [{ id: "dnc", source: "them", speaker: 0, text: "Please take us off your list.", isFinal: true, startMs: 0, endMs: 10 }] });
  useStore.setState({ segments: [...useStore.getState().segments, { id: "later", source: "them", speaker: 0, text: "Tell me more.", isFinal: true, startMs: 11, endMs: 20 }] });
  await Promise.resolve();
  expect(calls).toBe(0);
  expect(useStore.getState().findings).toHaveLength(1);
  expect(useStore.getState().findingSolutions["sales-pilot-dnc"]?.solution?.replies[0]?.reply).toBe("Absolutely. I’ll mark this number do-not-call. Thanks for letting me know.");
});

it("does not activate for a general meeting", async () => {
  useStore.setState({ meetingStatus: "recording", meetingId: "general", salesMetadata: null, segments: [] });
  cleanup = initSalesPilotCoach();
  useStore.setState({ segments: [{ id: "turn", source: "them", speaker: 0, text: "Tell me more.", isFinal: true, startMs: 0, endMs: 10 }] });
  await Promise.resolve();
  expect(useStore.getState().findings).toEqual([]);
});
