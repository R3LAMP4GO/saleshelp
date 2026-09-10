import { describe, expect, it, vi } from "vitest";
import { newLotLiftCallState, reduceLotLiftCallState, type CallStateEvent, type LotLiftCallState } from "./callState";
import { analyzeLotLiftTurn, type LotLiftTurnModelOutput } from "./turnIntelligence";
import { selectLotLiftNextMove } from "./nextMove";
import { retrieveApprovedLotLiftResponse } from "./objections";
import type { TranscriptSegment } from "../types";

type CompositionContext = {
  final_transcript: Array<Pick<TranscriptSegment, "id" | "source" | "text">>;
  durable_facts: Array<{ field: string; value: string; status: string }>;
  allowed_product_facts: Array<{ id: string; statement: string }>;
  selected_response: { approved_response: string; objective: string } | null;
};

type ModelRequest = { system: string; prompt: string; signal: AbortSignal };

const prospect = (id: string, text: string, startMs: number): TranscriptSegment => ({
  id,
  text,
  source: "them",
  speaker: 0,
  isFinal: true,
  startMs,
  endMs: startMs + 100,
});

const representative = (id: string, text: string, startMs: number): TranscriptSegment => ({
  id,
  text,
  source: "me",
  speaker: 1,
  isFinal: true,
  startMs,
  endMs: startMs + 100,
});

function finalTurn(text: string): { turn: TranscriptSegment; conversation: TranscriptSegment[] } {
  const turn = prospect("current-prospect", text, 2_000);
  return {
    turn,
    conversation: [
      prospect("earlier-prospect", "I am listening.", 0),
      representative("earlier-representative", "Thanks for taking my call.", 1_000),
      turn,
    ],
  };
}

function verifiedState(events: readonly CallStateEvent[] = []): LotLiftCallState {
  return events.reduce((state, event) => reduceLotLiftCallState(state, event), newLotLiftCallState("matrix-call"));
}

function verifiedCapture(field: Extract<CallStateEvent, { type: "capture" }> ["field"], value: string): CallStateEvent {
  return {
    type: "capture",
    field,
    fact: { value, status: "verified", evidence: { segment_id: "earlier-prospect", text: value } },
  };
}

function fixtureState(input: {
  owner?: boolean;
  relevance?: boolean;
  pain?: boolean;
  authority?: boolean;
  priceValueBlocker?: boolean;
  previousDiscoveryDimension?: "after-hours" | "visibility";
  refusalCount?: 0 | 1 | 2;
} = {}): LotLiftCallState {
  const events: CallStateEvent[] = [];
  if (input.owner || input.relevance || input.pain || input.authority) events.push(verifiedCapture("workflow_owner", "internet manager"));
  if (input.relevance || input.pain || input.authority) events.push({ type: "append", field: "lead_sources", fact: { value: "AutoTrader", status: "verified", evidence: { segment_id: "earlier-prospect", text: "AutoTrader" } } });
  if (input.pain || input.authority) events.push({ type: "append", field: "pain_points", fact: { value: "online leads sit unworked", status: "verified", evidence: { segment_id: "earlier-prospect", text: "online leads sit unworked" } } });
  if (input.authority) events.push(verifiedCapture("authority", "decision maker"));
  if (input.priceValueBlocker) events.push(verifiedCapture("selected_objection_route", "price-value"));
  if (input.previousDiscoveryDimension) events.push({ type: "coaching-progress", move_id: `gap-${input.previousDiscoveryDimension}`, discovery_dimension: input.previousDiscoveryDimension });
  for (let index = 0; index < (input.refusalCount ?? 0); index += 1) events.push({ type: "coaching-progress", move_id: `refusal-${index + 1}`, substantive_refusal: true });
  return verifiedState(events);
}
function decodeCompositionPrompt(prompt: string): CompositionContext {
  const prefix = "COMPOSITION_CONTEXT=";
  const contextEnd = prompt.indexOf("\nReturn JSON only.");
  if (!prompt.startsWith(prefix) || contextEnd < prefix.length) throw new Error("Missing composition context");
  return JSON.parse(prompt.slice(prefix.length, contextEnd)) as CompositionContext;
}

