import type { TranscriptSegment } from "../types";
import type { LotLiftCallState, LotLiftConversationStage, LotLiftFieldValue } from "./callState";
import { LOTLIFT_REQUIRED_RULE_IDS, type LotLiftPlaybookRuleId } from "./playbook";

export const LOTLIFT_POLICY_TACTIC_IDS = [
  "permission-and-route",
  "workflow-discovery",
  "impact-clarification",
  "solution-verification",
  "decision-criteria",
  "concern-isolation",
  "consented-follow-up",
  "scoped-next-step",
  "truthful-limitation",
  "respectful-exit",
] as const;
export type LotLiftPolicyTacticId = typeof LOTLIFT_POLICY_TACTIC_IDS[number];

export const LOTLIFT_CLAIM_CLASSES = [
  "prospect-evidence",
  "approved-product-fact",
  "approved-policy-fact",
  "truthful-limitation",
  "question",
] as const;
export type LotLiftClaimClass = typeof LOTLIFT_CLAIM_CLASSES[number];

export const LOTLIFT_POLICY_CONTEXT_KEYS = [
  "workflow-owner",
  "supported-source",
  "workflow-evidence",
  "gap",
  "authority-path",
  "prospect-consent",
  "terminal-evidence",
  "disqualification-evidence",
] as const;
export type LotLiftPolicyContextKey = typeof LOTLIFT_POLICY_CONTEXT_KEYS[number];

export type LotLiftPolicyTactic = {
  id: LotLiftPolicyTacticId;
  permitted_stages: readonly LotLiftConversationStage[];
  required_context: readonly LotLiftPolicyContextKey[];
  optional_context: readonly LotLiftPolicyContextKey[];
  forbidden_when: readonly ("terminal" | "disqualified" | "do-not-contact" | "second-refusal")[];
  allowed_claim_classes: readonly LotLiftClaimClass[];
  fallback_tactic: LotLiftPolicyTacticId | null;
};

const discoveryClaims = ["prospect-evidence", "approved-policy-fact", "question"] as const;
const exitClaims = ["prospect-evidence", "approved-policy-fact"] as const;

export const LOTLIFT_POLICY_TACTICS: Record<LotLiftPolicyTacticId, LotLiftPolicyTactic> = {
  "permission-and-route": {
    id: "permission-and-route", permitted_stages: ["owner-identification", "relevance-discovery"], required_context: [], optional_context: ["workflow-owner"], forbidden_when: ["terminal", "disqualified", "do-not-contact", "second-refusal"], allowed_claim_classes: discoveryClaims, fallback_tactic: "respectful-exit",
  },
  "workflow-discovery": {
    id: "workflow-discovery", permitted_stages: ["relevance-discovery", "gap-confirmation"], required_context: ["workflow-owner"], optional_context: ["supported-source", "workflow-evidence"], forbidden_when: ["terminal", "disqualified", "do-not-contact", "second-refusal"], allowed_claim_classes: discoveryClaims, fallback_tactic: "permission-and-route",
  },
  "impact-clarification": {
    id: "impact-clarification", permitted_stages: ["gap-confirmation", "qualification"], required_context: ["workflow-evidence"], optional_context: ["gap", "authority-path"], forbidden_when: ["terminal", "disqualified", "do-not-contact", "second-refusal"], allowed_claim_classes: discoveryClaims, fallback_tactic: "workflow-discovery",
  },
  "solution-verification": {
    id: "solution-verification", permitted_stages: ["gap-confirmation", "qualification"], required_context: ["workflow-evidence"], optional_context: ["gap"], forbidden_when: ["terminal", "disqualified", "do-not-contact", "second-refusal"], allowed_claim_classes: discoveryClaims, fallback_tactic: "workflow-discovery",
  },
  "decision-criteria": {
    id: "decision-criteria", permitted_stages: ["qualification", "meeting-invitation"], required_context: ["workflow-evidence"], optional_context: ["authority-path", "prospect-consent"], forbidden_when: ["terminal", "disqualified", "do-not-contact", "second-refusal"], allowed_claim_classes: discoveryClaims, fallback_tactic: "workflow-discovery",
  },
  "concern-isolation": {
    id: "concern-isolation", permitted_stages: ["owner-identification", "relevance-discovery", "gap-confirmation", "qualification", "meeting-invitation"], required_context: [], optional_context: ["workflow-evidence", "authority-path"], forbidden_when: ["terminal", "disqualified", "do-not-contact", "second-refusal"], allowed_claim_classes: ["prospect-evidence", "approved-policy-fact", "question"], fallback_tactic: "workflow-discovery",
  },
  "consented-follow-up": {
    id: "consented-follow-up", permitted_stages: ["owner-identification", "relevance-discovery", "gap-confirmation", "qualification"], required_context: ["prospect-consent"], optional_context: ["workflow-owner", "authority-path"], forbidden_when: ["terminal", "disqualified", "do-not-contact", "second-refusal"], allowed_claim_classes: discoveryClaims, fallback_tactic: "permission-and-route",
  },
  "scoped-next-step": {
    id: "scoped-next-step", permitted_stages: ["meeting-invitation"], required_context: ["supported-source", "workflow-owner", "gap", "authority-path", "prospect-consent"], optional_context: ["workflow-evidence"], forbidden_when: ["terminal", "disqualified", "do-not-contact", "second-refusal"], allowed_claim_classes: ["prospect-evidence", "approved-product-fact", "approved-policy-fact", "question"], fallback_tactic: "workflow-discovery",
  },
  "truthful-limitation": {
    id: "truthful-limitation", permitted_stages: ["owner-identification", "relevance-discovery", "gap-confirmation", "qualification", "meeting-invitation", "disqualified"], required_context: ["disqualification-evidence"], optional_context: [], forbidden_when: ["terminal", "do-not-contact", "second-refusal"], allowed_claim_classes: ["prospect-evidence", "truthful-limitation", "approved-policy-fact"], fallback_tactic: "respectful-exit",
  },
  "respectful-exit": {
    id: "respectful-exit", permitted_stages: ["terminal", "disqualified"], required_context: [], optional_context: ["terminal-evidence", "disqualification-evidence"], forbidden_when: [], allowed_claim_classes: exitClaims, fallback_tactic: null,
  },
};

