import { z } from "zod";
import { generateObjectResilient } from "../ai/generate";
import { PROVIDER_BY_ID } from "../ai/providers";
import { OLLAMA_REALTIME_KEEP_ALIVE } from "../ai/ollamaResidency";
import type { Settings, TranscriptSegment } from "../types";
import { type CallStateEvent, type LotLiftCallState } from "./callState";
import { isDoNotContactRequest } from "./dnc";
import { resolveLotLiftTurnDeadline } from "./localDeadline";
import { log } from "../log";
import { lotLiftMoveCandidates, type LotLiftNextMove } from "./nextMove";
import {
  buildLotLiftResponseCompositionContext,
  compositionPrompt,
  LOTLIFT_RESPONSE_COMPOSER_SYSTEM,
  lotLiftResponseCompositionSchema,
  validateLotLiftResponseComposition,
  type LotLiftResponseComposerModel,
  type LotLiftResponseComposerOutput,
  type LotLiftSpokenResponseRejectionSubreason,
} from "./responseComposer";
import type { LotLiftPlaybookRuleId } from "./playbook";

/** The remote default; local Ollama uses its bounded persisted setting instead. */
export const LOTLIFT_TURN_TIMEOUT_MS = 2_000;
export type LotLiftTurnModelOutput = LotLiftResponseComposerOutput;
export type LotLiftTurnModel = LotLiftResponseComposerModel;
export type LotLiftFallbackReason = "timeout" | "cancelled" | "model-error" | "invalid-output" | "unconfigured" | "transcript-limit-exceeded";

const lotLiftComposerDiagnosticsEnabled = import.meta.env.DEV;

type LotLiftComposerDiagnostic = {
  event: "request-start" | "response-received" | "model-complete" | "validation" | "fallback" | "complete";
  elapsed_ms: number;
  deadline_ms: number;
  stage: string;
  option_id: string;
  parsed_output_valid?: boolean;
  validator_rejection_code?: string | null;
  validator_rejection_subreason?: LotLiftSpokenResponseRejectionSubreason | null;
  fallback_reason?: LotLiftFallbackReason;
  model_error_code?: "schema-parse" | "ollama-http" | "request-aborted" | "request-error";
  error_name?: string;
  error_message?: string;
  request_origin?: string | null;
  provider?: string;
  model?: string | null;
  response_char_count?: number;
  finish_reason?: string;
  content_is_complete_json?: boolean;
};

function logLotLiftComposerDiagnostic(record: LotLiftComposerDiagnostic): void {
  if (lotLiftComposerDiagnosticsEnabled) log.info("lotlift-composer", record);
}

function sanitizeModelErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown model request error";
  return message.replace(/https?:\/\/[^\s/]+(?:\/[^\s]*)?/gi, "[URL]").replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[REDACTED]").slice(0, 240);
}

export type LotLiftTurnIntelligence = {
  event_type: "response" | "do_not_contact" | "none" | "objection" | "discovery" | "qualification" | "buying_signal";
  confidence: number;
  needs_coaching: boolean;
  playbook_rule_ids: LotLiftPlaybookRuleId[];
  state_events: CallStateEvent[];
  /** Guarded model copy; absent responses render the approved move verbatim. */
  spoken_response?: string;
  selected_move: LotLiftNextMove | null;
  source: "model" | "fallback" | "hard-rule";
  move_id: string | null;
  fallback_reason?: LotLiftFallbackReason;
};

function result(move: LotLiftNextMove | null, stateEvents: CallStateEvent[], source: LotLiftTurnIntelligence["source"], ruleIds: readonly LotLiftPlaybookRuleId[], fallbackReason?: LotLiftFallbackReason): LotLiftTurnIntelligence {
  return {
    event_type: move ? "response" : "none",
    confidence: source === "fallback" ? 0 : 1,
    needs_coaching: Boolean(move),
    playbook_rule_ids: [...ruleIds],
    state_events: stateEvents,
    selected_move: move,
    move_id: move?.id ?? null,
    source,
    ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
  };
}

export function normalizeProspectEmail(value: string): string | null {
  const email = value.trim().toLowerCase().replace(/[.,;:!?]+$/, "");
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(email) && email.length <= 254 ? email : null;
}

function prospectEmailCapture(turn: TranscriptSegment): CallStateEvent | "confirm" | null {
  const token = turn.text.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/i)?.[0];
  if (token) {
    const email = normalizeProspectEmail(token);
    const evidence = token.replace(/[.,;:!?]+$/, "");
    return email ? { type: "capture", field: "email", fact: { value: email, status: "verified", evidence: { segment_id: turn.id, text: evidence } } } : "confirm";
  }
  return /\b[\w.-]+\s+at\s+[\w.-]+\s+dot\s+[a-z]{2,}\b/i.test(turn.text) ? "confirm" : null;
}

