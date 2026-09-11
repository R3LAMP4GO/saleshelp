import { execFileSync } from "node:child_process";
import { cpus, hostname, platform, release, totalmem } from "node:os";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { newLotLiftCallState, reduceLotLiftCallState } from "../src/lib/lotlift/callState";
import { lotLiftMoveCandidates } from "../src/lib/lotlift/nextMove";
import { buildLotLiftResponseCompositionContext, lotLiftResponseCompositionSchema, validateLotLiftResponseComposition, type LotLiftComposerRejectionCode, type LotLiftResponseCompositionContext, type LotLiftSpokenResponseRejectionSubreason } from "../src/lib/lotlift/responseComposer";
import { LOTLIFT_LOCAL_MODEL_DEADLINE_DEFAULT_MS } from "../src/lib/lotlift/localDeadline";
import { OLLAMA_REALTIME_KEEP_ALIVE } from "../src/lib/ai/ollamaResidency";
import { analyzeLotLiftTurn, type LotLiftTurnModel, type LotLiftTurnModelOutput } from "../src/lib/lotlift/turnIntelligence";
import type { TranscriptSegment } from "../src/lib/types";

const endpoint = process.env.OLLAMA_HOST?.replace(/\/$/, "") ?? "http://127.0.0.1:11434";
const runs = Number.parseInt(process.env.LOTLIFT_BENCH_RUNS ?? "6", 10);
const requestedModels = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath = process.env.LOTLIFT_BENCH_OUTPUT ?? `tmp/lotlift-local-benchmark/${timestamp}.json`;
const IDEAL_WARM_P95_TARGET_MS = 2_000;
const MIN_VALID_ELIGIBLE_MOVE_RATE = 1;
const MIN_CORRECT_STRATEGY_RATE = 0.9;
const MIN_CONTEXT_REQUIRED_RATE = 0.9;
const MAX_REPEATED_QUESTION_RATE = 0.05;
const MAX_UNSUPPORTED_CLAIM_RATE = 0;
const CONTEXT_REQUIRED_FIXTURES = new Set(["spouse-price", "long-call-durable-context", "repeated-price-question"]);

const segment = (id: string, text: string): TranscriptSegment => ({ id, text, source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100 });
const rep = (id: string, text: string): TranscriptSegment => ({ id, text, source: "me", speaker: 1, isFinal: true, startMs: 0, endMs: 100 });
const price = segment("price", "This is too much money for us.");
const spouse = segment("spouse", "My wife needs to weigh in before we decide.");
const spousePrice = segment("spouse-price", "This is too much money for us.");
const value = segment("value", "It is whether the value is clear.");
const priceValueState = reduceLotLiftCallState(newLotLiftCallState("price-value"), {
  type: "decision-context",
  blockers: [{ value: "price/value uncertainty", status: "verified", evidence: { segment_id: price.id, text: price.text } }],
  stakeholders: [],
  selected_objection_route: { value: "price-value", status: "verified", evidence: { segment_id: price.id, text: price.text } },
});
const spousePriceState = reduceLotLiftCallState(newLotLiftCallState("spouse-price"), {
  type: "append",
  field: "decision_stakeholders",
  fact: { value: "wife", status: "verified", evidence: { segment_id: spouse.id, text: spouse.text } },
});

const refusal = segment("first-refusal", "No thanks, we are not interested.");
const marketplace = segment("marketplace", "Do you support every marketplace?");
const later = segment("later", "Please call me later.");
const repeatedPrice = segment("repeated-price", "This is still too expensive.");
const earlyAfterHours = segment("early-after-hours", "Leads sit overnight after hours.");
const longCallPrice = segment("long-price", "The price still sounds high.");
const longCallState = reduceLotLiftCallState(newLotLiftCallState("long-call"), { type: "append", field: "pain_points", fact: { value: "Leads sit overnight after hours", status: "verified", evidence: { segment_id: earlyAfterHours.id, text: earlyAfterHours.text } } });