function guardedModel(requests: ModelRequest[], responseFor = (context: CompositionContext) => context.selected_response!.approved_response) {
  return vi.fn(async (request: ModelRequest): Promise<LotLiftTurnModelOutput> => {
    requests.push(request);
    const context = decodeCompositionPrompt(request.prompt);
    const finalProspect = [...context.final_transcript].reverse().find((segment) => segment.source === "them");
    if (!context.selected_response || !finalProspect) throw new Error("Expected a composable final prospect turn");
    return {
      spoken_response: responseFor(context),
      grounding_segment_id: finalProspect.id,
    };
  });
}

describe("LotLift Local AI hard-stop matrix", () => {
  const cases: Array<{
    name: string;
    text: string;
    state: () => LotLiftCallState;
    moveId: string | null;
    eventType: string;
    expectedEvent?: Partial<CallStateEvent>;
  }> = [
    {
      name: "do-not-contact",
      text: "Do not call again.",
      state: () => verifiedState(),
      moveId: null,
      eventType: "do_not_contact",
      expectedEvent: { type: "do-not-contact" },
    },
    {
      name: "complete email capture",
      text: "Send it to john@smithmotors.com.",
      state: () => verifiedState(),
      moveId: null,
      eventType: "discovery",
      expectedEvent: { type: "capture", field: "email" },
    },
    {
      name: "ambiguous email confirmation",
      text: "Send it to john at smith dot com.",
      state: () => verifiedState(),
      moveId: null,
      eventType: "discovery",
    },
    {
      name: "terminal stage",
      text: "Hello.",
      state: () => fixtureState({ refusalCount: 2 }),
      moveId: "terminal-close",
      eventType: "response",
      expectedEvent: { type: "coaching-progress", move_id: "terminal-close" },
    },
    {
      name: "disqualified stage",
      text: "Hello.",
      state: () => verifiedState([verifiedCapture("fit_status", "not a fit")]),
      moveId: "disqualified-close",
      eventType: "response",
      expectedEvent: { type: "coaching-progress", move_id: "disqualified-close" },
    },
    {
      name: "abuse",
      text: "You are an asshole.",
      state: () => verifiedState(),
      moveId: "abuse-close",
      eventType: "response",
      expectedEvent: { type: "coaching-progress", move_id: "abuse-close", substantive_refusal: true },
    },
    {
      name: "required direct integration",
      text: "Direct CRM integration is required.",
      state: () => verifiedState(),
      moveId: "hard-integration-close",
      eventType: "response",
      expectedEvent: { type: "capture", field: "disqualification_reason" },
    },
    {
      name: "unsupported workflow",
      text: "We do not use AutoTrader or other online inquiries.",
      state: () => verifiedState(),
      moveId: "unsupported-fit-close",
      eventType: "response",
      expectedEvent: { type: "capture", field: "disqualification_reason" },
    },
    {
      name: "second refusal",
      text: "No thanks.",
      state: () => fixtureState({ refusalCount: 1 }),
      moveId: "second-no-close",
      eventType: "response",
      expectedEvent: { type: "coaching-progress", move_id: "second-no-close", substantive_refusal: true },
    },
  ];

  it.each(cases)("returns a deterministic hard rule for $name without Local AI", async ({ text, state, moveId, eventType, expectedEvent }) => {
    const requests: ModelRequest[] = [];
    const model = guardedModel(requests);
    const { turn, conversation } = finalTurn(text);
    const callState = state();
    const deterministicMove = selectLotLiftNextMove({ state: callState, turn, conversation });
    const result = await analyzeLotLiftTurn({ state: callState, turn, conversation, model });

    expect(result).toMatchObject({ source: "hard-rule", move_id: moveId, event_type: eventType });
    expect(result.fallback_reason).toBeUndefined();
    if (moveId) {
      expect(result.selected_move).toEqual(deterministicMove);
      expect(result.spoken_response).toBeUndefined();
    } else {
      expect(result.selected_move).toBeNull();
    }
    if (expectedEvent) expect(result.state_events).toEqual(expect.arrayContaining([expect.objectContaining(expectedEvent)]));
    if (!expectedEvent) expect(result.state_events).toEqual([]);
    expect(model).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });
});