export const LOTLIFT_TACTIC_RULES: Record<LotLiftPolicyTacticId, readonly LotLiftPlaybookRuleId[]> = {
  "permission-and-route": ["discovery:ownership", "objection:not-interested"],
  "workflow-discovery": ["discovery:lead-source", "discovery:after-hours", "discovery:visibility", "objection:source-volume", "objection:team-size"],
  "impact-clarification": ["qualification:pain", "objection:status-quo"],
  "solution-verification": ["objection:existing-crm", "objection:existing-workflow", "objection:competitor", "objection:comparison"],
  "decision-criteria": ["objection:need-to-think", "objection:spouse-partner", "objection:comparison", "objection:trial", "objection:build-it", "objection:staff-adoption", "objection:new-company"],
  "concern-isolation": ["objection:no-budget", "objection:roi"],
  "consented-follow-up": ["objection:busy", "objection:call-later", "objection:send-information", "objection:contract", "objection:previous-caller"],
  "scoped-next-step": ["close:workflow-check"],
  "truthful-limitation": ["objection:direct-integration", "objection:marketplace-coverage", "objection:ai-automation", "objection:data-security", "objection:provider-authorization"],
  "respectful-exit": ["objection:do-not-contact"],
};

export const LOTLIFT_APPROVED_MOVE_IDS = [
  "terminal-close", "disqualified-close", "abuse-close", "hard-integration-close", "unsupported-fit-close", "second-no-close", "O2", "O3",
  "first-refusal", "price-isolation", "price-value-workflow-check", "price-value-uncertainty", "price-pain-value", "price-stakeholder-criteria", "price-next-criterion", "crm-coverage", "impact-coverage", "identify-owner", "lead-source",
  "gap-after-hours", "gap-visibility", "confirm-authority", "workflow-check", "timing-follow-up", "information-topic", "decision-criteria", "existing-workflow-coverage", "fit-source-volume", "competitor-criteria", "security-authorization", "limitation-route",
] as const;
export type LotLiftApprovedMoveId = typeof LOTLIFT_APPROVED_MOVE_IDS[number];