const fixtures = [
  { id: "do-not-contact", state: newLotLiftCallState("do-not-contact"), turn: segment("do-not-contact", "Do not call this number again."), conversation: [segment("do-not-contact", "Do not call this number again.")], expectedMove: null, expectedStrategy: null },
  { id: "owner", state: newLotLiftCallState("owner"), turn: segment("owner", "Okay."), conversation: [segment("owner", "Okay.")], expectedMove: "identify-owner", expectedStrategy: "permission-and-route" },
  { id: "first-refusal", state: newLotLiftCallState("first-refusal"), turn: refusal, conversation: [refusal], expectedMove: "first-refusal", expectedStrategy: "Ask one brief coverage question, then respect a second no." },
  { id: "timing", state: newLotLiftCallState("timing"), turn: later, conversation: [later], expectedMove: "timing-follow-up", expectedStrategy: "Ask when consented follow-up would be useful and what should be covered." },
  { id: "marketplace-limitation", state: newLotLiftCallState("marketplace"), turn: marketplace, conversation: [marketplace], expectedMove: "security-authorization", expectedStrategy: "State that support is source-specific and ask which sources matter." },
  { id: "price", state: newLotLiftCallState("price"), turn: price, conversation: [price], expectedMove: "price-isolation", expectedStrategy: "Clarify the concern before discussing price." },
  { id: "repeated-price-question", state: newLotLiftCallState("repeated-price"), turn: repeatedPrice, conversation: [rep("prior-price-question", "Is the concern the monthly spend itself, setup effort, another option, or value?"), repeatedPrice], expectedMove: "price-next-criterion", expectedStrategy: "Clarify the concern before discussing price." },
  { id: "value", state: priceValueState, turn: value, conversation: [price, value], expectedMove: "price-value-uncertainty", expectedStrategy: "Clarify the decision criterion without promising value." },
  { id: "spouse-price", state: spousePriceState, turn: spousePrice, conversation: [spouse, spousePrice], expectedMove: "price-stakeholder-criteria", expectedStrategy: "Learn stakeholder criteria without pressure." },
  { id: "long-call-durable-context", state: longCallState, turn: longCallPrice, conversation: [earlyAfterHours, ...Array.from({ length: 18 }, (_, index) => segment(`long-filler-${index}`, `Unrelated call detail ${index}.`)), longCallPrice], expectedMove: "price-pain-value", expectedStrategy: "Clarify the concern before discussing price." },
] as const;

type OllamaResponse = { message?: { content?: string }; eval_count?: number; model?: string };
type ResponseMetrics = { promptBytes: number; model_completed: boolean; valid_json: boolean; valid_schema: boolean; grounding_evidence_count: number; guard_accepted: boolean; validation_rejection_code: LotLiftComposerRejectionCode | null; validation_rejection_subreason: LotLiftSpokenResponseRejectionSubreason | null; latest?: OllamaResponse };
type Sample = { fixture: string; elapsed_ms: number; prompt_bytes: number; output_tokens: number | null; model_completed: boolean; valid_json: boolean; valid_schema: boolean; grounding_evidence_count: number; guard_accepted: boolean; validation_rejection_code: LotLiftComposerRejectionCode | null; validation_rejection_subreason: LotLiftSpokenResponseRejectionSubreason | null; source: "model" | "fallback" | "hard-rule" | "error"; move_id: string | null; selected_strategy: string | null; expected_move_id: string | null; expected_strategy: string | null; correct: boolean; fallback_reason?: string; error_code?: string };

function command(command: string, args: string[]): string | null {
  try { return execFileSync(command, args, { encoding: "utf8" }).trim(); } catch { return null; }
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]!;
}

function countValues(values: readonly (string | null)[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    if (value) counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

async function installedModels(): Promise<string[]> {
  const response = await fetch(`${endpoint}/api/tags`);
  if (!response.ok) throw new Error(`Ollama tags request failed (${response.status})`);
  const body = await response.json() as { models?: Array<{ name?: string }> };
  return body.models?.flatMap((model) => model.name ? [model.name] : []) ?? [];
}

function compositionContext(fixture: typeof fixtures[number]): LotLiftResponseCompositionContext {
  const candidates = lotLiftMoveCandidates({ state: fixture.state, turn: fixture.turn, conversation: fixture.conversation });
  return buildLotLiftResponseCompositionContext({
    state: fixture.state,
    turn: fixture.turn,
    conversation: fixture.conversation,
    candidates,
    responsePolicy: candidates[0]?.source === "terminal-policy" ? "hard_stop" : "composable",
  });
}

function localModel(model: string, context: LotLiftResponseCompositionContext, metrics: ResponseMetrics): LotLiftTurnModel {
  return async (request) => {
    metrics.promptBytes = new TextEncoder().encode(`${request.system}\n${request.prompt}`).byteLength;
    const response = await fetch(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: request.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: OLLAMA_REALTIME_KEEP_ALIVE,
        think: false,
        format: z.toJSONSchema(lotLiftResponseCompositionSchema(context)),
        options: { temperature: 0, num_predict: 120 },
        messages: [{ role: "system", content: request.system }, { role: "user", content: request.prompt }],
      }),
    });
    if (!response.ok) throw new Error(`Ollama chat request failed (${response.status})`);
    const body = await response.json() as OllamaResponse;
    metrics.latest = body;
    const content = body.message?.content;
    if (!content) throw new Error("Ollama returned no JSON content");
    metrics.model_completed = true;
    let output: unknown;
    try {
      output = JSON.parse(content) as unknown;
      metrics.valid_json = true;
    } catch {
      throw new Error("Ollama returned invalid JSON");
    }
    const parsed = lotLiftResponseCompositionSchema(context).safeParse(output);
    metrics.valid_schema = parsed.success;
    metrics.grounding_evidence_count = parsed.success ? parsed.data.grounding_segment_ids.length : 0;
    const validation = validateLotLiftResponseComposition(output, context);
    metrics.guard_accepted = Boolean(validation.result);
    if (metrics.valid_schema) {
      metrics.validation_rejection_code = validation.rejection_code;
      metrics.validation_rejection_subreason = validation.rejection_subreason;
    }
    return output as LotLiftTurnModelOutput;
  };
}

