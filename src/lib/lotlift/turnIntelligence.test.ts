import { describe, expect, it } from "vitest";
import { newLotLiftCallState, reduceLotLiftCallState, type CallStateEvent } from "./callState";
import { lotLiftMoveCandidates } from "./nextMove";
import { analyzeLotLiftTurn, type LotLiftTurnModelOutput } from "./turnIntelligence";
import type { TranscriptSegment } from "../types";

const prospect = (id: string, text: string, at = 0): TranscriptSegment => ({ id, text, source: "them", speaker: 0, isFinal: true, startMs: at, endMs: at + 100 });
const rep = (id: string, text: string, at = 0): TranscriptSegment => ({ id, text, source: "me", speaker: 1, isFinal: true, startMs: at, endMs: at + 100 });
const stateWith = (events: CallStateEvent[]) => events.reduce(reduceLotLiftCallState, newLotLiftCallState("test-call"));
const fact = (field: Extract<CallStateEvent, { type: "append" }>["field"], value: string, segment_id: string): CallStateEvent => ({ type: "append", field, fact: { value, status: "verified", evidence: { segment_id, text: value } } });
const scalar = (field: Extract<CallStateEvent, { type: "capture" }>["field"], value: string, segment_id: string): CallStateEvent => ({ type: "capture", field, fact: { value, status: "verified", evidence: { segment_id, text: value } } });
const output = (selected_move_id: string, spoken_response: string, grounding_segment_ids: string[], observations: LotLiftTurnModelOutput["observations"] = []): LotLiftTurnModelOutput => ({ event_type: "objection", selected_move_id, spoken_response, grounding_segment_ids, observations });

async function run(state: ReturnType<typeof newLotLiftCallState>, conversation: TranscriptSegment[], model: LotLiftTurnModelOutput | Error) {
  const turn = conversation[conversation.length - 1]!;
  return analyzeLotLiftTurn({ state, turn, conversation, model: async () => { if (model instanceof Error) throw model; return model; } });
}