function stageTurn(text: string, prefix: readonly TranscriptSegment[] = []): { turn: TranscriptSegment; conversation: TranscriptSegment[] } {
  const turn = prospect("current-prospect", text, 8_000);
  return {
    turn,
    conversation: [
      ...prefix,
      prospect("owner-evidence", "I am the internet manager.", 0),
      representative("rep-owner", "Thanks for clarifying.", 1_000),
      prospect("source-evidence", "AutoTrader sends us buyer inquiries.", 2_000),
      representative("rep-source", "I understand.", 3_000),
      prospect("pain-evidence", "Online leads sit unworked after hours.", 4_000),
      representative("rep-pain", "That is helpful context.", 5_000),
      prospect("authority-evidence", "I make that decision.", 6_000),
      representative("rep-authority", "Thanks.", 7_000),
      turn,
    ],
  };
}

function assertComposableContext(
  request: ModelRequest,
  conversation: readonly TranscriptSegment[],
  expectedDurableFacts: readonly string[],
  expectedResponse: { response: string; objective: string },
  productFacts: readonly { id: string; statement: string }[],
): void {
  const context = decodeCompositionPrompt(request.prompt);
  expect(context.final_transcript).toEqual(conversation.map(({ id, source, text }) => ({ id, source, text })));
  if (!expectedDurableFacts.length) {
    expect(context.durable_facts).toEqual([]);
  } else {
    expect(context.durable_facts).toEqual(expect.arrayContaining(
      expectedDurableFacts.map((value) => expect.objectContaining({ value, status: "verified" })),
    ));
  }
  expect(context.allowed_product_facts).toEqual(productFacts);
  expect(context.selected_response).toEqual({
    approved_response: expectedResponse.response,
    objective: expectedResponse.objective,
  });
}

