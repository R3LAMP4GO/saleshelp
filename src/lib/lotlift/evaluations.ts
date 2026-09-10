import type { EvalDef, EvalTemplate } from "../types";
import { lotLiftGuidance } from "./playbook";
import type { LotLiftCallState, LotLiftConversationStage, LotLiftFieldValue } from "./callState";
import { lotLiftPolicyContext, missingLotLiftTacticContext, type LotLiftClaimClass, type LotLiftPolicyTacticId } from "./policyPack";
import type { TranscriptSegment } from "../types";

const policy = lotLiftGuidance("North star", "Ideal customer and fit", "Discovery sequence", "Qualification rules", "Close rules", "What not to say");

export const LOTLIFT_EVALUATION_IDS = [
  "lotlift-objection-detected",
  "lotlift-discovery-incomplete",
  "lotlift-pain-not-quantified",
  "lotlift-existing-solution",
  "lotlift-buying-signal",
  "lotlift-best-next-response",
  "lotlift-close-opportunity",
] as const;

export type LotLiftBestNextResponseCandidate = {
  response: string;
  tactic_id: LotLiftPolicyTacticId;
  allowed_claim_classes: readonly LotLiftClaimClass[];
  proposed_stage: LotLiftConversationStage;
  grounding_segment_id: string | null;
};

export type LotLiftBestNextResponseAssessment = {
  hard_failures: readonly string[];
  scores: Readonly<Record<"priority_and_safety" | "grounding" | "tactic_fit" | "stage_discipline" | "actionability" | "truthful_scope", number>>;
  total: number;
  is_best_next_response: boolean;
};

const stageRank: Record<LotLiftConversationStage, number> = {
  "owner-identification": 0, "relevance-discovery": 1, "gap-confirmation": 2, qualification: 3, "meeting-invitation": 4, disqualified: 5, terminal: 5,
};

const evaluationVerified = (fact: LotLiftFieldValue<string>) => fact.status === "verified" && Boolean(fact.value && fact.evidence);
const evaluationHasVerified = (facts: readonly LotLiftFieldValue<string>[]) => facts.some(evaluationVerified);

function evaluationStage(state: LotLiftCallState): LotLiftConversationStage {
  if (state.do_not_contact || state.substantive_refusal_count >= 2) return "terminal";
  if (evaluationVerified(state.disqualification_reason) || (evaluationVerified(state.fit_status) && /disqualif|unsupported|not a fit/i.test(state.fit_status.value ?? ""))) return "disqualified";
  if (!evaluationVerified(state.role) && !evaluationVerified(state.workflow_owner) && !evaluationHasVerified(state.stakeholders)) return "owner-identification";
  if (!evaluationHasVerified(state.lead_sources) && !evaluationVerified(state.lead_arrival_point) && !evaluationVerified(state.current_solution)) return "relevance-discovery";
  if (!evaluationHasVerified(state.pain_points) && !evaluationHasVerified(state.quantified_pain)) return "gap-confirmation";
  return evaluationVerified(state.authority) ? "meeting-invitation" : "qualification";
}

/** Scores a candidate against deterministic policy; it never determines product truth. */
export function evaluateLotLiftBestNextResponse(input: { state: LotLiftCallState; turn: TranscriptSegment; conversation: readonly TranscriptSegment[]; candidate: LotLiftBestNextResponseCandidate }): LotLiftBestNextResponseAssessment {
  const { state, turn, candidate } = input;
  const stage = evaluationStage(state);
  const hardFailures: string[] = [];
  const grounded = candidate.grounding_segment_id !== null && input.conversation.some((segment) => segment.id === candidate.grounding_segment_id && segment.source === "them" && segment.isFinal);
  const terminal = state.do_not_contact || stage === "terminal" || stage === "disqualified";
  const forbiddenClaims = /\b(?:guarantee|roi|return on investment|integrat(?:e|ion)|every marketplace|we can access|save you|recover(?:ed|ing)? leads?)\b/i.test(candidate.response)
    && candidate.tactic_id !== "truthful-limitation";
  const questionCount = candidate.response.match(/\?/g)?.length ?? 0;
  const missingContext = missingLotLiftTacticContext(candidate.tactic_id, lotLiftPolicyContext(state, turn));
  if (terminal && candidate.tactic_id !== "respectful-exit" && candidate.tactic_id !== "truthful-limitation") hardFailures.push("terminal-or-opt-out violation");
  if (!grounded) hardFailures.push("missing final prospect grounding");
  if (forbiddenClaims || candidate.allowed_claim_classes.some((claim) => !["prospect-evidence", "approved-product-fact", "approved-policy-fact", "truthful-limitation", "question"].includes(claim))) hardFailures.push("disallowed claim");
  if (questionCount > 1) hardFailures.push("more than one new question");
  if (stageRank[candidate.proposed_stage] > stageRank[stage] + 1 || missingContext.length > 0) hardFailures.push("unmet stage context");
  const hasQuestionOrScopedStep = questionCount === 1 || /\b(?:workflow check|follow up|follow-up|leave it there)\b/i.test(candidate.response);
  const scores = {
    priority_and_safety: terminal ? (candidate.tactic_id === "respectful-exit" || candidate.tactic_id === "truthful-limitation" ? 2 : 0) : 2,
    grounding: grounded ? 2 : 0,
    tactic_fit: missingContext.length ? 0 : 2,
    stage_discipline: stageRank[candidate.proposed_stage] <= stageRank[stage] + 1 ? 2 : 0,
    actionability: hasQuestionOrScopedStep && questionCount <= 1 ? 2 : 0,
    truthful_scope: forbiddenClaims ? 0 : 2,
  } as const;
  const total = Object.values(scores).reduce<number>((sum, score) => sum + score, 0);
  return { hard_failures: hardFailures, scores, total, is_best_next_response: hardFailures.length === 0 && total >= 10 };
}

