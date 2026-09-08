import { z } from "zod";
import { generateObjectResilient } from "../ai/generate";
import type { Settings, TranscriptSegment } from "../types";
import { type CallStateEvent, type LotLiftCallState, type LotLiftListField, type LotLiftScalarField } from "./callState";
import { DO_NOT_CONTACT_RESPONSE, isDoNotContactRequest } from "./dnc";
import { retrieveApprovedLotLiftResponse } from "./objections";
import { lotLiftPlaybookRule, type LotLiftPlaybookRuleId } from "./playbook";

export const LOTLIFT_TURN_TIMEOUT_MS = 1_500;
const MAX_RECENT_SEGMENTS = 6;
const MAX_TURN_CHARS = 500;

const scalarFields = ["dealership", "contact_name", "role", "phone", "email", "current_solution", "lead_arrival_point", "workflow_owner", "after_hours_process", "visibility_process", "authority", "urgency", "renewal_date", "close_opportunity", "fit_status", "disqualification_reason", "next_action", "next_action_at"] as const satisfies readonly LotLiftScalarField[];
const listFields = ["lead_sources", "pain_points", "quantified_pain", "stakeholders", "prior_answers", "buying_signals", "commitments", "open_questions"] as const satisfies readonly LotLiftListField[];

const modelSchema = z.object({
  event_type: z.enum(["objection", "discovery", "qualification", "buying_signal", "none"]),
  confidence: z.number().min(0).max(1),
  needs_coaching: z.boolean(),
  playbook_rule_ids: z.array(z.string()).max(3),
  state_events: z.array(z.object({
    kind: z.enum(["capture", "append", "recurring-objection"]),
    field: z.string().optional(),
    value: z.string().max(160),
    status: z.enum(["verified", "inferred"]),
    evidence: z.object({ segment_id: z.string().max(80), text: z.string().min(1).max(240) }),
  })).max(4),
  say: z.string().max(240).nullable(),
  goal: z.string().max(160).nullable(),
}).strict();

export type LotLiftTurnModelOutput = z.infer<typeof modelSchema>;
export type LotLiftTurnModel = (request: { system: string; prompt: string; signal: AbortSignal }) => Promise<LotLiftTurnModelOutput>;

export type LotLiftTurnIntelligence = {
  event_type: LotLiftTurnModelOutput["event_type"] | "do_not_contact";
  confidence: number;
  needs_coaching: boolean;
  playbook_rule_ids: LotLiftPlaybookRuleId[];
  state_events: CallStateEvent[];
  say: string | null;
  goal: string | null;
  source: "model" | "fallback" | "hard-rule";
};

const SYSTEM = "LotLift turn coach. Return only the schema. Use only supplied transcript evidence. Never invent pricing, integrations, ROI, customer facts, lead volume, authority, or urgency. If uncertain, emit no state events and no coaching. Choose at most one exact approved playbook example for say; never write alternatives or reasoning.";

function boundedText(text: string, limit = MAX_TURN_CHARS): string { return text.trim().slice(0, limit); }

function relevantRules(turn: string, recent: readonly TranscriptSegment[]): LotLiftPlaybookRuleId[] {
  const route = retrieveApprovedLotLiftResponse(turn, recent.map((segment) => segment.text));
  return route ? [route.rule_id] : ["discovery:lead-source", "discovery:ownership", "qualification:pain"];
}

function promptFor(state: LotLiftCallState, turn: TranscriptSegment, recent: readonly TranscriptSegment[], ids: LotLiftPlaybookRuleId[]): string {
  const rules = ids.map((id) => {
    const rule = lotLiftPlaybookRule(id);
    return { id, intent: rule.intent, objective: rule.objective, examples: rule.good_examples };
  });
  const window = recent.slice(-MAX_RECENT_SEGMENTS).map((segment) => ({ id: segment.id, source: segment.source, text: boundedText(segment.text) }));
  const compactState = {
    current_solution: state.current_solution, lead_sources: state.lead_sources.slice(-3), authority: state.authority,
    urgency: state.urgency, open_questions: state.open_questions.slice(-3), fit_status: state.fit_status,
  };
  return `TURN=${JSON.stringify({ id: turn.id, text: boundedText(turn.text) })}\nRECENT=${JSON.stringify(window)}\nSTATE=${JSON.stringify(compactState)}\nRULES=${JSON.stringify(rules)}\nReturn terse JSON. Evidence text must be a verbatim substring of RECENT. state_events must be empty unless supported.`;
}