async function sample(model: string, fixture: typeof fixtures[number]): Promise<Sample> {
  const metrics: ResponseMetrics = { promptBytes: 0, model_completed: false, valid_json: false, valid_schema: false, grounding_evidence_count: 0, guard_accepted: false, validation_rejection_code: null, validation_rejection_subreason: null };
  const context = compositionContext(fixture);
  const started = performance.now();
  try {
    const result = await analyzeLotLiftTurn({ state: fixture.state, turn: fixture.turn, conversation: fixture.conversation, model: localModel(model, context, metrics), timeoutMs: LOTLIFT_LOCAL_MODEL_DEADLINE_DEFAULT_MS });
    const elapsed_ms = performance.now() - started;
    const correct = result.source === "hard-rule" ? result.move_id === fixture.expectedMove : metrics.guard_accepted && result.move_id === fixture.expectedMove;
    return { fixture: fixture.id, elapsed_ms, prompt_bytes: metrics.promptBytes, output_tokens: metrics.latest?.eval_count ?? null, model_completed: metrics.model_completed, valid_json: metrics.valid_json, valid_schema: metrics.valid_schema, grounding_evidence_count: metrics.grounding_evidence_count, guard_accepted: metrics.guard_accepted, validation_rejection_code: metrics.validation_rejection_code, validation_rejection_subreason: metrics.validation_rejection_subreason, source: result.source, move_id: result.move_id, selected_strategy: result.selected_move?.approved_strategy ?? null, expected_move_id: fixture.expectedMove, expected_strategy: fixture.expectedStrategy, correct, ...(result.fallback_reason ? { fallback_reason: result.fallback_reason } : {}) };
  } catch (error) {
    return { fixture: fixture.id, elapsed_ms: performance.now() - started, prompt_bytes: metrics.promptBytes, output_tokens: metrics.latest?.eval_count ?? null, model_completed: metrics.model_completed, valid_json: metrics.valid_json, valid_schema: metrics.valid_schema, grounding_evidence_count: metrics.grounding_evidence_count, guard_accepted: metrics.guard_accepted, validation_rejection_code: metrics.validation_rejection_code, validation_rejection_subreason: metrics.validation_rejection_subreason, source: "error", move_id: null, selected_strategy: null, expected_move_id: fixture.expectedMove, expected_strategy: fixture.expectedStrategy, correct: false, error_code: error instanceof Error ? error.name : "unknown" };
  }
}

const ollamaVersion = command("ollama", ["--version"]);
const available = ollamaVersion ? await installedModels().catch(() => []) : [];
const configured = ["qwen3.5:4b"];
const additionalCandidates = available.filter((model) => /(?:qwen|llama|gemma|phi)/i.test(model) && !configured.includes(model));
const models = (requestedModels.length ? requestedModels : [...configured, ...additionalCandidates]).filter((model, index, values) => values.indexOf(model) === index && available.includes(model));

const report = {
  recorded_at: new Date().toISOString(),
  endpoint,
  hardware: { hostname: hostname(), platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, memory_bytes: totalmem() },
  ollama_version: ollamaVersion,
  installed_models: available,
  configured_models: configured,
  model_request_deadline_ms: LOTLIFT_LOCAL_MODEL_DEADLINE_DEFAULT_MS,
  ideal_warm_p95_target_ms: IDEAL_WARM_P95_TARGET_MS,
  models: [] as Array<Record<string, unknown>>,
};

