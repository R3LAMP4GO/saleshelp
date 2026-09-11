import { describe, expect, it } from "vitest";
import { newLotLiftCallState, reduceLotLiftCallState } from "./callState";
import { lotLiftMoveCandidates, selectLotLiftNextMove } from "./nextMove";
import type { TranscriptSegment } from "../types";

const turn = (text: string, id = "turn"): TranscriptSegment => ({ id, text, source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100 });
const verified = (value: string, id = "evidence") => ({ value, status: "verified" as const, evidence: { segment_id: id, text: value } });
const select = (state: ReturnType<typeof newLotLiftCallState>, text: string) => selectLotLiftNextMove({ state, turn: turn(text), conversation: [turn(text)] });

describe("LotLift next moves", () => {
  it("always returns an approved context-aware response for an unmatched prospect turn", () => {
    const move = select(newLotLiftCallState("unmatched"), "Can you explain what you mean?");
    expect(move).toMatchObject({ id: "identify-owner", source: "approved-move" });
    expect(move.response).toContain("Who owns paid online inquiry response");
  });

  it("uses a distinct lead-recovery coverage move instead of the generic question", () => {
    const move = select(newLotLiftCallState("recovery"), "We lose online leads overnight when nobody owns them.");
    expect(move).toMatchObject({ id: "impact-coverage", discovery_dimension: "ownership" });
    expect(move.response).toContain("especially after hours");
    expect(move.response).not.toContain("What matters most");
  });

  it("selects impact coverage for the reported lost-lead recovery wording", () => {
    const move = select(newLotLiftCallState("lost-leads"), "I mean, to be honest, what matters most is if I can recover even that small sliver of leads I've already lost.");
    expect(move).toMatchObject({ id: "impact-coverage", discovery_dimension: "ownership", source: "approved-move" });
    expect(move.response).toContain("after hours");
    expect((move.response.match(/\?/g) ?? [])).toHaveLength(1);
    expect(move.response).not.toMatch(/15-minute|guarantee|\$\d/i);
  });

  it("uses the configured identity as the only candidate for an explicit identity question", () => {
    const prospect = turn("Who are you?", "identity");
    const candidates = lotLiftMoveCandidates({ state: newLotLiftCallState("identity"), turn: prospect, conversation: [prospect], approvedRepIdentity: "Alex" });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ id: "O2", source: "approved-move" });
    expect(candidates[0]?.response).toContain("Alex");
    expect(candidates[0]?.response).not.toMatch(/\?|15-minute|price/i);
  });

  it("clarifies a direct price question before quoting or negotiating", () => {
    const move = select(newLotLiftCallState("price-question"), "How much is it?");

    expect(move).toMatchObject({ id: "price-isolation", tactic_id: "concern-isolation" });
    expect((move.response.match(/\?/g) ?? [])).toHaveLength(1);
    expect(move.response).not.toMatch(/[$€£¥]\s*\d|\b(?:quote|discount|offer|deal)\b/i);
  });

  it("keeps a first price concern on the value path after the prospect clarifies the uncertainty", () => {
    let state = newLotLiftCallState("price-value");
    state = reduceLotLiftCallState(state, {
      type: "decision-context",
      blockers: [verified("price/value uncertainty", "price")],
      stakeholders: [],
      selected_objection_route: verified("price-value", "price"),
    });
    const move = select(state, "It is whether the value is clear.");
    expect(move).toMatchObject({ id: "price-value-uncertainty", source: "approved-move" });
    expect(move.response).not.toMatch(/recover|ROI|return on investment|15-minute/i);
  });

  it("offers the approved workflow check for value uncertainty only after verified workflow and authority", () => {
    let state = newLotLiftCallState("price-value-ready");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("BDC manager") });
    state = reduceLotLiftCallState(state, { type: "append", field: "lead_sources", fact: verified("AutoTrader") });
    state = reduceLotLiftCallState(state, { type: "append", field: "pain_points", fact: verified("Online leads wait overnight") });
    state = reduceLotLiftCallState(state, { type: "capture", field: "authority", fact: verified("I make the decision") });
    state = reduceLotLiftCallState(state, {
      type: "decision-context",
      blockers: [verified("price/value uncertainty", "price")],
      stakeholders: [],
      selected_objection_route: verified("price-value", "price"),
    });
    const move = select(state, "Yes, it is whether the value is clear.");
    expect(move).toMatchObject({ id: "price-value-workflow-check", stage: "meeting-invitation", tactic_id: "scoped-next-step" });
    expect(move.response).toContain("15-minute workflow check");
    expect(move.response).not.toMatch(/recover|ROI|return on investment/i);
  });

  it("unlocks the approved 15-minute workflow check after verified pain and authority", () => {
    let state = newLotLiftCallState("close");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("BDC manager") });
    state = reduceLotLiftCallState(state, { type: "append", field: "lead_sources", fact: verified("AutoTrader") });
    state = reduceLotLiftCallState(state, { type: "append", field: "pain_points", fact: verified("Online leads wait overnight") });
    state = reduceLotLiftCallState(state, { type: "capture", field: "authority", fact: verified("I make the decision") });
    const move = select(state, "Yes, that is the problem.");
    expect(move).toMatchObject({ id: "workflow-check", stage: "meeting-invitation" });
    expect(move.response).toContain("15-minute workflow check");
    expect(move.response).not.toMatch(/Tuesday|Thursday|calendar/i);
  });

  it("keeps a meeting ask behind explicit prospect consent", () => {
    let state = newLotLiftCallState("no-consent");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("BDC manager") });
    state = reduceLotLiftCallState(state, { type: "append", field: "lead_sources", fact: verified("AutoTrader") });
    state = reduceLotLiftCallState(state, { type: "append", field: "pain_points", fact: verified("Online inquiries wait overnight") });
    state = reduceLotLiftCallState(state, { type: "capture", field: "authority", fact: verified("I make the decision") });
    const move = select(state, "I am not sure.");
    expect(move).toMatchObject({ id: "confirm-authority", tactic_id: "solution-verification" });
    expect(move.response).not.toContain("15-minute");
  });

  it("advances unmatched discovery turns without repeating a dimension", () => {
    let state = newLotLiftCallState("discovery");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("Internet manager") });
    state = reduceLotLiftCallState(state, { type: "append", field: "lead_sources", fact: verified("Cars.com") });
    const first = select(state, "I am not sure.");
    state = reduceLotLiftCallState(state, first.state_events.find((event) => event.type === "coaching-progress")!);
    const second = select(state, "Can you explain?");
    expect(first.discovery_dimension).toBe("after-hours");
    expect(second.discovery_dimension).toBe("visibility");
  });

  it.each([
    ["abuse", "Stop calling, you idiot."],
    ["required integration", "We need a direct DMS integration before anything else."],
    ["unsupported fit", "We have no online inquiries at all."],
  ])("suppresses meeting language for %s", (_name, text) => {
    const move = select(newLotLiftCallState("terminal"), text);
    expect(move.source).toBe("terminal-policy");
    expect(move.response).not.toMatch(/15-minute|workflow check|open to that/i);
  });

  it("progresses first refusal state organically, then exits only on the second refusal", () => {
    let state = newLotLiftCallState("second-no");
    const first = select(state, "No thanks, not interested.");
    expect(first).toMatchObject({ id: "first-refusal", tactic_id: "permission-and-route", rule_ids: ["objection:not-interested"] });
    state = first.state_events.reduce(reduceLotLiftCallState, state);
    const second = select(state, "No thanks, not interested.");
    expect(second).toMatchObject({ id: "second-no-close", source: "terminal-policy" });
  });

  it("uses guided objection discovery for a genuinely unmatched concern", () => {
    const move = select(newLotLiftCallState("novel-concern"), "I worry the staff will think this is spying on them.");
    expect(move).toMatchObject({ id: "guided-objection-discovery", tactic_id: "concern-isolation", source: "approved-move" });
    expect((move.response.match(/\?/g) ?? [])).toHaveLength(1);
    expect(move.response).not.toMatch(/prove|guarantee|15-minute|price/i);
  });

  it("allows genuine re-engagement after a refusal", () => {
    let state = newLotLiftCallState("re-engagement");
    state = select(state, "No thanks, not interested.").state_events.reduce(reduceLotLiftCallState, state);
    const move = select(state, "Actually, our leads do sit overnight sometimes.");
    expect(move).toMatchObject({ source: "approved-move" });
    expect(move.id).not.toBe("second-no-close");
  });

  it.each([
    ["Send information.", "information-topic", "objection:send-information"],
    ["Call me later.", "timing-follow-up", "objection:call-later"],
    ["We need to think about it.", "decision-criteria", "objection:need-to-think"],
    ["We already have a BDC.", "existing-workflow-coverage", "objection:existing-crm"],
    ["We are happy with what we have.", "existing-workflow-coverage", "objection:status-quo"],
    ["We are too small.", "fit-source-volume", "objection:team-size"],
    ["We use another provider.", "competitor-criteria", "objection:competitor"],
    ["We need security details.", "security-authorization", "objection:data-security"],
    ["Do you support every marketplace?", "security-authorization", "objection:marketplace-coverage"],
    ["Can we have a free trial?", "decision-criteria", "objection:trial"],
  ])("routes %s to a policy-bounded non-discovery candidate", (text, id, ruleId) => {
    const candidate = select(newLotLiftCallState(`matrix-${id}`), text);
    expect(candidate).toMatchObject({ id, rule_ids: [ruleId], source: "approved-move" });
    expect(candidate.response).toBe(candidate.fallback_response);
    expect(candidate.prohibited_behavior).toBeTruthy();
  });
});
