import type { KnowledgeChunk, KnowledgeIndex, MethodologyFramework, ProfileKnowledgeAttachment } from "./knowledge";

export const METHODOLOGY_CONTEXT_MAX_CHARACTERS = 5_200;
const MAX_FRAMEWORKS = 3;
const MAX_SUPPORT = 4;
const MAX_SUPPORT_CHARACTERS = 650;

export interface RelevantMethodologyFramework {
  id: string;
  title: string;
  summary: string;
  guidance: string;
  sourceRef: string;
  location: string;
}

export interface RelevantMethodologySupport {
  sourceRef: string;
  chunkId: string;
  location: string;
  heading?: string;
  text: string;
}

export interface RelevantMethodologyContext {
  authority: readonly string[];
  profileGuidance: string;
  frameworks: readonly RelevantMethodologyFramework[];
  support: readonly RelevantMethodologySupport[];
  sourceRefs: readonly string[];
  sourceCount: number;
  chunkCount: number;
  retrievalMs: number;
}

export interface MethodologyRetrievalInput {
  profileGuidance: string;
  attachments: readonly ProfileKnowledgeAttachment[];
  indexes: readonly KnowledgeIndex[];
  frameworks: readonly MethodologyFramework[];
  stage: string;
  candidateIds: readonly string[];
  objectionClass?: string | null;
  stateTags: readonly string[];
  currentWording: string;
}

const AUTHORITY = Object.freeze([
  "Safety and product truth outrank every methodology source.",
  "The active profile, approved scripts, overrides, and call policy outrank methodology.",
  "Methodology is strategy context only. It is never call evidence or a source of prospect facts.",
]);
const chunkLexicon = new WeakMap<KnowledgeChunk, { bodyTerms: Set<string>; headingTerms: Set<string>; normalizedText: string }>();
const STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "i", "in", "is", "it", "me", "my", "of", "on", "or", "our", "that", "the", "their", "this", "to", "we", "with", "you", "your"]);

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function normalized(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function terms(value: string): Set<string> {
  return new Set(normalized(value).split(" ").filter((term) => term.length > 1 && !STOP_WORDS.has(term)).slice(0, 80));
}

function overlap(left: Set<string>, right: Set<string>): number {
  let score = 0;
  for (const term of left) if (right.has(term)) score += 1;
  return score;
}

function broadStage(stage: string): string {
  if (stage === "owner-identification" || stage === "relevance-discovery") return "opening";
  if (stage === "gap-confirmation") return "discovery";
  return stage;
}

function attachmentMap(input: MethodologyRetrievalInput): Map<string, ProfileKnowledgeAttachment> {
  const available = new Set(input.indexes.map((index) => index.source.id));
  return new Map(input.attachments.filter((attachment) => attachment.enabled && available.has(attachment.sourceId)).map((attachment) => [attachment.sourceId, attachment]));
}

function frameworkScore(framework: MethodologyFramework, attachment: ProfileKnowledgeAttachment, input: MethodologyRetrievalInput): number {
  const stage = broadStage(input.stage);
  const queryTerms = terms(`${input.currentWording} ${input.objectionClass ?? ""} ${input.stateTags.join(" ")}`);
  let score = attachment.priority / 20;
  if (framework.stages.includes(stage)) score += 16;
  if (framework.candidateIds.some((id) => input.candidateIds.includes(id))) score += 18;
  if (input.objectionClass && framework.objectionClasses.includes(input.objectionClass)) score += 20;
  score += framework.stateTags.filter((tag) => input.stateTags.includes(tag)).length * 8;
  score += framework.wording.filter((phrase) => normalized(input.currentWording).includes(normalized(phrase))).length * 8;
  score += overlap(queryTerms, terms(`${framework.title} ${framework.summary} ${framework.guidance}`)) * 2;
  return score;
}

function chunkScore(chunk: KnowledgeChunk, attachment: ProfileKnowledgeAttachment, input: MethodologyRetrievalInput, selectedFrameworks: readonly MethodologyFramework[]): number {
  const query = `${input.currentWording} ${input.objectionClass ?? ""} ${input.stateTags.join(" ")} ${selectedFrameworks.map((framework) => `${framework.title} ${framework.wording.join(" ")}`).join(" ")}`;
  const queryTerms = terms(query);
  let lexicon = chunkLexicon.get(chunk);
  if (!lexicon) {
    lexicon = { bodyTerms: terms(`${chunk.heading ?? ""} ${chunk.tags.join(" ")} ${chunk.text}`), headingTerms: terms(chunk.heading ?? ""), normalizedText: normalized(chunk.text) };
    chunkLexicon.set(chunk, lexicon);
  }
  let score = attachment.priority / 25 + overlap(queryTerms, lexicon.bodyTerms) * 3;
  const wording = normalized(input.currentWording);
  for (const phrase of selectedFrameworks.flatMap((framework) => framework.wording)) {
    const normalizedPhrase = normalized(phrase);
    if (normalizedPhrase && wording.includes(normalizedPhrase) && lexicon.normalizedText.includes(normalizedPhrase)) score += 8;
  }
  if (chunk.heading && overlap(queryTerms, lexicon.headingTerms)) score += 5;
  return score;
}

function bounded(value: string, max: number): string {
  const normalizedValue = value.replace(/\s+/g, " ").trim();
  if (normalizedValue.length <= max) return normalizedValue;
  const clipped = normalizedValue.slice(0, max - 1);
  const boundary = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("? "), clipped.lastIndexOf("! "), clipped.lastIndexOf(" "));
  return `${clipped.slice(0, boundary > max / 2 ? boundary + 1 : max - 1).trim()}…`;
}