describe("LotLift bounded local SalesPilot", () => {
  it("shows a deterministic first-refusal fallback and terminates a second substantive refusal", async () => {
    const first = prospect("first", "Thank you, but I'm not interested.");
    const firstCandidates = lotLiftMoveCandidates({ state: newLotLiftCallState("first"), turn: first, conversation: [first] });
    expect(firstCandidates).toHaveLength(1);
    const firstResult = await run(newLotLiftCallState("first"), [first], new Error("offline"));
    expect(firstResult).toMatchObject({ source: "fallback", selected_move: { id: "identify-owner" } });
    const secondState = stateWith([{ type: "coaching-progress", move_id: "identify-owner", substantive_refusal: true }]);
    const second = prospect("second", "No thanks, we're not interested.");
    const secondResult = await run(secondState, [second], new Error("offline"));
    expect(secondResult).toMatchObject({ source: "hard-rule", move_id: "second-no-close" });
  });

  it("keeps CRM context and after-hours evidence instead of restarting discovery", async () => {
    const crm = prospect("crm", "We use VinSolutions.", 0);
    const afterHours = prospect("after-hours", "Usually, but things after hours can sit until the morning.", 2_000);
    const current = prospect("current", "We already have a CRM though.", 4_000);
    const state = stateWith([scalar("current_solution", "VinSolutions", "crm"), scalar("after_hours_process", "things after hours can sit until the morning", "after-hours")]);
    const result = await run(state, [crm, rep("r", "Does everything get assigned there?", 1_000), afterHours, current], output("crm-coverage", "That makes sense. When things sit until morning, what happens to those inquiries?", ["current", "after-hours"]));
    expect(result).toMatchObject({ source: "model", move_id: "crm-coverage" });
    expect(result.spoken_response).toContain("sit until morning");
    expect(result.spoken_response).not.toMatch(/which CRM|replace/i);
  });

  it("lets the model select a pain-aware price move using stakeholder evidence", async () => {
    const wife = prospect("wife", "My wife handles the finances.", 0);
    const pain = prospect("pain", "Sometimes leads sit until morning.", 2_000);
    const priority = prospect("priority", "She mainly cares that somebody actually follows up.", 4_000);
    const price = prospect("price", "This still sounds expensive.", 6_000);
    const state = stateWith([fact("decision_stakeholders", "wife", "wife"), fact("pain_points", "leads sit until morning", "pain"), fact("pain_points", "somebody actually follows up", "priority")]);
    const candidates = lotLiftMoveCandidates({ state, turn: price, conversation: [wife, pain, priority, price] });
    expect(candidates.map((candidate) => candidate.id)).toEqual(expect.arrayContaining(["price-isolation", "price-pain-value"]));
    const result = await run(state, [wife, pain, priority, price], output("price-pain-value", "Got it. You mentioned your wife cares that somebody actually follows up, so is the concern the spend itself or whether fixing that gap feels worth it?", ["price", "wife", "priority"]));
    expect(result).toMatchObject({ source: "model", move_id: "price-pain-value" });
    expect(result.spoken_response).toContain("wife");
    expect(result.spoken_response).not.toMatch(/\$|ROI|guarantee/i);
  });

  it("changes price candidates for pain, stakeholder, and an already-used diagnostic", () => {
    const price = prospect("price", "This sounds expensive.");
    const plain = lotLiftMoveCandidates({ state: newLotLiftCallState("plain"), turn: price, conversation: [price] });
    const pain = stateWith([fact("pain_points", "leads sit until morning", "pain")]);
    const stakeholder = stateWith([fact("decision_stakeholders", "wife", "wife"), scalar("workflow_owner", "manager", "wife"), scalar("authority", "owner", "wife")]);
    const repeated = stateWith([{ type: "coaching-progress", move_id: "price-isolation" }]);
    expect(lotLiftMoveCandidates({ state: pain, turn: price, conversation: [price] }).map((move) => move.id)).toContain("price-pain-value");
    expect(lotLiftMoveCandidates({ state: stakeholder, turn: price, conversation: [price] }).map((move) => move.id)).toContain("price-stakeholder-criteria");
    expect(plain[0]!.id).toBe("price-isolation");
    expect(lotLiftMoveCandidates({ state: repeated, turn: price, conversation: [price] })[0]!.id).toBe("price-next-criterion");
  });

  it("does not offer irrelevant early evidence to the model", async () => {
    const irrelevant = prospect("irrelevant", "Our mascot is a pigeon.", 0);
    const price = prospect("price", "This sounds expensive.", 2_000);
    const result = await run(newLotLiftCallState("irrelevant"), [irrelevant, price], output("price-isolation", "I hear you. Is the concern the spend itself or whether the value is clear?", ["price"]));
    expect(result).toMatchObject({ source: "model", move_id: "price-isolation" });
  });

  it("retrieves early durable evidence after a long call without raw-transcript fallback", async () => {
    const early = prospect("early", "Leads sit until morning after hours.", 0);
    const filler = Array.from({ length: 55 }, (_, index) => [rep(`r${index}`, "Thanks for that detail.", index * 400 + 100), prospect(`p${index}`, `Unrelated detail number ${index} ${"x".repeat(220)}.`, index * 400 + 200)]).flat();
    const price = prospect("price", "This sounds expensive.", 30_000);
    const state = stateWith([fact("pain_points", "Leads sit until morning after hours", "early")]);
    const result = await run(state, [early, ...filler, price], output("price-pain-value", "I hear you. Since leads sit until morning after hours, is the concern the spend or whether closing that gap is worth it?", ["price", "early"]));
    expect(result).toMatchObject({ source: "model", move_id: "price-pain-value" });
  });

  it("keeps DNC deterministic and validates bad local output to the visible fallback", async () => {
    const dnc = prospect("dnc", "Take us off your list.");
    const dncResult = await run(newLotLiftCallState("dnc"), [dnc], output("identify-owner", "Who owns this?", ["dnc"]));
    expect(dncResult).toMatchObject({ source: "hard-rule", event_type: "do_not_contact" });
    const price = prospect("price", "This is too expensive.");
    const badResult = await run(newLotLiftCallState("bad"), [price], output("invented", "LotLift will save you money.", ["price"]));
    expect(badResult).toMatchObject({ source: "fallback", fallback_reason: "invalid-output", move_id: "price-isolation" });
  });

  it("captures only exact cited semantic observations as inferred memory", async () => {
    const crm = prospect("crm", "We use VinSolutions.", 0);
    const current = prospect("current", "This sounds expensive.", 1_000);
    const result = await run(newLotLiftCallState("memory"), [crm, current], output("price-isolation", "I hear you. Is the concern the spend itself or whether the value is clear?", ["current"], [{ field: "current_solution", value: "VinSolutions", evidence_segment_id: "crm" }]));
    expect(result.state_events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "capture", field: "current_solution", fact: expect.objectContaining({ status: "inferred" }) })]));
  });

  it("keeps the immediate fallback when the local selector times out", async () => {
    const turn = prospect("timeout", "Who is this?");
    const result = await analyzeLotLiftTurn({
      state: newLotLiftCallState("timeout"), turn, conversation: [turn], timeoutMs: 10,
      model: async ({ signal }) => new Promise<LotLiftTurnModelOutput>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    });
    expect(result).toMatchObject({ source: "fallback", fallback_reason: "timeout", move_id: "identify-owner" });
  });

  it("rejects unsupported commercial claims even when the model selects an eligible move", async () => {
    const price = prospect("price", "This sounds expensive.");
    const result = await run(newLotLiftCallState("claims"), [price], output("price-isolation", "LotLift integrates with every CRM and guarantees a return.", ["price"]));
    expect(result).toMatchObject({ source: "fallback", fallback_reason: "invalid-output", move_id: "price-isolation" });
  });

  it("permits ordinary contextual speech that stays within the selected price tactic", async () => {
    const price = prospect("ordinary-price", "The cost sounds high.");
    const result = await run(newLotLiftCallState("ordinary-price"), [price], output("price-isolation", "I hear you. Is the concern the spend itself or whether the value is clear?", ["ordinary-price"]));

    expect(result).toMatchObject({ source: "model", move_id: "price-isolation" });
    expect(result.spoken_response).not.toMatch(/[$€£¥]\s*\d|\b(?:quote|discount|guarantee|roi)\b/i);
  });

  it("rejects an observation whose cited prospect evidence does not contain its value", async () => {
    const turn = prospect("observation", "We use VinSolutions.");
    const result = await run(newLotLiftCallState("observation"), [turn], output("crm-coverage", "That makes sense. When does that workflow leave an inquiry waiting?", ["observation"], [{ field: "current_solution", value: "DealerSocket", evidence_segment_id: "observation" }]));
    expect(result).toMatchObject({ source: "fallback", fallback_reason: "invalid-output" });
  });

  it("does not let an inferred observation replace conflicting verified state", async () => {
    const state = stateWith([scalar("current_solution", "VinSolutions", "verified-crm")]);
    const turn = prospect("new-crm", "We use DealerSocket CRM now.");
    const result = await run(state, [turn], output("crm-coverage", "That makes sense. When does that workflow leave an inquiry waiting?", ["new-crm"], [{ field: "current_solution", value: "DealerSocket", evidence_segment_id: "new-crm" }]));

    expect(result).toMatchObject({ source: "fallback", fallback_reason: "invalid-output", move_id: "crm-coverage" });
  });

  it("permits the workflow-check move only after its verified policy gates", async () => {
    const evidence = { segment_id: "ready", text: "confirmed" };
    const state = stateWith([
      { type: "capture", field: "workflow_owner", fact: { value: "manager", status: "verified", evidence } },
      { type: "capture", field: "authority", fact: { value: "owner", status: "verified", evidence } },
      { type: "append", field: "lead_sources", fact: { value: "AutoTrader", status: "verified", evidence } },
      { type: "append", field: "pain_points", fact: { value: "unworked leads", status: "verified", evidence } },
      { type: "capture", field: "after_hours_process", fact: { value: "no coverage", status: "verified", evidence } },
      { type: "capture", field: "visibility_process", fact: { value: "no review", status: "verified", evidence } },
    ]);
    const turn = prospect("ready", "That sounds useful.");
    const result = await run(state, [turn], output("workflow-check", "It sounds worth mapping the workflow in a short 15-minute check. Would you be open to that?", ["ready"]));
    expect(result).toMatchObject({ source: "model", move_id: "workflow-check" });
  });
});