describe("LotLift Local AI composable-stage matrix", () => {
  const cases: Array<{
    name: string;
    text: string;
    state: () => LotLiftCallState;
    moveId: string;
    stage: string;
    durableFacts: string[];
    productFacts?: Array<{ id: string; statement: string }> ;
    guardedResponse?: string;
  }> = [
    { name: "explicit price isolation", text: "The price feels high.", state: () => fixtureState(), moveId: "price-isolation", stage: "owner-identification", durableFacts: [], guardedResponse: "I hear you. Is the setup effort or another option the concern?" },
    { name: "price value uncertainty", text: "I am not sure it is worth it.", state: () => fixtureState({ relevance: true, priceValueBlocker: true }), moveId: "price-value-uncertainty", stage: "gap-confirmation", durableFacts: ["internet manager"] },
    { name: "price value workflow check", text: "Yes, I am not sure it is worth it.", state: () => fixtureState({ authority: true, priceValueBlocker: true }), moveId: "price-value-workflow-check", stage: "meeting-invitation", durableFacts: ["internet manager", "online leads sit unworked", "decision maker"] },
    { name: "reported lost-lead impact", text: "Online leads sit unworked after hours.", state: () => fixtureState({ owner: true }), moveId: "impact-coverage", stage: "relevance-discovery", durableFacts: ["internet manager"] },
    { name: "owner identification", text: "Who is this?", state: () => fixtureState(), moveId: "identify-owner", stage: "owner-identification", durableFacts: [], productFacts: [{ id: "coverage", statement: "LotLift supports online inquiry response workflows." }] },
    { name: "relevance discovery", text: "Tell me why you called.", state: () => fixtureState({ owner: true }), moveId: "lead-source", stage: "relevance-discovery", durableFacts: ["internet manager"] },
    { name: "after-hours gap", text: "Go on.", state: () => fixtureState({ relevance: true }), moveId: "gap-after-hours", stage: "gap-confirmation", durableFacts: ["internet manager"] },
    { name: "visibility gap", text: "Go on.", state: () => fixtureState({ relevance: true, previousDiscoveryDimension: "after-hours" }), moveId: "gap-visibility", stage: "gap-confirmation", durableFacts: ["internet manager"] },
    { name: "authority qualification", text: "Go on.", state: () => fixtureState({ pain: true }), moveId: "confirm-authority", stage: "qualification", durableFacts: ["internet manager", "online leads sit unworked"] },
    { name: "standard workflow check", text: "That sounds useful.", state: () => fixtureState({ authority: true }), moveId: "workflow-check", stage: "meeting-invitation", durableFacts: ["internet manager", "online leads sit unworked", "decision maker"] },
  ];

  it.each(cases)("composes a guarded response for $name", async ({ text, state, moveId, stage, durableFacts, productFacts = [], guardedResponse }) => {
    const requests: ModelRequest[] = [];
    const model = guardedModel(requests, (context) => guardedResponse ?? context.selected_response!.approved_response);
    const { turn, conversation } = stageTurn(text);
    const callState = state();
    const deterministicMove = selectLotLiftNextMove({ state: callState, turn, conversation });
    const result = await analyzeLotLiftTurn({ state: callState, turn, conversation, model, approvedProductFacts: productFacts });

    expect(result).toMatchObject({ move_id: moveId, selected_move: { id: moveId, stage } });
    expect(result).toMatchObject({ source: "model", move_id: moveId, selected_move: { id: moveId, stage } });
    expect(result.spoken_response).toBe(guardedResponse ?? deterministicMove.response);
    expect(result.selected_move).toEqual(deterministicMove);
    expect(result.state_events).toEqual(deterministicMove.state_events);
    expect(model).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(1);
    assertComposableContext(requests[0]!, conversation, durableFacts, { response: deterministicMove.response, objective: deterministicMove.goal }, productFacts);
  });
});

