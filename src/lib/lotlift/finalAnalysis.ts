import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { generateObjectResilient } from "../ai/generate";
import type { Settings, TranscriptSegment } from "../types";
import {
  type LotLiftCallState,
  type LotLiftEvidence,
  type LotLiftFieldValue,
  type LotLiftListField,
  type LotLiftRecurringObjection,
  type LotLiftScalarField,
  loadLotLiftCallState,
  unknownLotLiftField,
} from "./callState";
import { LOTLIFT_REQUIRED_RULE_IDS, lotLiftPlaybookRule } from "./playbook";

export const LOTLIFT_FINAL_ANALYSIS_SCHEMA_VERSION = 1;

const scalarFields = [
  "dealership", "contact_name", "role", "phone", "email", "current_solution", "lead_arrival_point",
  "workflow_owner", "after_hours_process", "response_speed", "appointment_capability", "follow_up_process", "visibility_process", "authority", "urgency", "renewal_date",
  "close_opportunity", "fit_status", "disqualification_reason", "next_action", "next_action_at",
] as const satisfies readonly LotLiftScalarField[];
const listFields = [
  "lead_sources", "pain_points", "quantified_pain", "stakeholders", "prior_answers", "buying_signals", "commitments", "open_questions",
] as const satisfies readonly LotLiftListField[];
const reportFields = ["summary", "call_outcome", "recommended_follow_up", "crm_note"] as const;

export type LotLiftFinalAnalysisStatus = "complete" | "insufficient_evidence" | "dnc";
export type LotLiftFinalAnalysisReportField = typeof reportFields[number];

export interface LotLiftAnalysisContradiction {
  field: LotLiftScalarField;
  call_state: LotLiftFieldValue<string>;
  final_analysis: LotLiftFieldValue<string>;
}

export type LotLiftFinalCallAnalysis = Pick<LotLiftCallState, typeof scalarFields[number] | typeof listFields[number] | "recurring_objections" | "do_not_contact" | "dnc_at" | "dnc_evidence"> & {
  analysis_schema_version: number;
  call_id: string;
  revision: number;
  created_at: string;
  source_call_state_revision: number;
  summary: LotLiftFieldValue<string>;
  call_outcome: LotLiftFieldValue<string>;
  recommended_follow_up: LotLiftFieldValue<string>;
  crm_note: LotLiftFieldValue<string>;
  contradictions: LotLiftAnalysisContradiction[];
  analysis_status: LotLiftFinalAnalysisStatus;
  validation_failures: string[];
};

const evidenceSchema = z.object({ segment_id: z.string().min(1).max(80), text: z.string().min(1).max(300) }).strict();
const modelFactSchema = z.object({
  value: z.string().trim().min(1).max(300),
  status: z.enum(["verified", "inferred"]),
  evidence: evidenceSchema,
}).strict();
const recurringObjectionSchema = modelFactSchema.extend({ count: z.number().int().min(1).max(100), resolved: z.boolean() }).strict();

