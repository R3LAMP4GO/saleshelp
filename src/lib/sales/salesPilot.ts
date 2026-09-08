export const SALES_PILOT_SOURCE_LIMIT = 200_000;
export const SALES_PILOT_MAX_FACTS = 50;

export const PRODUCT_FACT_CATEGORIES = ["capability", "pricing", "integration", "security", "roi", "guarantee"] as const;
export type ProductFactCategory = typeof PRODUCT_FACT_CATEGORIES[number];

export interface SalesPilotProductFact {
  id: string;
  statement: string;
  category: ProductFactCategory;
}

export interface SalesPilotStage {
  id: string;
  title: string;
  guidance: string;
}

export interface SalesPilotRule {
  id: string;
  guidance: string;
}

export interface SalesPilotProfile {
  version: 1;
  title: string;
  objective: string;
  stages: readonly SalesPilotStage[];
  objectionRules: readonly SalesPilotRule[];
  productFacts: readonly SalesPilotProductFact[];
}

const kebabId = /^[a-z][a-z0-9-]{1,63}$/;
const plainSentence = /^[^\n<>]{3,500}$/;

type MarkdownBlock = { id: string; body: string };

function section(source: string, title: string, allowEmpty = false): string {
  const match = source.match(new RegExp(`^## ${title}(?:\\s*\\n([\\s\\S]*?))?(?=^## |(?![\\s\\S]))`, "m"));
  if (!match || (!allowEmpty && !match[1]?.trim())) throw new Error(`Missing required ## ${title} section.`);
  return match[1]?.trim() ?? "";
}

function blocks(source: string, prefix: string, label: string): MarkdownBlock[] {
  const result = [...source.matchAll(new RegExp(`^### ${prefix}:([a-z][a-z0-9-]{1,63})\\s*\\n([\\s\\S]*?)(?=^### |(?![\\s\\S]))`, "gm"))]
    .map((match) => ({ id: match[1]!, body: match[2]!.trim() }));
  if (!result.length) throw new Error(`${label} must include at least one ### ${prefix}:<id> entry.`);
  if (new Set(result.map((item) => item.id)).size !== result.length) throw new Error(`${label} IDs must be unique.`);
  if (result.some((item) => !item.body)) throw new Error(`${label} entries must not be empty.`);
  return result;
}

function title(source: string): string {
  const value = source.match(/^# (.+)$/m)?.[1]?.trim();
  if (!value || value.length > 160) throw new Error("A single # profile title is required.");
  return value;
}

function objective(source: string): string {
  const value = section(source, "Call objective").replace(/\s+/g, " ").trim();
  if (!plainSentence.test(value)) throw new Error("Call objective must be plain text between 3 and 500 characters.");
  return value;
}

function productFacts(source: string): SalesPilotProductFact[] {
  const body = section(source, "Product facts", true);
  if (!body) return [];
  const facts = [...body.matchAll(/^### product:([a-z][a-z0-9-]{1,63})\s*\n\*\*Statement:\*\*\s*([^\n]+)\n\*\*Category:\*\*\s*([^\n]+)\s*$/gm)]
    .map((match) => ({ id: match[1]!, statement: match[2]!.trim(), category: match[3]!.trim() }));
  if (!facts.length && body) throw new Error("Product facts must use the required product ID, Statement, and Category syntax.");
  if (facts.length > SALES_PILOT_MAX_FACTS) throw new Error(`Product facts are limited to ${SALES_PILOT_MAX_FACTS}.`);
  if (new Set(facts.map((fact) => fact.id)).size !== facts.length) throw new Error("Product fact IDs must be unique.");
  return facts.map((fact) => {
    if (!kebabId.test(fact.id) || !plainSentence.test(fact.statement)) throw new Error("Each product fact needs a plain-text statement between 3 and 500 characters.");
    if (!PRODUCT_FACT_CATEGORIES.includes(fact.category as ProductFactCategory)) throw new Error("Product fact Category must be capability, pricing, integration, security, roi, or guarantee.");
    return { ...fact, category: fact.category as ProductFactCategory };
  });
}

/** Compiles only allowlisted Markdown sections; all other uploaded text remains inert source. */
export function compileSalesPilotProfile(markdown: string): SalesPilotProfile {
  const source = markdown.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
  if (!source || source.length > SALES_PILOT_SOURCE_LIMIT) throw new Error(`Playbook must be between 1 and ${SALES_PILOT_SOURCE_LIMIT} characters.`);
  const stageBlocks = blocks(section(source, "Script stages"), "stage", "Script stages");
  const ruleBlocks = blocks(section(source, "Objection rules"), "rule", "Objection rules");
  return Object.freeze({
    version: 1,
    title: title(source),
    objective: objective(source),
    stages: Object.freeze(stageBlocks.map((stage) => Object.freeze({ id: stage.id, title: stage.id.replace(/-/g, " "), guidance: stage.body }))),
    objectionRules: Object.freeze(ruleBlocks.map((rule) => Object.freeze({ id: rule.id, guidance: rule.body }))),
    productFacts: Object.freeze(productFacts(source).map((fact) => Object.freeze(fact))),
  });
}