function guardedCardResponse(context: CompositionContext): string {
  const selected = context.selected_response;
  if (!selected) throw new Error("Expected a selected objection card");
  if (!/\b(?:guarantee|save|roi|return on investment|integrat(?:e|ion)|available|pricing|price|cost)\b/i.test(selected.approved_response)) return selected.approved_response;
  return selected.objective
    .replace(/\b(?:guarantee|save|roi|return on investment|integrat(?:e|ion)|available|pricing|price|cost)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

describe("LotLift Local AI approved objection-card matrix", () => {
  const spouseContext = [
    prospect("spouse-context", "My wife will weigh in too.", -2_000),
    representative("spouse-representative", "I understand.", -1_000),
  ];
  const cases: Array<{ name: string; text: string; optionId: string; deterministicMoveId: string; prior?: TranscriptSegment[] }> = [
    { name: "non-required direct integration", text: "Does it support CRM integration?", optionId: "direct-integration", deterministicMoveId: "identify-owner" },
    { name: "send information", text: "Send me information.", optionId: "send-information", deterministicMoveId: "identify-owner" },
    { name: "call later", text: "Call me back later.", optionId: "call-later", deterministicMoveId: "identify-owner" },
    { name: "need to think", text: "I need to think about it.", optionId: "need-to-think", deterministicMoveId: "identify-owner" },
    { name: "spouse partner", text: "I need to talk to my wife.", optionId: "spouse-partner", deterministicMoveId: "identify-owner" },
    { name: "busy", text: "I am busy right now.", optionId: "busy", deterministicMoveId: "identify-owner" },
    { name: "competitor", text: "We are comparing competitors.", optionId: "competitor", deterministicMoveId: "identify-owner" },
    { name: "price", text: "This costs too much.", optionId: "price", deterministicMoveId: "price-isolation" },
    { name: "first refusal", text: "No thanks, not interested.", optionId: "not-interested", deterministicMoveId: "identify-owner" },
    { name: "existing solution", text: "Our salespeople handle those inquiries.", optionId: "existing-solution", deterministicMoveId: "identify-owner" },
    { name: "spouse-plus-price", text: "This costs too much.", optionId: "price-with-spouse", deterministicMoveId: "price-isolation", prior: spouseContext },
  ];

  it.each(cases)("uses the approved $name card after local selection", async ({ text, optionId, deterministicMoveId, prior = [] }) => {
    const requests: ModelRequest[] = [];
    const model = guardedModel(requests, guardedCardResponse);
    const { turn, conversation } = stageTurn(text, prior);
    const state = fixtureState();
    const deterministicMove = selectLotLiftNextMove({ state, turn, conversation });
    const priorProspectLines = conversation.filter((segment) => segment.source === "them" && segment.id !== turn.id).map((segment) => segment.text);
    const card = retrieveApprovedLotLiftResponse(text, priorProspectLines);
    if (!card) throw new Error("Expected an approved objection card");
    const result = await analyzeLotLiftTurn({ state, turn, conversation, model });

    expect(deterministicMove).toMatchObject({ id: deterministicMoveId, stage: "owner-identification" });
    expect(result).toMatchObject({
      move_id: optionId,
      selected_move: { id: optionId, stage: deterministicMove.stage, response: card.response, goal: card.consideration },
    });
    expect(result).toMatchObject({ source: "model" });
    expect(result.spoken_response).toBe(guardedCardResponse(decodeCompositionPrompt(requests[0]!.prompt)));
    expect(result.state_events).toEqual(deterministicMove.state_events);
    expect(model).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(1);
    assertComposableContext(requests[0]!, conversation, [], { response: card.response, objective: card.consideration }, []);
  });
});

describe("LotLift Local AI invalid-output matrix", () => {
  const ownerResponse = "Who owns paid online inquiry response there: the internet manager, BDC manager, sales manager, or someone else?";
  const cases: Array<{ name: string; text?: string; output: Record<string, unknown> }> = [
    { name: "missing grounding ID", output: { spoken_response: "MODEL_ONLY_MISSING_GROUNDING_SENTINEL" } },
    { name: "unknown grounding ID", output: { spoken_response: "MODEL_ONLY_UNKNOWN_GROUNDING_SENTINEL", grounding_segment_id: "unknown-prospect" } },
    { name: "extra schema field", output: { spoken_response: "MODEL_ONLY_EXTRA_SCHEMA_SENTINEL", grounding_segment_id: "current-prospect", response_option_id: "identify-owner" } },
    { name: "prohibited claim term", output: { spoken_response: "LotLift will save you money on every lead.", grounding_segment_id: "current-prospect" } },
    { name: "unapproved vocabulary", output: { spoken_response: "Astronaut, who owns paid online inquiry response there?", grounding_segment_id: "current-prospect" } },
    { name: "objective mismatch", text: "Which online sources generate most buyer inquiries for you today?", output: { spoken_response: "Which online sources generate most buyer inquiries for you today?", grounding_segment_id: "current-prospect" } },
  ];

  it.each(cases)("falls back verbatim for $name", async ({ text = "Who is this?", output }) => {
    const modelSpokenResponse = output.spoken_response;
    if (typeof modelSpokenResponse !== "string") throw new Error("Expected model spoken response");
    const { turn, conversation } = stageTurn(text);
    const state = fixtureState();
    const deterministicMove = selectLotLiftNextMove({ state, turn, conversation });
    const result = await analyzeLotLiftTurn({
      state,
      turn,
      conversation,
      model: async () => output as LotLiftTurnModelOutput,
    });

    expect(deterministicMove).toMatchObject({ id: "identify-owner", response: ownerResponse });
    expect(result).toMatchObject({
      source: "fallback",
      fallback_reason: "invalid-output",
      selected_move: { id: "identify-owner", response: ownerResponse },
    });
    expect(result.selected_move).toEqual(deterministicMove);
    expect(result.selected_move?.response).toBe(ownerResponse);
    expect(result.state_events).toEqual([]);
    expect(result.spoken_response).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(modelSpokenResponse);
  });
});