for (const model of models) {
  const samples: Sample[] = [];
  for (let index = 0; index < Math.max(2, runs); index += 1) {
    for (const fixture of fixtures) samples.push(await sample(model, fixture));
  }
  const cold = samples.slice(0, fixtures.length);
  const warm = samples.slice(fixtures.length);
  const warmLatencies = warm.map((item) => item.elapsed_ms);
  const modelSamples = samples.filter((item) => item.fixture !== "do-not-contact");
  const dncSamples = samples.filter((item) => item.fixture === "do-not-contact");
  const validEligibleMoveRate = modelSamples.filter((item) => item.valid_schema && item.validation_rejection_code !== "selected-move").length / modelSamples.length;
  const correctStrategyRate = modelSamples.filter((item) => item.correct).length / modelSamples.length;
  const contextRequiredSamples = modelSamples.filter((item) => CONTEXT_REQUIRED_FIXTURES.has(item.fixture));
  const contextRequiredRate = contextRequiredSamples.length ? contextRequiredSamples.filter((item) => item.correct).length / contextRequiredSamples.length : 0;
  const repeatedQuestionRate = modelSamples.filter((item) => item.validation_rejection_subreason === "multiple-questions").length / modelSamples.length;
  const unsupportedClaimRate = modelSamples.filter((item) => item.validation_rejection_subreason === "prohibited-commercial-claim").length / modelSamples.length;
  const warmP95 = percentile(warmLatencies, 0.95) ?? Infinity;
  const qualityGate = {
    hard_dnc: dncSamples.length > 0 && dncSamples.every((item) => item.correct && item.source === "hard-rule"),
    valid_eligible_move: validEligibleMoveRate >= MIN_VALID_ELIGIBLE_MOVE_RATE,
    correct_strategy: correctStrategyRate >= MIN_CORRECT_STRATEGY_RATE,
    context_required: contextRequiredRate >= MIN_CONTEXT_REQUIRED_RATE,
    repeated_question: repeatedQuestionRate < MAX_REPEATED_QUESTION_RATE,
    unsupported_product_claim: unsupportedClaimRate <= MAX_UNSUPPORTED_CLAIM_RATE,
    p95_realtime: warmP95 <= IDEAL_WARM_P95_TARGET_MS,
  };
  report.models.push({
    model,
    quality_gate: qualityGate,
    cold: { p50_ms: percentile(cold.map((item) => item.elapsed_ms), 0.5), p95_ms: percentile(cold.map((item) => item.elapsed_ms), 0.95), samples: cold },
    warm: { p50_ms: percentile(warmLatencies, 0.5), p95_ms: percentile(warmLatencies, 0.95), samples: warm },
    model_completion_rate: samples.filter((item) => item.model_completed).length / samples.length,
    valid_json_rate: samples.filter((item) => item.valid_json).length / samples.length,
    valid_schema_rate: samples.filter((item) => item.valid_schema).length / samples.length,
    guard_acceptance_rate: samples.filter((item) => item.guard_accepted).length / samples.length,
    candidate_validity_rate: validEligibleMoveRate,
    validation_rejection_code_counts: countValues(samples.filter((item) => item.model_completed && item.valid_schema && !item.guard_accepted).map((item) => item.validation_rejection_code)),
    validation_rejection_subreason_counts: countValues(samples.filter((item) => item.model_completed && item.valid_schema && !item.guard_accepted).map((item) => item.validation_rejection_subreason)),
    selected_move_correctness: correctStrategyRate,
    contextual_strategy_correctness: contextRequiredRate,
    evidence_grounding_rate: samples.filter((item) => item.guard_accepted && item.grounding_evidence_count > 0).length / samples.length,
    repeated_question_rate: repeatedQuestionRate,
    unsupported_claim_rate: unsupportedClaimRate,
    fallback_rate: samples.filter((item) => item.source === "fallback").length / samples.length,
    meets_ideal_warm_p95_target: (percentile(warmLatencies, 0.95) ?? Infinity) <= IDEAL_WARM_P95_TARGET_MS,
  });
}

await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, ollama_available: Boolean(ollamaVersion), model_request_deadline_ms: LOTLIFT_LOCAL_MODEL_DEADLINE_DEFAULT_MS, ideal_warm_p95_target_ms: IDEAL_WARM_P95_TARGET_MS, models: report.models.map((model) => ({ model: model.model, warm_p50_ms: (model.warm as { p50_ms: number | null }).p50_ms, warm_p95_ms: (model.warm as { p95_ms: number | null }).p95_ms, meets_ideal_2s_target: model.meets_ideal_warm_p95_target, model_completion_rate: model.model_completion_rate, valid_json_rate: model.valid_json_rate, valid_schema_rate: model.valid_schema_rate, candidate_validity_rate: model.candidate_validity_rate, guard_acceptance_rate: model.guard_acceptance_rate, validation_rejection_code_counts: model.validation_rejection_code_counts, validation_rejection_subreason_counts: model.validation_rejection_subreason_counts, correctness: model.selected_move_correctness, contextual_strategy_correctness: model.contextual_strategy_correctness, evidence_grounding_rate: model.evidence_grounding_rate, repeated_question_rate: model.repeated_question_rate, unsupported_claim_rate: model.unsupported_claim_rate, fallback_rate: model.fallback_rate })) }, null, 2));
if (!models.length) process.exitCode = 2;
if (report.models.some((model) => Object.values(model.quality_gate as Record<string, boolean | string>).some((value) => value === false))) process.exitCode = 1;