export const LOTLIFT_MOVE_RULES: Record<LotLiftApprovedMoveId, readonly LotLiftPlaybookRuleId[]> = {
  "terminal-close": ["objection:do-not-contact"], "disqualified-close": ["objection:direct-integration"], "abuse-close": ["objection:not-interested"], "hard-integration-close": ["objection:direct-integration"], "unsupported-fit-close": ["objection:source-volume"], "second-no-close": ["objection:not-interested"], "O2": ["discovery:ownership"], "O3": ["discovery:lead-source"],
  "first-refusal": ["objection:not-interested"], "price-isolation": ["objection:no-budget"], "price-value-workflow-check": ["objection:no-budget", "close:workflow-check"], "price-value-uncertainty": ["objection:no-budget"], "price-pain-value": ["objection:no-budget"], "price-stakeholder-criteria": ["objection:spouse-partner"], "price-next-criterion": ["objection:no-budget"], "crm-coverage": ["objection:existing-crm"], "impact-coverage": ["qualification:pain"], "identify-owner": ["discovery:ownership"], "lead-source": ["discovery:lead-source"],
  "gap-after-hours": ["discovery:after-hours"], "gap-visibility": ["discovery:visibility"], "confirm-authority": ["qualification:authority"], "workflow-check": ["close:workflow-check"], "timing-follow-up": ["objection:busy", "objection:call-later", "objection:contract"], "information-topic": ["objection:send-information"], "decision-criteria": ["objection:need-to-think", "objection:spouse-partner", "objection:trial", "objection:build-it", "objection:new-company"], "existing-workflow-coverage": ["objection:existing-workflow", "objection:status-quo"], "fit-source-volume": ["objection:source-volume", "objection:team-size"], "competitor-criteria": ["objection:competitor", "objection:comparison"], "security-authorization": ["objection:data-security", "objection:ai-automation", "objection:provider-authorization"], "limitation-route": ["objection:marketplace-coverage", "objection:roi"],
};

export const LOTLIFT_MOVE_TACTICS: Record<LotLiftApprovedMoveId, LotLiftPolicyTacticId> = {
  "terminal-close": "respectful-exit", "disqualified-close": "respectful-exit", "abuse-close": "respectful-exit", "hard-integration-close": "truthful-limitation", "unsupported-fit-close": "truthful-limitation", "second-no-close": "respectful-exit", "O2": "permission-and-route", "O3": "workflow-discovery",
  "first-refusal": "permission-and-route", "price-isolation": "concern-isolation", "price-value-workflow-check": "scoped-next-step", "price-value-uncertainty": "decision-criteria", "price-pain-value": "concern-isolation", "price-stakeholder-criteria": "decision-criteria", "price-next-criterion": "concern-isolation", "crm-coverage": "solution-verification", "impact-coverage": "impact-clarification", "identify-owner": "permission-and-route", "lead-source": "workflow-discovery",
  "gap-after-hours": "workflow-discovery", "gap-visibility": "workflow-discovery", "confirm-authority": "solution-verification", "workflow-check": "scoped-next-step", "timing-follow-up": "consented-follow-up", "information-topic": "consented-follow-up", "decision-criteria": "decision-criteria", "existing-workflow-coverage": "solution-verification", "fit-source-volume": "workflow-discovery", "competitor-criteria": "solution-verification", "security-authorization": "truthful-limitation", "limitation-route": "truthful-limitation",
};

const isVerified = (fact: LotLiftFieldValue<string>) => fact.status === "verified" && Boolean(fact.value && fact.evidence);
const hasVerified = (facts: readonly LotLiftFieldValue<string>[]) => facts.some(isVerified);

