import { describe, expect, it } from "vitest";
import { deriveLotLiftCallPhase, newLotLiftCallState, reduceLotLiftCallState } from "./callState";
import { deriveLotLiftCurrentTurnState, lotLiftMoveCandidates, selectLotLiftNextMove } from "./nextMove";
import type { TranscriptSegment } from "../types";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../../../sales-profiles/lotlift/profile";
import { resolveSalesProfile } from "../sales/profiles";

const turn = (text: string, id = "turn"): TranscriptSegment => ({ id, text, source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100 });
const verified = (value: string, id = "evidence") => ({ value, status: "verified" as const, evidence: { segment_id: id, text: value } });
const select = (state: ReturnType<typeof newLotLiftCallState>, text: string) => selectLotLiftNextMove({ state, turn: turn(text), conversation: [turn(text)] });

describe("LotLift next moves", () => {
  it("always returns an approved context-aware response for an unmatched prospect turn", () => {
    const move = select(newLotLiftCallState("unmatched"), "Can you explain what you mean?");
    expect(move).toMatchObject({ id: "identify-owner", source: "approved-move" });
    expect(move.response).toContain("Who owns paid online inquiry response");
  });

  it.each(["I'm in charge of it.", "That falls under me.", "Online leads are mine.", "Yeah, I handle that."])("verifies an explicit ownership confirmation: %s", (text) => {
    const current = deriveLotLiftCurrentTurnState(newLotLiftCallState(`owner-${text}`), turn(text));
    expect(current.state.workflow_owner).toMatchObject({ status: "verified", value: text });
  });

  it("moves a self-confirmed gatekeeper into right-person discovery without re-asking ownership", () => {
    const initial = newLotLiftCallState("gatekeeper-self-confirmation");
    const prospect = turn("That's me.", "self-confirmation");
    const current = deriveLotLiftCurrentTurnState(initial, prospect);
    const profile = resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE);
    const candidates = lotLiftMoveCandidates({ state: initial, turn: prospect, conversation: [prospect], currentTurnState: current, resolvedProfile: profile });

    expect(current.state.workflow_owner).toMatchObject({ status: "verified", value: "That's me." });
    expect(deriveLotLiftCallPhase(current.state)).toBe("RIGHT_PERSON");
    expect(candidates[0]).toMatchObject({ id: "right-person-process", stage: "relevance-discovery" });
    expect(candidates.map((candidate) => candidate.id)).not.toContain("O3");
    expect(candidates.map((candidate) => candidate.id)).not.toContain("identify-owner");
    expect(candidates[0]?.response).toBe("How are you guys handling your online leads right now, especially after hours?");
  });

  it("updates verified ownership only from an explicit correction", () => {
    let state = newLotLiftCallState("owner-correction");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("Jordan handles paid online leads.", "jordan") });
    const current = deriveLotLiftCurrentTurnState(state, turn("Actually, Sarah handles paid online leads.", "sarah"));

    expect(current.state.workflow_owner).toMatchObject({ status: "verified", value: "Actually, Sarah handles paid online leads.", evidence: { segment_id: "sarah" } });
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

  it.each([
    "My team already ignores half the tools we buy.",
    "We have too much turnover to train another system.",
    "We tried software like this before and nobody used it.",
  ])("routes staff-adoption safely: %s", (text) => {
    let state = newLotLiftCallState("staff-adoption");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("I handle them.", "owner") });
    const move = select(state, text);
    expect(move).toMatchObject({ id: "staff-adoption", source: "approved-move" });
    expect(move.response).toMatch(/what made|what would/i);
    expect(move.response).not.toMatch(/automate|guarantee|results|replace|monitoring capability/i);
    expect((move.response.match(/\?/g) ?? [])).toHaveLength(1);
  });

  it.each(["AI is all hype. We don't need another gimmick.", "Is this going to replace my BDC people?"])("routes AI skepticism safely: %s", (text) => {
    let state = newLotLiftCallState("ai-skepticism");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("I handle them.", "owner") });
    const move = select(state, text);
    expect(move).toMatchObject({ id: "ai-skepticism", source: "approved-move" });
    expect(move.response).toMatch(/purpose|workflow/i);
    expect(move.response).not.toMatch(/replace|guarantee|results|security|perform/i);
    expect((move.response.match(/\?/g) ?? [])).toHaveLength(1);
  });

  it("routes long-tenure software to a profile-governed contextual response", () => {
    let state = newLotLiftCallState("tenure-crm");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("I handle them.", "owner") });
    state = reduceLotLiftCallState(state, { type: "capture", field: "current_solution", fact: verified("VinSolutions", "crm") });
    const prospect = turn("We've used VinSolutions for 15 years. Why would we change now?");
    const move = selectLotLiftNextMove({ state, turn: prospect, conversation: [prospect], resolvedProfile: resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE) });
    expect(move).toMatchObject({ id: "contextual-response", tactic_id: "contextual-answer", source: "approved-move" });
    expect(move.response).not.toMatch(/replace|better than|after hours/i);
    expect((move.response.match(/\?/g) ?? [])).toHaveLength(1);
  });

  it("uses contextual response without restarting O3 after ownership is verified", () => {
    let state = newLotLiftCallState("owner-known");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("That would be me.", "owner") });
    const prospect = turn("Guys, why are you calling?");
    const move = selectLotLiftNextMove({ state, turn: prospect, conversation: [prospect], resolvedProfile: resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE) });
    expect(move).toMatchObject({ id: "contextual-response", source: "approved-move" });
    expect(move.response).not.toMatch(/is that you|who handles|who owns/i);
  });

  it.each([
    ["AI product question", "Do you use AI to respond to online leads?"],
    ["random direct question", "What makes this useful?"],
    ["usefulness after discovery", "How would that actually help us?"],
  ])("routes %s to contextual response after stronger policy routes decline", (_name, text) => {
    let state = newLotLiftCallState(`contextual-${text}`);
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("I handle them.", "owner") });
    const prospect = turn(text);
    const move = selectLotLiftNextMove({ state, turn: prospect, conversation: [prospect], resolvedProfile: resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE) });
    expect(move).toMatchObject({ id: "contextual-response", tactic_id: "contextual-answer" });
    expect(move.response).not.toMatch(/who (?:owns|handles)|is that you/i);
    expect((move.response.match(/\?/g) ?? [])).toHaveLength(1);
  });

  it("keeps fresh purpose questions on the O3 card", () => {
    const prospect = turn("Why are you calling?");
    const move = selectLotLiftNextMove({ state: newLotLiftCallState("fresh-why"), turn: prospect, conversation: [prospect], approvedRepIdentity: "Alex", resolvedProfile: resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE) });
    expect(move).toMatchObject({ id: "O3", source: "approved-move" });
  });

  it("keeps an existing CRM route after ownership is verified", () => {
    let state = newLotLiftCallState("crm-known");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("I handle them.", "owner") });
    const prospect = turn("We already use VinSolutions CRM.");
    const move = selectLotLiftNextMove({ state, turn: prospect, conversation: [prospect], resolvedProfile: resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE) });
    expect(move).toMatchObject({ id: "crm-coverage", source: "approved-move" });
    expect(move.response).not.toMatch(/what (?:system|crm)|which crm|what do you use/i);
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

  it("advances a factual-only answer through ordinary discovery", () => {
    let state = newLotLiftCallState("factual-answer");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("I handle paid inquiries.", "owner") });
    const profile = resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE);
    const prospect = turn("We get a mix from the usual sites.", "neutral-context");
    const move = selectLotLiftNextMove({ state, turn: prospect, conversation: [prospect], resolvedProfile: profile });

    expect(move).toMatchObject({ id: "lead-source", discovery_dimension: "lead-source", source: "approved-move" });
    expect(move.id).not.toBe("contextual-response");
  });

  it.each(["I don’t understand.", "Tell me more."])("handles an unrecognized substantive request before discovery: %s", (text) => {
    let state = newLotLiftCallState(`contextual-${text}`);
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("I handle paid inquiries.", "owner") });
    const prospect = turn(text, `request-${text}`);
    const move = selectLotLiftNextMove({ state, turn: prospect, conversation: [prospect], resolvedProfile: resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE) });

    expect(move).toMatchObject({ id: "contextual-response", tactic_id: "contextual-answer" });
    expect(move.id).not.toBe("lead-source");
  });

  it.each([
    "I just don't see this fitting how we operate.",
    "This feels like a lot for a problem I don't think we have.",
    "I'm not convinced this is worth changing anything for.",
    "What am I missing here?",
  ])("routes novel substantive context before ordinary discovery: %s", (text) => {
    let state = newLotLiftCallState(`novel-${text}`);
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("I handle paid inquiries.", "owner") });
    const prospect = turn(text, `novel-turn-${text}`);
    const move = selectLotLiftNextMove({ state, turn: prospect, conversation: [prospect], resolvedProfile: resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE) });

    expect(move).toMatchObject({ id: "contextual-response", source: "approved-move" });
    expect(move.id).not.toBe("lead-source");
  });

  it("answers a direct question after ownership is verified", () => {
    const profile = resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE);
    let state = newLotLiftCallState("owner-question");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("I handle paid inquiries.", "owner") });
    const prospect = turn("Why are you calling?", "owner-question");
    const move = selectLotLiftNextMove({ state, turn: prospect, conversation: [prospect], resolvedProfile: profile });

    expect(move).toMatchObject({ id: "contextual-response", tactic_id: "contextual-answer" });
    expect(move.response).not.toMatch(/who owns|is that you/i);
  });

  it("uses the next workflow objective when a verified owner asks how to help", () => {
    let state = newLotLiftCallState("owner-help");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("That’s me.", "owner") });
    const prospect = turn("How can I help?", "owner-help");
    const move = selectLotLiftNextMove({ state, turn: prospect, conversation: [prospect], resolvedProfile: resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE) });

    expect(move).toMatchObject({ id: "contextual-response" });
    expect(move.response).toContain("Which online sources generate most buyer inquiries today?");
    expect(move.id).not.toBe("O3");
  });

  it("skips verified after-hours coverage and advances to visibility", () => {
    let state = newLotLiftCallState("after-hours-complete");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("I handle paid inquiries.", "owner") });
    state = reduceLotLiftCallState(state, { type: "append", field: "lead_sources", fact: verified("Cars.com", "source") });
    state = reduceLotLiftCallState(state, { type: "capture", field: "after_hours_process", fact: verified("The BDC covers after hours.", "after-hours") });
    const move = selectLotLiftNextMove({ state, turn: turn("Mostly Cars.com and CarGurus.", "factual"), conversation: [], resolvedProfile: resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE) });

    expect(move).toMatchObject({ id: "gap-visibility", discovery_dimension: "visibility" });
    expect(move.response).not.toMatch(/after hours/i);
  });

  it("makes a workflow check eligible after verified discovery and authority", () => {
    let state = newLotLiftCallState("qualified-workflow");
    for (const [field, value] of [["workflow_owner", "I handle paid inquiries."], ["lead_arrival_point", "VinSolutions"], ["after_hours_process", "The BDC covers after hours."], ["visibility_process", "We audit the inbox."], ["authority", "I decide on workflow changes."]] as const) {
      state = reduceLotLiftCallState(state, { type: "capture", field, fact: verified(value, field) });
    }
    state = reduceLotLiftCallState(state, { type: "append", field: "pain_points", fact: verified("Leads can sit overnight.", "pain") });
    const move = selectLotLiftNextMove({ state, turn: turn("Yes.", "qualified"), conversation: [], resolvedProfile: resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE) });

    expect(move).toMatchObject({ id: "workflow-check", stage: "meeting-invitation" });
  });

  it("does not restart CRM discovery after the CRM is verified", () => {
    let state = newLotLiftCallState("crm-repeat");
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("I handle them.", "owner") });
    state = reduceLotLiftCallState(state, { type: "capture", field: "current_solution", fact: verified("VinSolutions", "crm") });
    const prospect = turn("Can you explain how this would work with our process?", "crm-question");
    const move = selectLotLiftNextMove({ state, turn: prospect, conversation: [prospect], resolvedProfile: resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE) });

    expect(move).toMatchObject({ id: "contextual-response" });
    expect(move.response).not.toMatch(/what (?:system|crm)|which crm|what do you use/i);
  });

  it.each([
    ["trust concern", "My salespeople will think we're spying on them.", "contextual-response"],
    ["AI skepticism", "AI is all hype. We don't need another gimmick.", "ai-skepticism"],
    ["required integration", "We need a direct DMS integration before anything else.", "hard-integration-close"],
    ["security", "We need security details.", "security-authorization"],
    ["provider authorization", "That provider is not authorized to allow this.", "security-authorization"],
    ["competitor", "We use another provider.", "competitor-criteria"],
  ])("keeps %s ahead of the generic contextual move", (_name, text, id) => {
    let state = newLotLiftCallState(`priority-${id}`);
    state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: verified("I handle paid inquiries.", "owner") });
    const profile = resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE);
    const prospect = turn(text, `priority-${id}`);
    const move = selectLotLiftNextMove({ state, turn: prospect, conversation: [prospect], resolvedProfile: profile });

    expect(move.id).toBe(id);
    expect(move.id).not.toBe("generic-contextual-discovery");
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

  it("routes a novel spying concern to contextual response", () => {
    const state = newLotLiftCallState("novel-concern");
    const prospect = turn("I worry the staff will think this is spying on them.");
    const move = selectLotLiftNextMove({ state, turn: prospect, conversation: [prospect], resolvedProfile: resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE) });
    expect(move).toMatchObject({ id: "contextual-response", tactic_id: "contextual-answer", source: "approved-move" });
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
    ["We are happy with what we have.", "identify-owner", "discovery:ownership"],
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