export function buildRelevantMethodologyContext(input: MethodologyRetrievalInput): RelevantMethodologyContext {
  const started = now();
  const attachments = attachmentMap(input);
  const indexBySource = new Map(input.indexes.map((index) => [index.source.id, index]));
  const selectedFrameworks = input.frameworks
    .filter((framework) => attachments.has(framework.sourceId))
    .map((framework) => ({ framework, score: frameworkScore(framework, attachments.get(framework.sourceId)!, input) }))
    .filter((item) => item.score > 5)
    .sort((left, right) => right.score - left.score || left.framework.id.localeCompare(right.framework.id))
    .slice(0, MAX_FRAMEWORKS);

  const frameworkRecords: RelevantMethodologyFramework[] = selectedFrameworks.map(({ framework }) => {
    const index = indexBySource.get(framework.sourceId)!;
    return Object.freeze({
      id: framework.id,
      title: bounded(framework.title, 160),
      summary: bounded(framework.summary, 420),
      guidance: bounded(framework.guidance, 850),
      sourceRef: `${framework.sourceId}@${index.version.sha256}`,
      location: `pp. ${framework.provenance.pageStart}-${framework.provenance.pageEnd}, ${framework.provenance.section}`,
    });
  });

  const selectedBySource = new Map<string, MethodologyFramework[]>();
  for (const { framework } of selectedFrameworks) selectedBySource.set(framework.sourceId, [...(selectedBySource.get(framework.sourceId) ?? []), framework]);
  const scoredChunks = input.indexes.flatMap((index) => {
    const attachment = attachments.get(index.source.id);
    const sourceFrameworks = selectedBySource.get(index.source.id);
    if (!attachment || !sourceFrameworks?.length) return [];
    return index.chunks.map((chunk) => ({ chunk, score: chunkScore(chunk, attachment, input, sourceFrameworks), order: attachment.order }));
  }).sort((left, right) => right.score - left.score || left.order - right.order || left.chunk.id.localeCompare(right.chunk.id)).slice(0, MAX_SUPPORT);

  const support: RelevantMethodologySupport[] = scoredChunks.map(({ chunk }) => Object.freeze({
    sourceRef: `${chunk.sourceId}@${chunk.sourceSha256}`,
    chunkId: chunk.id,
    location: chunk.location,
    ...(chunk.heading ? { heading: bounded(chunk.heading, 180) } : {}),
    text: bounded(chunk.text, MAX_SUPPORT_CHARACTERS),
  }));
  const sourceRefs = Object.freeze([...new Set([...frameworkRecords.map((item) => item.sourceRef), ...support.map((item) => item.sourceRef)])]);
  let result: RelevantMethodologyContext = Object.freeze({
    authority: AUTHORITY,
    profileGuidance: bounded(input.profileGuidance, 1_200),
    frameworks: Object.freeze(frameworkRecords),
    support: Object.freeze(support),
    sourceRefs,
    sourceCount: sourceRefs.length,
    chunkCount: support.length,
    retrievalMs: Math.max(0, Math.round((now() - started) * 100) / 100),
  });
  while (JSON.stringify(result).length > METHODOLOGY_CONTEXT_MAX_CHARACTERS && result.support.length) {
    result = Object.freeze({ ...result, support: Object.freeze(result.support.slice(0, -1)), chunkCount: result.support.length - 1 });
  }
  while (JSON.stringify(result).length > METHODOLOGY_CONTEXT_MAX_CHARACTERS && result.frameworks.length) {
    result = Object.freeze({ ...result, frameworks: Object.freeze(result.frameworks.slice(0, -1)) });
  }
  return result;
}