type OllamaResponseMetadata = {
  response_char_count: number;
  finish_reason: string;
  content_is_complete_json: boolean;
};

function finishReason(body: { done_reason?: unknown; done?: unknown }): string {
  const reason = typeof body.done_reason === "string" ? body.done_reason : body.done === true ? "done" : "unknown";
  return /^[a-z0-9_-]{1,64}$/i.test(reason) ? reason : "unknown";
}

function isCompleteJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

async function defaultOllamaModel(settings: Settings, request: { system: string; prompt: string; signal: AbortSignal }, context: ReturnType<typeof buildLotLiftResponseCompositionContext>, onResponse: (metadata: OllamaResponseMetadata) => void): Promise<LotLiftTurnModelOutput> {
  const endpoint = new URL(PROVIDER_BY_ID.ollama.baseURL!).origin;
  const apiKey = settings.ollamaApiKey;
  const response = await fetch(`${endpoint}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    signal: request.signal,
    body: JSON.stringify({
      model: settings.models.ollama.realtime,
      stream: false,
      keep_alive: OLLAMA_REALTIME_KEEP_ALIVE,
      think: false,
      format: z.toJSONSchema(lotLiftResponseCompositionSchema(context)),
      options: { temperature: 0, num_predict: 160 },
      messages: [{ role: "system", content: request.system }, { role: "user", content: request.prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Ollama chat request failed (${response.status})`);
  const body = await response.json() as { message?: { content?: string }; done_reason?: unknown; done?: unknown };
  const content = body.message?.content ?? "";
  onResponse({ response_char_count: content.length, finish_reason: finishReason(body), content_is_complete_json: isCompleteJson(content) });
  if (!body.message?.content) throw new Error("Ollama returned no structured composition");
  return lotLiftResponseCompositionSchema(context).parse(JSON.parse(body.message.content));
}

async function defaultModel(settings: Settings, request: { system: string; prompt: string; signal: AbortSignal }, context: ReturnType<typeof buildLotLiftResponseCompositionContext>, onOllamaResponse: (metadata: OllamaResponseMetadata) => void): Promise<LotLiftTurnModelOutput> {
  if (settings.llmProviders.realtime === "ollama") return defaultOllamaModel(settings, request, context, onOllamaResponse);
  const { object } = await generateObjectResilient({ settings, workload: "realtime", schema: lotLiftResponseCompositionSchema(context), system: request.system, prompt: request.prompt, abortSignal: request.signal, maxOutputTokens: 240, singleAttempt: true });
  return object;
}