/** Context checks only final prospect evidence or durable facts that retain an evidence id. */
export function lotLiftPolicyContext(state: LotLiftCallState, turn: TranscriptSegment): ReadonlySet<LotLiftPolicyContextKey> {
  const keys = new Set<LotLiftPolicyContextKey>();
  if (isVerified(state.workflow_owner) || isVerified(state.role) || hasVerified(state.stakeholders)) keys.add("workflow-owner");
  if (hasVerified(state.lead_sources) || isVerified(state.lead_arrival_point)) keys.add("supported-source");
  if (isVerified(state.current_solution) || isVerified(state.after_hours_process) || isVerified(state.visibility_process) || hasVerified(state.lead_sources)) keys.add("workflow-evidence");
  if (hasVerified(state.pain_points) || hasVerified(state.quantified_pain)) keys.add("gap");
  if (isVerified(state.authority) || hasVerified(state.decision_stakeholders)) keys.add("authority-path");
  if (/^\s*(?:yes|sure|okay)\b|\b(?:open to|interested|curious|let'?s|would be helpful|sounds useful)\b/i.test(turn.text)) keys.add("prospect-consent");
  if (state.do_not_contact || state.substantive_refusal_count >= 2) keys.add("terminal-evidence");
  if (isVerified(state.disqualification_reason) || /\b(?:required|must have|need)\b.*\b(?:crm|dms)\b/i.test(turn.text)) keys.add("disqualification-evidence");
  return keys;
}

export function missingLotLiftTacticContext(tacticId: LotLiftPolicyTacticId, context: ReadonlySet<LotLiftPolicyContextKey>): LotLiftPolicyContextKey[] {
  return LOTLIFT_POLICY_TACTICS[tacticId].required_context.filter((key) => !context.has(key));
}

export function lotLiftTacticForMove(moveId: string): LotLiftPolicyTacticId {
  const tactic = LOTLIFT_MOVE_TACTICS[moveId as LotLiftApprovedMoveId];
  if (!tactic) throw new Error(`LotLift policy references unknown move ${moveId}.`);
  return tactic;
}

/** Fail fast when a declarative policy points outside the approved moves, rules, stages, or claims. */
export function validateLotLiftPolicyPack(input: {
  tactics?: Record<LotLiftPolicyTacticId, LotLiftPolicyTactic>;
  tacticRules?: Record<LotLiftPolicyTacticId, readonly string[]>;
  moveTactics?: Record<string, LotLiftPolicyTacticId>;
  moveRules?: Record<string, readonly string[]>;
} = {}): void {
  const tactics = input.tactics ?? LOTLIFT_POLICY_TACTICS;
  const tacticRules = input.tacticRules ?? LOTLIFT_TACTIC_RULES;
  const moveTactics = input.moveTactics ?? LOTLIFT_MOVE_TACTICS;
  const moveRules: Record<string, readonly string[]> = input.moveRules ?? LOTLIFT_MOVE_RULES;
  const stages: readonly LotLiftConversationStage[] = ["owner-identification", "relevance-discovery", "gap-confirmation", "qualification", "meeting-invitation", "terminal", "disqualified"];
  for (const tactic of Object.values(tactics)) {
    if (tactic.id !== LOTLIFT_POLICY_TACTIC_IDS.find((id) => id === tactic.id)) throw new Error(`LotLift policy has unknown tactic ${tactic.id}.`);
    if (!tactic.permitted_stages.every((stage) => stages.includes(stage))) throw new Error(`LotLift policy has impossible stage for ${tactic.id}.`);
    if (!tactic.required_context.every((key) => LOTLIFT_POLICY_CONTEXT_KEYS.includes(key)) || !tactic.optional_context.every((key) => LOTLIFT_POLICY_CONTEXT_KEYS.includes(key))) throw new Error(`LotLift policy has unknown context for ${tactic.id}.`);
    if (!tactic.allowed_claim_classes.every((claim) => LOTLIFT_CLAIM_CLASSES.includes(claim))) throw new Error(`LotLift policy has unapproved claim class for ${tactic.id}.`);
    if (tactic.fallback_tactic && !LOTLIFT_POLICY_TACTIC_IDS.includes(tactic.fallback_tactic)) throw new Error(`LotLift policy has undefined fallback for ${tactic.id}.`);
    if (!tacticRules[tactic.id]?.every((ruleId) => LOTLIFT_REQUIRED_RULE_IDS.includes(ruleId as LotLiftPlaybookRuleId))) throw new Error(`LotLift policy references unknown rule for ${tactic.id}.`);
  }
  for (const [moveId, tacticId] of Object.entries(moveTactics)) {
    if (!LOTLIFT_APPROVED_MOVE_IDS.includes(moveId as LotLiftApprovedMoveId)) throw new Error(`LotLift policy references unknown move ${moveId}.`);
    if (!LOTLIFT_POLICY_TACTIC_IDS.includes(tacticId)) throw new Error(`LotLift policy references unknown tactic ${tacticId}.`);
    const rules = moveRules[moveId];
    if (!rules?.length || !rules.every((ruleId) => LOTLIFT_REQUIRED_RULE_IDS.includes(ruleId as LotLiftPlaybookRuleId))) throw new Error(`LotLift policy has no valid rule for ${moveId}.`);
  }
}

/** Keeps rule references typed and available to validation tests without duplicating customer-facing copy. */
export function isApprovedLotLiftRuleId(ruleId: string): ruleId is LotLiftPlaybookRuleId {
  return LOTLIFT_REQUIRED_RULE_IDS.includes(ruleId as LotLiftPlaybookRuleId);
}

validateLotLiftPolicyPack();