export function buildLotLiftEvaluations(): EvalDef[] {
  return [
    {
      id: "lotlift-objection-detected",
      name: "Objection detected",
      description: "Classify the concern before responding.",
      prompt: `Monitor THEM for a genuine LotLift sales objection, concern, brush-off, gatekeeper block, or opt-out. Quote the exact words, classify it, and state the single clarification question or graceful exit required by this playbook. Never treat a clear no or opt-out as a debate.\n\n${policy}`,
    },
    {
      id: "lotlift-discovery-incomplete",
      name: "Discovery incomplete",
      description: "Show the next useful workflow question.",
      prompt: `Track the required LotLift discovery facts: meaningful lead source, arrival point, ownership, after-hours coverage, visibility, current solution, authority, urgency, and fit constraints. Flag only the most useful missing fact for the current conversation and give one approved discovery question. Do not recommend a demo or meeting before relevance exists.\n\n${policy}`,
    },
    {
      id: "lotlift-pain-not-quantified",
      name: "Pain not quantified",
      description: "Capture impact using the dealer’s evidence.",
      prompt: `Flag only when THEM has described a real workflow risk but its business impact remains unquantified. Quote their evidence and ask one approved question about lead volume, lost time, appointment impact, or value. Never invent loss, ROI, or a guarantee.\n\n${policy}`,
    },
    {
      id: "lotlift-existing-solution",
      name: "Existing-solution objection",
      description: "Test the CRM, BDC, or current workflow respectfully.",
      prompt: `Detect THEM citing a CRM, BDC, internet department, salespeople, competitor, or existing workflow. Ask whether immediate ownership, after-hours coverage, and visibility are actually handled. If their process genuinely covers the issue, recommend clean disqualification; do not argue that their solution is bad.\n\n${policy}`,
    },
    {
      id: "lotlift-buying-signal",
      name: "Buying signal",
      description: "Spot a confirmed gap, curiosity, or readiness to involve others.",
      prompt: `Flag a buying signal only with quoted evidence: a confirmed gap, meaningful curiosity, request for a scoped review, willingness to involve an owner, a real timing event, or agreement on a success measure. State the most appropriate next step; do not treat polite listening as interest.\n\n${policy}`,
    },
    {
      id: "lotlift-best-next-response",
      name: "Best next response",
      description: "Reject unsafe or premature next responses.",
      prompt: `Evaluate one proposed response only. Hard-fail an opt-out or terminal violation, absent final-prospect grounding, unsupported claim, unmet stage context, or more than one new question. Otherwise score priority and safety, grounding, tactic fit, stage discipline, actionability, and truthful scope from 0–2. Require at least 10/12. Break ties by safety, fewer assumptions, an approved card, then brevity.\n\n${policy}`,
    },
    {
      id: "lotlift-close-opportunity",
      name: "Close opportunity",
      description: "Offer the next appropriate 15-minute workflow check or scoped evaluation.",
      prompt: `Flag a close opportunity only when the call has confirmed a relevant gap or curiosity and the next step fits the prospect’s authority and constraints. Recommend the approved two-window workflow-check ask, or a scoped evaluation only when source, owner, scope, success measure, review cadence, and decision date can be defined.\n\n${policy}`,
    },
  ];
}

export function buildLotLiftEvaluationTemplate(): EvalTemplate {
  return { id: "tpl-lotlift-sales", name: "LotLift Sales", builtin: true, evals: buildLotLiftEvaluations() };
}
