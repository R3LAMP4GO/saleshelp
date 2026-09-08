import playbookMarkdown from "../../../lotlift-sales-playbook.md?raw";
import { compileSalesPilotProfile, type SalesPilotProfile } from "../sales/salesPilot";

export type LotLiftPlaybookSection =
  | "North star"
  | "Ideal customer and fit"
  | "Discovery sequence"
  | "Qualification rules"
  | "Close rules"
  | "Objection response model"
  | "What not to say";

export const LOTLIFT_REQUIRED_RULE_IDS = [
  "objection:not-interested",
  "objection:no-budget",
  "objection:existing-crm",
  "objection:spouse-partner",
  "objection:send-information",
  "objection:call-later",
  "objection:need-to-think",
  "objection:busy",
  "objection:competitor",
  "objection:direct-integration",
  "objection:do-not-contact",
  "discovery:lead-source",
  "discovery:ownership",
  "discovery:after-hours",
  "discovery:visibility",
  "qualification:pain",
  "qualification:authority",
  "qualification:urgency",
  "close:workflow-check",
] as const;

export type LotLiftPlaybookRuleId = typeof LOTLIFT_REQUIRED_RULE_IDS[number];

export interface LotLiftPlaybookRule {
  id: LotLiftPlaybookRuleId;
  intent: string;
  when_to_use: string;
  objective: string;
  approved_strategy: string;
  good_examples: string[];
  prohibited_behavior: string;
  exit_condition: string;
}

const sections = new Map<string, string>();
for (const part of playbookMarkdown.split(/^## /m).slice(1)) {
  const [heading, ...body] = part.split("\n");
  sections.set(heading.trim(), body.join("\n").trim());
}

const requiredRuleFields = [
  ["Intent", "intent"],
  ["When to use", "when_to_use"],
  ["Objective", "objective"],
  ["Approved strategy", "approved_strategy"],
  ["Prohibited behavior", "prohibited_behavior"],
  ["Exit condition", "exit_condition"],
] as const;

function requiredRuleValue(block: string, label: string, ruleId: string): string {
  const value = block.match(new RegExp(`^- \\*\\*${label}:\\*\\*\\s*(.+)$`, "m"))?.[1]?.trim();
  if (!value) throw new Error(`LotLift playbook rule ${ruleId} is missing ${label}.`);
  return value;
}

/**
 * Parses the deliberately small `### namespace:name` rule convention without a Markdown dependency.
 * Rule fields stay authored as readable Markdown bullet points and malformed policy fails at module load.
 */
export function parseLotLiftPlaybook(markdown: string): Map<string, LotLiftPlaybookRule> {
  const rules = new Map<string, LotLiftPlaybookRule>();
  const blocks = markdown.matchAll(/^### ([a-z-]+:[a-z-]+)\s*\n([\s\S]*?)(?=^### |^## |(?![\s\S]))/gm);
  for (const block of blocks) {
    const id = block[1];
    if (!LOTLIFT_REQUIRED_RULE_IDS.includes(id as LotLiftPlaybookRuleId)) continue;
    const body = block[2];
    const values = Object.fromEntries(requiredRuleFields.map(([label, key]) => [key, requiredRuleValue(body, label, id)])) as Omit<LotLiftPlaybookRule, "id" | "good_examples">;
    const examples = body.match(/^- \*\*Good examples:\*\*\s*\n((?:  - .*(?:\n|$))+)/m)?.[1]
      .split("\n")
      .map((line) => line.replace(/^  - /, "").trim())
      .filter(Boolean) ?? [];
    if (!examples.length) throw new Error(`LotLift playbook rule ${id} is missing Good examples.`);
    rules.set(id, { id: id as LotLiftPlaybookRuleId, ...values, good_examples: examples });
  }
  for (const id of LOTLIFT_REQUIRED_RULE_IDS) {
    if (!rules.has(id)) throw new Error(`LotLift playbook is missing required rule ${id}.`);
  }
  return rules;
}

export const lotLiftSalesPilotProfile: SalesPilotProfile = compileSalesPilotProfile(playbookMarkdown);

let rules: Map<string, LotLiftPlaybookRule> | null = null;

function parsedRules(): Map<string, LotLiftPlaybookRule> {
  rules ??= parseLotLiftPlaybook(playbookMarkdown);
  return rules;
}

/** Build-time LotLift policy; missing sections fail closed instead of inventing sales guidance. */
export function lotLiftPlaybookSection(section: LotLiftPlaybookSection): string {
  const content = sections.get(section);
  if (!content) throw new Error(`LotLift playbook is missing its ${section} section.`);
  return content;
}

/** Returns one structured, Markdown-authored rule or fails loudly. */
export function lotLiftPlaybookRule(ruleId: LotLiftPlaybookRuleId): LotLiftPlaybookRule {
  const rule = parsedRules().get(ruleId);
  if (!rule) throw new Error(`LotLift playbook is missing required rule ${ruleId}.`);
  return rule;
}

export function lotLiftGuidance(...wanted: LotLiftPlaybookSection[]): string {
  return wanted.map((section) => `## ${section}\n${lotLiftPlaybookSection(section)}`).join("\n\n");
}