/** Strict, bounded model contract; omitted fields mean unknown/no patch. */
export const lotLiftFinalAnalysisModelSchema = z.object({
  summary: modelFactSchema.optional(),
  call_outcome: modelFactSchema.optional(),
  recommended_follow_up: modelFactSchema.optional(),
  crm_note: modelFactSchema.optional(),
  dealership: modelFactSchema.optional(), contact_name: modelFactSchema.optional(), role: modelFactSchema.optional(),
  phone: modelFactSchema.optional(), email: modelFactSchema.optional(), current_solution: modelFactSchema.optional(),
  lead_arrival_point: modelFactSchema.optional(), workflow_owner: modelFactSchema.optional(), after_hours_process: modelFactSchema.optional(),
  response_speed: modelFactSchema.optional(), appointment_capability: modelFactSchema.optional(), follow_up_process: modelFactSchema.optional(),
  visibility_process: modelFactSchema.optional(), authority: modelFactSchema.optional(), urgency: modelFactSchema.optional(),
  renewal_date: modelFactSchema.optional(), close_opportunity: modelFactSchema.optional(), fit_status: modelFactSchema.optional(),
  disqualification_reason: modelFactSchema.optional(), next_action: modelFactSchema.optional(), next_action_at: modelFactSchema.optional(),
  lead_sources: z.array(modelFactSchema).max(12).optional(), pain_points: z.array(modelFactSchema).max(12).optional(),
  quantified_pain: z.array(modelFactSchema).max(12).optional(), stakeholders: z.array(modelFactSchema).max(12).optional(),
  prior_answers: z.array(modelFactSchema).max(12).optional(), buying_signals: z.array(modelFactSchema).max(12).optional(),
  commitments: z.array(modelFactSchema).max(12).optional(), open_questions: z.array(modelFactSchema).max(12).optional(),
  recurring_objections: z.array(recurringObjectionSchema).max(12).optional(),
  do_not_contact: z.boolean().optional(), dnc_at: z.string().max(80).nullable().optional(), dnc_evidence: evidenceSchema.nullable().optional(),
}).strict();

export type LotLiftFinalAnalysisModelOutput = z.infer<typeof lotLiftFinalAnalysisModelSchema>;
export type LotLiftFinalAnalysisModel = (request: { system: string; prompt: string; signal?: AbortSignal }) => Promise<LotLiftFinalAnalysisModelOutput>;

/** Local-only IPC boundary; callers must await this before any future sync. */
export async function persistLotLiftFinalAnalysis(analysis: LotLiftFinalCallAnalysis): Promise<LotLiftFinalCallAnalysis> {
  const next = { ...analysis, revision: analysis.revision + 1 };
  await invoke("save_lotlift_final_analysis", { analysis: next });
  return next;
}

export function loadLotLiftFinalAnalysis(callId: string): Promise<LotLiftFinalCallAnalysis | null> {
  return invoke("load_lotlift_final_analysis", { callId });
}

/** Explicit post-call path; never invoke from live turn coaching. */
export async function finalizeLotLiftCall(callId: string, transcript: readonly TranscriptSegment[], settings?: Settings, model?: LotLiftFinalAnalysisModel): Promise<LotLiftFinalCallAnalysis> {
  const [state, previous] = await Promise.all([loadLotLiftCallState(callId), loadLotLiftFinalAnalysis(callId)]);
  if (!state) throw new Error("Saved Call State is unavailable");
  const analysis = await analyzeLotLiftFinalCall({ state, transcript, settings, model });
  return persistLotLiftFinalAnalysis({ ...analysis, revision: previous?.revision ?? 0 });
}

function sameValue(left: string | null, right: string | null): boolean {
  return left?.trim().toLocaleLowerCase() === right?.trim().toLocaleLowerCase();
}

function evidenceIsPresent(evidence: LotLiftEvidence, transcript: readonly TranscriptSegment[]): boolean {
  return transcript.some((segment) => segment.isFinal && segment.id === evidence.segment_id && segment.text.includes(evidence.text));
}

function recordFailure(failures: string[], message: string): void {
  if (failures.length < 100) failures.push(message);
}

function validModelFact(fact: LotLiftFinalAnalysisModelOutput[keyof LotLiftFinalAnalysisModelOutput], transcript: readonly TranscriptSegment[], field: string, failures: string[]): LotLiftFieldValue<string> | null {
  if (!fact) return null;
  if (Array.isArray(fact) || typeof fact !== "object" || !("value" in fact) || !("evidence" in fact)) {
    recordFailure(failures, `${field}: malformed model fact`);
    return null;
  }
  const value = fact.value;
  const evidence = fact.evidence;
  if (!evidenceIsPresent(evidence, transcript) || !evidence.text.toLocaleLowerCase().includes(value.toLocaleLowerCase())) {
    recordFailure(failures, `${field}: evidence must quote the final transcript and contain the value`);
    return null;
  }
  return fact;
}

