import { describe, expect, it } from "vitest";
import { newLotLiftCallState, reduceLotLiftCallState, type CallStateEvent } from "./callState";
import { lotLiftMoveCandidates } from "./nextMove";
import { buildLotLiftResponseCompositionContext, validateLotLiftObservationExtraction } from "./responseComposer";
import { analyzeLotLiftTurn, type LotLiftTurnModelOutput } from "./turnIntelligence";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../../../sales-profiles/lotlift/profile";
import { resolveSalesProfile } from "../sales/profiles";
import type { Settings, TranscriptSegment } from "../types";

const prospect = (id: string, text: string, at = 0): TranscriptSegment => ({ id, text, source: "them", speaker: 0, isFinal: true, startMs: at, endMs: at + 100 });
const rep = (id: string, text: string, at = 0): TranscriptSegment => ({ id, text, source: "me", speaker: 1, isFinal: true, startMs: at, endMs: at + 100 });
const stateWith = (events: CallStateEvent[]) => events.reduce(reduceLotLiftCallState, newLotLiftCallState("test-call"));
const fact = (field: Extract<CallStateEvent, { type: "append" }>["field"], value: string, segment_id: string): CallStateEvent => ({ type: "append", field, fact: { value, status: "verified", evidence: { segment_id, text: value } } });
const scalar = (field: Extract<CallStateEvent, { type: "capture" }>["field"], value: string, segment_id: string): CallStateEvent => ({ type: "capture", field, fact: { value, status: "verified", evidence: { segment_id, text: value } } });
const output = (selected_move_id: string, spoken_response: string, grounding_segment_ids: string[]): LotLiftTurnModelOutput => ({ selected_move_id, spoken_response, grounding_segment_ids });

async function run(state: ReturnType<typeof newLotLiftCallState>, conversation: TranscriptSegment[], model: LotLiftTurnModelOutput | Error, settings?: Settings) {
  const turn = conversation[conversation.length - 1]!;
  return analyzeLotLiftTurn({ state, turn, conversation, settings, model: async () => { if (model instanceof Error) throw model; return model; } });
}

const repSettings = { userName: "Isaiah", llmProviders: { realtime: "ollama" }, models: { ollama: { realtime: "qwen3:4b" } }, lotLiftLocalModelDeadlineMs: 2_000 } as Settings;