function fallback(turn: TranscriptSegment, ids: LotLiftPlaybookRuleId[], recent: readonly TranscriptSegment[] = []): LotLiftTurnIntelligence {
  const route = retrieveApprovedLotLiftResponse(turn.text, recent.filter((segment) => segment.id !== turn.id && segment.source === "them").map((segment) => segment.text));
  return route
    ? { event_type: "objection", confidence: 1, needs_coaching: true, playbook_rule_ids: ids, state_events: [], say: route.response, goal: route.consideration, source: "fallback" }
    : { event_type: "none", confidence: 0, needs_coaching: false, playbook_rule_ids: ids, state_events: [], say: null, goal: null, source: "fallback" };
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

function evidenceIsPresent(evidence: { segment_id: string; text: string }, recent: readonly TranscriptSegment[]): boolean {
  const segment = recent.find((item) => item.id === evidence.segment_id && item.source === "them" && item.isFinal);
  return Boolean(segment && segment.text.includes(evidence.text));
}

function toStateEvents(output: LotLiftTurnModelOutput, recent: readonly TranscriptSegment[]): CallStateEvent[] | null {
  const events: CallStateEvent[] = [];
  for (const event of output.state_events) {
    if (!evidenceIsPresent(event.evidence, recent) || !event.evidence.text.toLowerCase().includes(event.value.toLowerCase())) return null;
    const field = event.field as LotLiftScalarField;
    if (event.kind === "capture" && ["email", "contact_name", "role", "next_action_at"].includes(field) && event.status !== "verified") return null;
    const value = field === "email" ? normalizeProspectEmail(event.value) : event.value;
    if (!value) return null;
    const fact = { value, status: event.status, evidence: event.evidence } as const;
    if (event.kind === "capture" && scalarFields.includes(field)) events.push({ type: "capture", field, fact });
    else if (event.kind === "append" && listFields.includes(event.field as LotLiftListField)) events.push({ type: "append", field: event.field as LotLiftListField, fact });
    else if (event.kind === "recurring-objection") events.push({ type: "recurring-objection", fact });
    else return null;
  }
  return events;
}

function validateOutput(output: LotLiftTurnModelOutput, recent: readonly TranscriptSegment[], allowed: LotLiftPlaybookRuleId[]): LotLiftTurnIntelligence | null {
  if (output.playbook_rule_ids.some((id) => !allowed.includes(id as LotLiftPlaybookRuleId))) return null;
  const rules = output.playbook_rule_ids as LotLiftPlaybookRuleId[];
  const events = toStateEvents(output, recent);
  if (!events) return null;
  const examples = rules.flatMap((id) => lotLiftPlaybookRule(id).good_examples);
  const goals = rules.map((id) => lotLiftPlaybookRule(id).objective);
  if ((output.say && (!examples.includes(output.say) || /\n/.test(output.say))) || (output.goal && !goals.includes(output.goal))) return null;
  if (!output.needs_coaching && (output.say || output.goal)) return null;
  return { ...output, playbook_rule_ids: rules, state_events: events, source: "model" };
}

async function defaultModel(settings: Settings, request: { system: string; prompt: string; signal: AbortSignal }): Promise<LotLiftTurnModelOutput> {
  const { object } = await generateObjectResilient({ settings, workload: "realtime", schema: modelSchema, system: request.system, prompt: request.prompt, abortSignal: request.signal, maxOutputTokens: 220, singleAttempt: true });
  return object;
}

export async function analyzeLotLiftTurn(opts: { state: LotLiftCallState; turn: TranscriptSegment; recent: readonly TranscriptSegment[]; relevantRuleIds?: LotLiftPlaybookRuleId[]; settings?: Settings; model?: LotLiftTurnModel; timeoutMs?: number }): Promise<LotLiftTurnIntelligence> {
  const { state, turn, recent, relevantRuleIds, settings, model, timeoutMs = LOTLIFT_TURN_TIMEOUT_MS } = opts;
  if (!turn.isFinal || turn.source !== "them" || !turn.text.trim()) return fallback(turn, [], recent);
  if (isDoNotContactRequest(turn.text)) return { event_type: "do_not_contact", confidence: 1, needs_coaching: true, playbook_rule_ids: ["objection:do-not-contact"], state_events: [{ type: "do-not-contact", at: new Date().toISOString(), evidence: { segment_id: turn.id, text: turn.text } }], say: DO_NOT_CONTACT_RESPONSE.response, goal: DO_NOT_CONTACT_RESPONSE.consideration, source: "hard-rule" };
  const email = prospectEmailCapture(turn);
  if (email === "confirm") return { event_type: "discovery", confidence: 1, needs_coaching: true, playbook_rule_ids: [], state_events: [], say: "Confirm email", goal: "Confirm the prospect-provided email before saving it.", source: "hard-rule" };
  if (email) return { event_type: "discovery", confidence: 1, needs_coaching: false, playbook_rule_ids: [], state_events: [email], say: null, goal: null, source: "hard-rule" };
  const ids = relevantRuleIds ?? relevantRules(turn.text, recent);
  const request = { system: SYSTEM, prompt: promptFor(state, turn, recent, ids), signal: AbortSignal.timeout(timeoutMs) };
  const run = model ? model(request) : settings ? defaultModel(settings, request) : Promise.reject(new Error("no realtime model configured"));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const output = await Promise.race([run, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("turn intelligence timeout")), timeoutMs); })]);
    return validateOutput(output, recent, ids) ?? fallback(turn, ids, recent);
  } catch { return fallback(turn, ids, recent); } finally {
    if (timeout) clearTimeout(timeout);
  }
}
