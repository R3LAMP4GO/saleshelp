import type { EvalDef, EvalTemplate } from "../types";
import { lotLiftGuidance } from "./playbook";

const policy = lotLiftGuidance("North star", "Ideal customer and fit", "Discovery sequence", "Qualification rules", "Close rules", "What not to say");

export const LOTLIFT_EVALUATION_IDS = [
  "lotlift-objection-detected",
  "lotlift-discovery-incomplete",
  "lotlift-pain-not-quantified",
  "lotlift-existing-solution",
  "lotlift-buying-signal",
  "lotlift-close-opportunity",
] as const;

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