describe("LotLift bounded local SalesPilot", () => {
  it("uses the resolved O2 script without requesting a model for curly punctuation", async () => {
    let requests = 0;
    const turn = prospect("resolved-o2", "Who’s this?");
    const resolvedProfile = resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE, { ...LOTLIFT_COLD_OUTBOUND_PROFILE.behavior, moves: LOTLIFT_COLD_OUTBOUND_PROFILE.behavior.moves.map((move) => move.id === "O2" ? { ...move, script: "This is [configured rep name] with LotLift." } : move) });
    const result = await analyzeLotLiftTurn({ state: newLotLiftCallState("resolved-o2"), turn, conversation: [turn], settings: repSettings, resolvedProfile, model: async () => { requests += 1; throw new Error("model must not run"); } });
    expect(result).toMatchObject({ source: "hard-rule", move_id: "O2", selected_move: { response: "This is Isaiah with LotLift.", response_mode: "template" } });
    expect(requests).toBe(0);
  });

  it("uses the resolved O3 script without requesting a model", async () => {
    let requests = 0;
    const turn = prospect("resolved-o3", "How can I help?");
    const result = await analyzeLotLiftTurn({ state: newLotLiftCallState("resolved-o3"), turn, conversation: [turn], settings: repSettings, resolvedProfile: resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE), model: async () => { requests += 1; throw new Error("model must not run"); } });
    expect(result.source).toBe("hard-rule");
    expect(result.selected_move?.id).toBe("O3");
    expect(result.selected_move?.response_mode).toBe("verbatim");
    expect(requests).toBe(0);
  });

  it("shows a deterministic first-refusal fallback and terminates a second substantive refusal", async () => {
    const first = prospect("first", "Thank you, but I'm not interested.");
    const firstCandidates = lotLiftMoveCandidates({ state: newLotLiftCallState("first"), turn: first, conversation: [first] });
    expect(firstCandidates).toHaveLength(1);
    const firstResult = await run(newLotLiftCallState("first"), [first], new Error("offline"));
    expect(firstResult).toMatchObject({ source: "fallback", selected_move: { id: "first-refusal" } });
    const secondState = stateWith(firstCandidates[0]!.state_events);
    const second = prospect("second", "No thanks, we're not interested.");
    const secondResult = await run(secondState, [second], new Error("offline"));
    expect(secondResult).toMatchObject({ source: "hard-rule", move_id: "second-no-close" });
  });

  it("advances O2 through O3 into CRM-aware discovery using only actual returned state and rep speech", async () => {
    let state = newLotLiftCallState("opening-spine");
    const who = prospect("who", "Who is this?", 0);
    const identity = await run(state, [who], new Error("offline"), repSettings);
    expect(identity).toMatchObject({ move_id: "O2", source: "hard-rule" });
    state = identity.state_events.reduce(reduceLotLiftCallState, state);
    const saidIdentity = rep("said-o2", identity.selected_move!.fallback_response, 1_000);

    const purposeQuestion = prospect("purpose", "What's this regarding?", 2_000);
    const purpose = await run(state, [who, saidIdentity, purposeQuestion], new Error("offline"), repSettings);
    expect(purpose).toMatchObject({ move_id: "O3", source: "hard-rule" });
    expect(purpose.selected_move!.response).not.toMatch(/^Who is this|^Who owns/i);
    state = purpose.state_events.reduce(reduceLotLiftCallState, state);
    const saidPurpose = rep("said-o3", purpose.selected_move!.fallback_response, 3_000);

    const crm = prospect("crm", "Yeah, I guess. We use VinSolutions.", 4_000);
    const crmResult = await run(state, [who, saidIdentity, purposeQuestion, saidPurpose, crm], new Error("offline"), repSettings);
    expect(crmResult).toMatchObject({ move_id: "crm-coverage", source: "fallback" });
    expect(crmResult.selected_move!.response).not.toMatch(/which CRM|replace/i);
    state = crmResult.state_events.reduce(reduceLotLiftCallState, state);
    expect(state.current_solution).toMatchObject({ value: "VinSolutions", status: "verified" });

    const afterHours = prospect("after-hours", "Some stuff that comes in after hours sits until the morning.", 5_000);
    const afterHoursResult = await run(state, [who, saidIdentity, purposeQuestion, saidPurpose, crm, afterHours], new Error("offline"), repSettings);
    state = afterHoursResult.state_events.reduce(reduceLotLiftCallState, state);
    expect(state.after_hours_process).toMatchObject({ value: afterHours.text, status: "verified" });
    expect(state.pain_points).toEqual(expect.arrayContaining([expect.objectContaining({ value: afterHours.text })]));

    const crmAgain = prospect("crm-again", "We already have a CRM though.", 6_000);
    const laterResult = await run(state, [who, saidIdentity, purposeQuestion, saidPurpose, crm, afterHours, crmAgain], new Error("offline"), repSettings);
    expect(laterResult).toMatchObject({ move_id: "existing-workflow-coverage", source: "fallback" });
    expect(laterResult.selected_move!.response).not.toMatch(/Who is this|which CRM|replace/i);
  });

  it("renders O3's canonical script even when the model writes a different valid purpose response", async () => {
    const turn = prospect("purpose-verbatim", "What's this regarding?");
    const result = await run(newLotLiftCallState("purpose-verbatim"), [turn], output("O3", "I am calling about paid inquiries after hours. How does that work at your store?", ["purpose-verbatim"]));
    expect(result).toMatchObject({ source: "hard-rule", move_id: "O3", selected_move: { response: "“I’m calling about who handles your online leads there. Is that you?”" } });
  });

  it("keeps CRM context and after-hours evidence instead of restarting discovery", async () => {
    const crm = prospect("crm", "We use VinSolutions.", 0);
    const afterHours = prospect("after-hours", "Usually, but things after hours can sit until the morning.", 2_000);
    const current = prospect("current", "We already have a CRM though.", 4_000);
    const state = stateWith([scalar("current_solution", "VinSolutions", "crm"), scalar("after_hours_process", "things after hours can sit until the morning", "after-hours")]);
    const result = await run(state, [crm, rep("r", "Does everything get assigned there?", 1_000), afterHours, current], output("existing-workflow-coverage", "That makes sense. When things sit until morning, what happens to those inquiries?", ["current", "after-hours"]));
    expect(result).toMatchObject({ source: "model", move_id: "existing-workflow-coverage" });
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
    const priorPriceQuestion = rep("prior-price", "Is the concern the monthly spend itself or setup effort?", -1_000);
    expect(lotLiftMoveCandidates({ state: pain, turn: price, conversation: [price] }).map((move) => move.id)).toContain("price-pain-value");
    expect(lotLiftMoveCandidates({ state: stakeholder, turn: price, conversation: [price] }).map((move) => move.id)).toContain("price-stakeholder-criteria");
    expect(plain[0]!.id).toBe("price-isolation");
    expect(lotLiftMoveCandidates({ state: repeated, turn: price, conversation: [priorPriceQuestion, price] })[0]!.id).toBe("price-next-criterion");
    expect(lotLiftMoveCandidates({ state: repeated, turn: price, conversation: [price] })[0]!.id).toBe("price-isolation");
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

  it("rejects explicit durable facts when their original evidence is not cited", async () => {
    const crm = prospect("crm", "We use VinSolutions for online leads.", 0);
    const price = prospect("price", "This is too expensive.", 1_000);
    const state = stateWith([scalar("current_solution", "VinSolutions", "crm")]);
    const result = await run(state, [crm, price], output("price-isolation", "I hear you. Since VinSolutions is in place, is the concern the spend or the value?", ["price"]));
    expect(result).toMatchObject({ source: "fallback", fallback_reason: "invalid-output", move_id: "price-isolation" });
  });

  it("keeps DNC deterministic and validates bad local output to the visible fallback", async () => {
    const dnc = prospect("dnc", "Take us off your list.");
    const dncResult = await run(newLotLiftCallState("dnc"), [dnc], output("identify-owner", "Who owns this?", ["dnc"]));
    expect(dncResult).toMatchObject({ source: "hard-rule", event_type: "do_not_contact" });
    const price = prospect("price", "This is too expensive.");
    const badResult = await run(newLotLiftCallState("bad"), [price], output("invented", "LotLift will save you money.", ["price"]));
    expect(badResult).toMatchObject({ source: "fallback", fallback_reason: "invalid-output", move_id: "price-isolation" });
  });

  it("preserves extracted CRM and after-hours memory for a later realtime decision", async () => {
    const crm = prospect("crm", "We use VinSolutions.", 0);
    const afterHours = prospect("after-hours", "Some inquiries after hours sit until morning.", 1_000);
    const current = prospect("current", "We already have a CRM though.", 2_000);
    const initial = newLotLiftCallState("memory");
    const context = buildLotLiftResponseCompositionContext({ state: initial, turn: afterHours, conversation: [crm, afterHours], candidates: lotLiftMoveCandidates({ state: initial, turn: afterHours, conversation: [crm, afterHours] }), responsePolicy: "composable" });
    const events = validateLotLiftObservationExtraction({ observations: [{ field: "current_solution", value: "VinSolutions", evidence_segment_id: "crm" }, { field: "after_hours_process", value: afterHours.text, evidence_segment_id: "after-hours" }] }, context);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "capture", field: "current_solution" }), expect.objectContaining({ type: "capture", field: "after_hours_process" })]));
    const persisted = (events ?? []).reduce(reduceLotLiftCallState, initial);
    const result = await run(persisted, [crm, afterHours, current], output("existing-workflow-coverage", "That makes sense. When inquiries sit until morning, what happens to them?", ["current", "after-hours"]));
    expect(result).toMatchObject({ source: "model", move_id: "existing-workflow-coverage" });
  });

  it("keeps the immediate fallback when OpenAI is selected without its configured key", async () => {
    const turn = prospect("missing-openai-key", "Who is this?");
    const result = await analyzeLotLiftTurn({
      state: newLotLiftCallState("missing-openai-key"),
      turn,
      conversation: [turn],
      settings: {
        llmProviders: { realtime: "openai" },
        models: { openai: { realtime: "gpt-5.6-terra" } },
        openaiApiKey: "",
      } as Settings,
    });
    expect(result).toMatchObject({ source: "fallback", fallback_reason: "unconfigured", move_id: "identify-owner" });
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

  it("rejects an extracted observation whose cited prospect evidence does not contain its value", () => {
    const state = newLotLiftCallState("observation");
    const turn = prospect("observation", "We use VinSolutions.");
    const context = buildLotLiftResponseCompositionContext({ state, turn, conversation: [turn], candidates: lotLiftMoveCandidates({ state, turn, conversation: [turn] }), responsePolicy: "composable" });
    expect(validateLotLiftObservationExtraction({ observations: [{ field: "current_solution", value: "DealerSocket", evidence_segment_id: "observation" }] }, context)).toBeNull();
  });

  it("does not let an extracted observation replace conflicting verified state", () => {
    const state = stateWith([scalar("current_solution", "VinSolutions", "verified-crm")]);
    const turn = prospect("new-crm", "We use DealerSocket CRM now.");
    const context = buildLotLiftResponseCompositionContext({ state, turn, conversation: [turn], candidates: lotLiftMoveCandidates({ state, turn, conversation: [turn] }), responsePolicy: "composable" });
    expect(validateLotLiftObservationExtraction({ observations: [{ field: "current_solution", value: "DealerSocket", evidence_segment_id: "new-crm" }] }, context)).toBeNull();
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