function mergeFact(existing: LotLiftFieldValue<string>, candidate: LotLiftFieldValue<string> | null, field: LotLiftScalarField, contradictions: LotLiftAnalysisContradiction[]): LotLiftFieldValue<string> {
  if (!candidate) return existing;
  if (existing.status === "verified") {
    if (candidate.status === "verified" && !sameValue(existing.value, candidate.value)) contradictions.push({ field, call_state: existing, final_analysis: candidate });
    return existing;
  }
  return candidate;
}

function mergeList(existing: LotLiftFieldValue<string>[], incoming: LotLiftFieldValue<string>[]): LotLiftFieldValue<string>[] {
  return incoming.reduce((merged, candidate) => {
    const index = merged.findIndex((item) => sameValue(item.value, candidate.value));
    if (index < 0) return [...merged, candidate];
    if (merged[index].status === "verified" && candidate.status !== "verified") return merged;
    return merged.map((item, itemIndex) => itemIndex === index ? candidate : item);
  }, existing);
}

function baseAnalysis(state: LotLiftCallState, createdAt: string): LotLiftFinalCallAnalysis {
  return {
    analysis_schema_version: LOTLIFT_FINAL_ANALYSIS_SCHEMA_VERSION,
    call_id: state.call_id,
    revision: 0,
    created_at: createdAt,
    source_call_state_revision: state.revision,
    summary: unknownLotLiftField(), call_outcome: unknownLotLiftField(), recommended_follow_up: unknownLotLiftField(), crm_note: unknownLotLiftField(),
    dealership: state.dealership, contact_name: state.contact_name, role: state.role, phone: state.phone, email: state.email,
    lead_sources: state.lead_sources, current_solution: state.current_solution, lead_arrival_point: state.lead_arrival_point,
    workflow_owner: state.workflow_owner, after_hours_process: state.after_hours_process, response_speed: state.response_speed,
    appointment_capability: state.appointment_capability, follow_up_process: state.follow_up_process, visibility_process: state.visibility_process,
    pain_points: state.pain_points, quantified_pain: state.quantified_pain, authority: state.authority, stakeholders: state.stakeholders,
    urgency: state.urgency, renewal_date: state.renewal_date, recurring_objections: state.recurring_objections, prior_answers: state.prior_answers,
    buying_signals: state.buying_signals, commitments: state.commitments, open_questions: state.open_questions,
    close_opportunity: state.close_opportunity, fit_status: state.fit_status, disqualification_reason: state.disqualification_reason,
    do_not_contact: state.do_not_contact, dnc_at: state.dnc_at, dnc_evidence: state.dnc_evidence,
    next_action: state.next_action, next_action_at: state.next_action_at,
    contradictions: [], analysis_status: state.do_not_contact ? "dnc" : "insufficient_evidence", validation_failures: [],
  };
}

/** Reconciles untrusted model output without mutating Call State. */
export function reconcileLotLiftFinalAnalysis(state: LotLiftCallState, transcript: readonly TranscriptSegment[], output: LotLiftFinalAnalysisModelOutput | null, createdAt = new Date().toISOString()): LotLiftFinalCallAnalysis {
  const analysis = baseAnalysis(state, createdAt);
  if (!output || state.do_not_contact) return analysis;
  const failures = analysis.validation_failures;
  let admittedFacts = 0;
  if (output.do_not_contact !== undefined || output.dnc_at !== undefined || output.dnc_evidence !== undefined) recordFailure(failures, "model attempted to alter DNC suppression");

  for (const field of reportFields) {
    const candidate = validModelFact(output[field], transcript, field, failures);
    if (candidate) admittedFacts += 1;
    analysis[field] = candidate ?? analysis[field];
  }
  for (const field of scalarFields) {
    const candidate = validModelFact(output[field], transcript, field, failures);
    if (candidate) admittedFacts += 1;
    analysis[field] = mergeFact(state[field], candidate, field, analysis.contradictions);
  }
  for (const field of listFields) {
    const candidates = (output[field] ?? []).flatMap((item, index) => {
      const fact = validModelFact(item, transcript, `${field}[${index}]`, failures);
      if (fact) admittedFacts += 1;
      return fact ? [fact] : [];
    });
    analysis[field] = mergeList(state[field], candidates);
  }
  const objections: LotLiftRecurringObjection[] = (output.recurring_objections ?? []).flatMap((item, index) => {
    const fact = validModelFact(item, transcript, `recurring_objections[${index}]`, failures);
    if (fact) admittedFacts += 1;
    return fact ? [{ ...fact, count: item.count, resolved: item.resolved }] : [];
  });
  analysis.recurring_objections = mergeList(state.recurring_objections, objections) as LotLiftRecurringObjection[];
  if (admittedFacts) analysis.analysis_status = "complete";
  return analysis;
}

