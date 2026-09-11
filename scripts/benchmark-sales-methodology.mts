import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { LOTLIFT_KNOWLEDGE_ATTACHMENTS, LOTLIFT_METHODOLOGY_FRAMEWORKS } from "../sales-profiles/lotlift/methodology";
import { buildRelevantMethodologyContext } from "../src/lib/sales/methodologyRetrieval";
import type { KnowledgeIndex } from "../src/lib/sales/knowledge";

const root = process.argv[2] ?? join(homedir(), "Library", "Application Support", "com.pathors.parley", "sales-knowledge");
const registry = JSON.parse(readFileSync(join(root, "registry.json"), "utf8")) as Array<{ source: { id: string }; currentVersion: { sha256: string } }>;
const indexes: KnowledgeIndex[] = registry.map(({ source, currentVersion }) => {
  const index = JSON.parse(readFileSync(join(root, "sources", source.id, currentVersion.sha256, "index.json"), "utf8"));
  const frameworks = JSON.parse(readFileSync(join(root, "sources", source.id, currentVersion.sha256, "methodology.json"), "utf8"));
  return Object.freeze({ ...index, chunks: Object.freeze(index.chunks.map(Object.freeze)), frameworks: Object.freeze(frameworks) });
});

const scenarios = [
  { name: "crm-after-hours", stage: "gap-confirmation", candidateIds: ["crm-coverage", "guided-objection-discovery"], objectionClass: "crm", stateTags: ["crm", "after-hours"], currentWording: "We use VinSolutions, but late inquiries sit until morning." },
  { name: "price-after-pain", stage: "qualification", candidateIds: ["price-isolation"], objectionClass: "price", stateTags: ["pain-verified"], currentWording: "That sounds expensive after all those missed leads." },
  { name: "novel-concern", stage: "relevance-discovery", candidateIds: ["guided-objection-discovery"], objectionClass: "unknown", stateTags: [], currentWording: "I worry the staff will think this is spying." },
] as const;
const samples: number[] = [];
const retrievalSamples: number[] = [];
const selections = new Map<string, string[]>();
const run = (scenario: typeof scenarios[number]) => buildRelevantMethodologyContext({ profileGuidance: "Follow LotLift policy. Honor refusals and ask one concise workflow question.", attachments: LOTLIFT_KNOWLEDGE_ATTACHMENTS, indexes, frameworks: LOTLIFT_METHODOLOGY_FRAMEWORKS, ...scenario });
for (const scenario of scenarios) run(scenario);
for (let index = 0; index < 300; index += 1) {
  const scenario = scenarios[index % scenarios.length]!;
  const started = performance.now();
  const result = run(scenario);
  samples.push(performance.now() - started);
  retrievalSamples.push(result.retrievalMs);
  selections.set(scenario.name, result.frameworks.map((framework) => framework.id));
}
const percentile = (values: number[], fraction: number) => [...values].sort((left, right) => left - right)[Math.min(values.length - 1, Math.floor(values.length * fraction))]!;
console.log(JSON.stringify({ runs: samples.length, retrievalMs: { p50: Number(percentile(retrievalSamples, 0.5).toFixed(3)), p95: Number(percentile(retrievalSamples, 0.95).toFixed(3)) }, contextBuildMs: { p50: Number(percentile(samples, 0.5).toFixed(3)), p95: Number(percentile(samples, 0.95).toFixed(3)) }, selections: Object.fromEntries(selections) }, null, 2));