/** Produces guarded spoken copy or falls back to the locally approved response verbatim. */
export async function analyzeLotLiftTurn(opts: { state: LotLiftCallState; turn: TranscriptSegment; conversation?: readonly TranscriptSegment[]; recent?: readonly TranscriptSegment[]; relevantRuleIds?: readonly LotLiftPlaybookRuleId[]; approvedProductFacts?: readonly import("./contextPack").LotLiftApprovedProductFact[]; settings?: Settings; model?: LotLiftTurnModel; timeoutMs?: number; signal?: AbortSignal }): Promise<LotLiftTurnIntelligence> {
  const { state, turn, settings, model, signal } = opts;
  const conversation = (opts.conversation ?? opts.recent ?? [turn]).filter((segment) => segment.isFinal);
  const candidates = lotLiftMoveCandidates({ state, turn, conversation, approvedRepIdentity: settings?.userName });
  const deterministicMove = candidates[0]!;
  const suppliedRuleIds = opts.relevantRuleIds ?? [];

  if (!turn.isFinal || turn.source !== "them" || !turn.text.trim()) return result(deterministicMove, [], "fallback", suppliedRuleIds, "invalid-output");
  if (isDoNotContactRequest(turn.text)) {
    return { event_type: "do_not_contact", confidence: 1, needs_coaching: true, playbook_rule_ids: ["objection:do-not-contact"], state_events: [{ type: "do-not-contact", at: new Date().toISOString(), evidence: { segment_id: turn.id, text: turn.text } }], selected_move: null, move_id: null, source: "hard-rule" };
  }
  const email = prospectEmailCapture(turn);
  if (email === "confirm") return { event_type: "discovery", confidence: 1, needs_coaching: true, playbook_rule_ids: [], state_events: [], selected_move: null, move_id: null, source: "hard-rule" };
  if (email) return { event_type: "discovery", confidence: 1, needs_coaching: false, playbook_rule_ids: [], state_events: [email], selected_move: null, move_id: null, source: "hard-rule" };
  if (deterministicMove.source === "terminal-policy") return result(deterministicMove, deterministicMove.state_events, "hard-rule", suppliedRuleIds);

  const eligibleCandidates = candidates;
  const fallbackMove = eligibleCandidates[0]!;
  const ruleIds = [...new Set([...suppliedRuleIds, ...eligibleCandidates.flatMap((candidate) => candidate.rule_ids)])].slice(0, 3) as LotLiftPlaybookRuleId[];
  const context = buildLotLiftResponseCompositionContext({
    state, turn, conversation, candidates: eligibleCandidates, responsePolicy: "composable", ruleIds,
    approvedProductFacts: opts.approvedProductFacts, settings,
  });
  if (!model && !settings) return result(fallbackMove, [], "fallback", ruleIds, "unconfigured");
  if (signal?.aborted) return result(fallbackMove, [], "fallback", ruleIds, "cancelled");

  const controller = new AbortController();
  const startedAt = performance.now();
  const deadlineMs = resolveLotLiftTurnDeadline(settings, opts.timeoutMs);
  const provider = settings?.llmProviders.realtime;
  const providerInfo = provider ? PROVIDER_BY_ID[provider] : undefined;
  const diagnosticBase = {
    deadline_ms: deadlineMs,
    stage: fallbackMove.stage,
    option_id: fallbackMove.id,
    provider: provider ?? (model ? "injected-model" : "unconfigured"),
    model: provider ? settings?.models[provider].realtime ?? null : null,
    request_origin: providerInfo?.baseURL ? new URL(providerInfo.baseURL).origin : null,
  };
  logLotLiftComposerDiagnostic({ event: "request-start", elapsed_ms: 0, ...diagnosticBase });
  let deadlineExpired = false;
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  const deadline = setTimeout(() => { deadlineExpired = true; controller.abort(new DOMException("LotLift response deadline exceeded", "TimeoutError")); }, deadlineMs);
  const abortResult = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
  const request = { system: LOTLIFT_RESPONSE_COMPOSER_SYSTEM, prompt: compositionPrompt(context), signal: controller.signal };
  const onOllamaResponse = (metadata: OllamaResponseMetadata) => {
    logLotLiftComposerDiagnostic({ event: "response-received", elapsed_ms: Math.round(performance.now() - startedAt), ...metadata, ...diagnosticBase });
  };
  const run = model ? model(request) : defaultModel(settings!, request, context, onOllamaResponse);
  try {
    const output = await Promise.race([run, abortResult]);
    const modelElapsed = Math.round(performance.now() - startedAt);
    logLotLiftComposerDiagnostic({ event: "model-complete", elapsed_ms: modelElapsed, ...diagnosticBase });
    const validation = validateLotLiftResponseComposition(output, context);
    logLotLiftComposerDiagnostic({ event: "validation", elapsed_ms: Math.round(performance.now() - startedAt), parsed_output_valid: Boolean(validation.result), validator_rejection_code: validation.rejection_code, validator_rejection_subreason: validation.rejection_subreason, ...diagnosticBase });
    if (!validation.result) {
      logLotLiftComposerDiagnostic({ event: "fallback", elapsed_ms: Math.round(performance.now() - startedAt), fallback_reason: "invalid-output", validator_rejection_code: validation.rejection_code, validator_rejection_subreason: validation.rejection_subreason, ...diagnosticBase });
      return result(fallbackMove, [], "fallback", ruleIds, "invalid-output");
    }
    const validated = validation.result;
    logLotLiftComposerDiagnostic({ event: "complete", elapsed_ms: Math.round(performance.now() - startedAt), parsed_output_valid: true, validator_rejection_code: null, validator_rejection_subreason: null, ...diagnosticBase });
    const selectedMove = eligibleCandidates.find((candidate) => candidate.id === validated.selected_option.id) ?? fallbackMove;
    return { ...result(selectedMove, validated.state_events, "model", ruleIds), spoken_response: validated.spoken_response ?? undefined };
  } catch (error) {
    const fallbackReason = deadlineExpired ? "timeout" : signal?.aborted ? "cancelled" : "model-error";
    const modelErrorCode = error instanceof z.ZodError
      ? "schema-parse"
      : error instanceof DOMException && error.name === "AbortError"
        ? "request-aborted"
        : error instanceof Error && error.message.startsWith("Ollama chat request failed")
          ? "ollama-http"
          : "request-error";
    logLotLiftComposerDiagnostic({
      event: "fallback",
      elapsed_ms: Math.round(performance.now() - startedAt),
      fallback_reason: fallbackReason,
      model_error_code: modelErrorCode,
      error_name: error instanceof Error ? error.name : "UnknownError",
      error_message: sanitizeModelErrorMessage(error),
      ...diagnosticBase,
    });
    return result(fallbackMove, [], "fallback", ruleIds, fallbackReason);
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
