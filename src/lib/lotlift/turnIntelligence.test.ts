import { describe, expect, it } from "vitest";
import { newLotLiftCallState } from "./callState";
import { analyzeLotLiftTurn, type LotLiftTurnModelOutput } from "./turnIntelligence";
import type { TranscriptSegment } from "../types";

const turn = (text: string, id = "turn-1"): TranscriptSegment => ({ id, text, source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100 });
const model = (output: Partial<LotLiftTurnModelOutput>) => async () => ({ event_type: "none", confidence: 0.9, needs_coaching: false, playbook_rule_ids: [], state_events: [], say: null, goal: null, ...output } as LotLiftTurnModelOutput);
const run = (text: string, output: Partial<LotLiftTurnModelOutput>, recent = [turn(text)]) => analyzeLotLiftTurn({ state: newLotLiftCallState("call-1"), turn: recent[recent.length - 1]!, recent, model: model(output) });

describe("LotLift Turn Intelligence", () => {
  it.each([
    ["price objection", "This is too much money.", "objection:no-budget"],
    ["spouse decision context", "I need to talk to my wife first; this is too much money.", "objection:spouse-partner"],
    ["existing CRM", "We already have a CRM.", "objection:existing-crm"],
    ["not interested", "We are not interested.", "objection:not-interested"],
    ["send information", "Can you send information?", "objection:send-information"],
  ])("uses the relevant policy for %s", async (_name, text, id) => {
    const result = await run(text, { playbook_rule_ids: [id], needs_coaching: true, say: null, goal: null });
    expect(result.playbook_rule_ids).toEqual([id]);
  });

  it("accepts supported buying signal, discovery, and authority events", async () => {
    const text = "Autotrader leads go to me, the general manager, and I would like to schedule Tuesday.";
    const result = await run(text, { event_type: "buying_signal", state_events: [
      { kind: "append", field: "lead_sources", value: "Autotrader", status: "verified", evidence: { segment_id: "turn-1", text: "Autotrader" } },
      { kind: "capture", field: "authority", value: "general manager", status: "verified", evidence: { segment_id: "turn-1", text: "general manager" } },
      { kind: "append", field: "buying_signals", value: "schedule Tuesday", status: "verified", evidence: { segment_id: "turn-1", text: "schedule Tuesday" } },
    ] });
    expect(result.source).toBe("model");
    expect(result.state_events).toHaveLength(3);
  });

  it("returns no advice for an ambiguous statement or no useful event", async () => {
    for (const text of ["Maybe.", "Okay."]) {
      const result = await run(text, {});
      expect(result).toMatchObject({ event_type: "none", needs_coaching: false, say: null, state_events: [] });
    }
  });

  it("rejects hallucinated unsupported output", async () => {
    const result = await run("We use VinSolutions.", { playbook_rule_ids: ["objection:no-budget"], state_events: [
      { kind: "capture", field: "current_solution", value: "DealerSocket", status: "verified", evidence: { segment_id: "turn-1", text: "We use VinSolutions." } },
    ], needs_coaching: true, say: "Invented pricing", goal: "Invented goal" });
    expect(result).toMatchObject({ source: "fallback", state_events: [], say: null });
  });

  it("permits a claim-free contextual discovery question", async () => {
    const result = await run("We are not interested.", { playbook_rule_ids: ["objection:not-interested"], needs_coaching: true, say: "What would make a conversation useful for you?", goal: null });
    expect(result).toMatchObject({ source: "model", say: "What would make a conversation useful for you?" });
  });

  it("rejects a question that introduces a product claim", async () => {
    const result = await run("We are not interested.", { playbook_rule_ids: ["objection:not-interested"], needs_coaching: true, say: "Would our platform save you money?", goal: null });
    expect(result.source).toBe("fallback");
  });

  it("falls back when the local model is slow", async () => {
    const result = await analyzeLotLiftTurn({ state: newLotLiftCallState("call-1"), turn: turn("We are not interested."), recent: [turn("We are not interested.")], timeoutMs: 1, model: async () => new Promise(() => {}) });
    expect(result).toMatchObject({ source: "fallback", event_type: "objection" });
  });

  it("keeps DNC outside the model", async () => {
    const result = await analyzeLotLiftTurn({ state: newLotLiftCallState("call-1"), turn: turn("Do not call again."), recent: [turn("Do not call again.")], model: async () => { throw new Error("must not run"); } });
    expect(result).toMatchObject({ source: "hard-rule", event_type: "do_not_contact" });
  });

  it("captures normalized prospect-spoken email with exact evidence", async () => {
    const result = await run("Send it to John@SmithMotors.com.", {});
    expect(result.state_events).toEqual([expect.objectContaining({ field: "email", fact: expect.objectContaining({ value: "john@smithmotors.com", status: "verified", evidence: { segment_id: "turn-1", text: "John@SmithMotors.com" } }) })]);
  });

  it.each(["Send it to john at smith dot com.", "Send it to john@smithmotors"])("asks to confirm ambiguous email: %s", async (text) => {
    await expect(run(text, {})).resolves.toMatchObject({ source: "hard-rule", say: "Confirm email", state_events: [] });
  });

  it("keeps a general inbox as an email without assigning a person", async () => {
    const result = await run("Send it to info@dealer.com.", {});
    expect(result.state_events).toEqual([expect.objectContaining({ field: "email", fact: expect.objectContaining({ value: "info@dealer.com" }) })]);
  });

  it("requires verified evidence for names, roles, and callback times", async () => {
    const text = "John Smith is the sales manager. Call him back Tuesday at 10.";
    const result = await run(text, { state_events: [
      { kind: "capture", field: "contact_name", value: "John Smith", status: "verified", evidence: { segment_id: "turn-1", text: "John Smith" } },
      { kind: "capture", field: "role", value: "sales manager", status: "verified", evidence: { segment_id: "turn-1", text: "sales manager" } },
      { kind: "capture", field: "next_action_at", value: "Tuesday at 10", status: "verified", evidence: { segment_id: "turn-1", text: "Tuesday at 10" } },
    ] });
    expect(result.state_events).toHaveLength(3);
  });
});