function finalTranscript(transcript: readonly TranscriptSegment[]): Array<{ id: string; source: string; text: string }> {
  return transcript.filter((segment) => segment.isFinal && segment.text.trim()).map((segment) => ({ id: segment.id, source: segment.source, text: segment.text.trim().slice(0, 2_000) }));
}

function promptFor(state: LotLiftCallState, transcript: readonly TranscriptSegment[]): string {
  const rules = LOTLIFT_REQUIRED_RULE_IDS.map((id) => {
    const rule = lotLiftPlaybookRule(id);
    return { id, intent: rule.intent, objective: rule.objective, approved_strategy: rule.approved_strategy, exit_condition: rule.exit_condition };
  });
  return `FINAL_TRANSCRIPT=${JSON.stringify(finalTranscript(transcript))}\nCALL_STATE=${JSON.stringify(state)}\nPLAYBOOK_RULES=${JSON.stringify(rules)}\nReturn only the schema. Omit unknown fields. Every value must appear verbatim inside its evidence.text, and evidence.text must be an exact substring of one FINAL_TRANSCRIPT segment. Never output do_not_contact, dnc_at, or dnc_evidence. Do not alter Call State facts; report conflicting verified facts with their own evidence.`;
}

const SYSTEM = "LotLift final call analyst. Use only the supplied final transcript and policy rules. Model output is untrusted and will be rejected unless grounded in exact transcript evidence. Never fabricate a CRM note, summary, qualification, integration, callback date, or follow-up.";

async function defaultModel(settings: Settings, request: { system: string; prompt: string; signal?: AbortSignal }): Promise<LotLiftFinalAnalysisModelOutput> {
  const { object } = await generateObjectResilient({ settings, workload: "deep", schema: lotLiftFinalAnalysisModelSchema, system: request.system, prompt: request.prompt, abortSignal: request.signal, maxOutputTokens: 1_600 });
  return object;
}

/** Runs deep final analysis; provider failures yield a persistable, evidence-empty result. */
export async function analyzeLotLiftFinalCall(opts: { state: LotLiftCallState; transcript: readonly TranscriptSegment[]; settings?: Settings; model?: LotLiftFinalAnalysisModel; signal?: AbortSignal; createdAt?: string }): Promise<LotLiftFinalCallAnalysis> {
  const { state, transcript, settings, model, signal, createdAt } = opts;
  if (state.do_not_contact) return reconcileLotLiftFinalAnalysis(state, transcript, null, createdAt);
  if (!finalTranscript(transcript).length) return reconcileLotLiftFinalAnalysis(state, transcript, null, createdAt);
  try {
    const run = model ?? (settings ? defaultModel.bind(null, settings) : undefined);
    if (!run) throw new Error("no deep model configured");
    return reconcileLotLiftFinalAnalysis(state, transcript, await run({ system: SYSTEM, prompt: promptFor(state, transcript), signal }), createdAt);
  } catch {
    return reconcileLotLiftFinalAnalysis(state, transcript, null, createdAt);
  }
}
