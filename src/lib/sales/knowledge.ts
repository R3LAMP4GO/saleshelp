export const KNOWLEDGE_INDEX_VERSION = 1 as const;
export const KNOWLEDGE_LIMITS = Object.freeze({
  maxPdfBytes: 25 * 1024 * 1024,
  maxPages: 500,
  maxExtractedCharacters: 2_000_000,
  maxChunks: 2_000,
  maxChunkCharacters: 4_000,
  maxFrameworks: 100,
});

export interface KnowledgeSource {
  id: string;
  title: string;
  kind: "pdf";
  createdAt: string;
}

export interface KnowledgeSourceVersion {
  sourceId: string;
  sha256: string;
  byteSize: number;
  pageCount: number;
  chunkCount: number;
  indexVersion: typeof KNOWLEDGE_INDEX_VERSION;
  createdAt: string;
}

export interface KnowledgeChunk {
  id: string;
  sourceId: string;
  sourceSha256: string;
  sourceTitle: string;
  pageStart: number;
  pageEnd: number;
  location: string;
  heading?: string;
  tags: readonly string[];
  text: string;
}

export interface MethodologyFramework {
  id: string;
  sourceId: string;
  sourceSha256?: string;
  title: string;
  summary: string;
  guidance: string;
  stages: readonly string[];
  candidateIds: readonly string[];
  objectionClasses: readonly string[];
  stateTags: readonly string[];
  wording: readonly string[];
  provenance: { pageStart: number; pageEnd: number; section: string };
}

export interface ProfileKnowledgeAttachment {
  sourceId: string;
  enabled: boolean;
  order: number;
  priority: number;
  role: string;
  scope: readonly string[];
}

export interface KnowledgeSnapshotReference extends ProfileKnowledgeAttachment {
  sourceTitle: string;
  versionHash: string;
  indexVersion: typeof KNOWLEDGE_INDEX_VERSION;
}

export interface KnowledgeIndex {
  source: KnowledgeSource;
  version: KnowledgeSourceVersion;
  chunks: readonly KnowledgeChunk[];
  frameworks: readonly MethodologyFramework[];
}

const SAFE_ID = /^[a-z][a-z0-9-]{1,79}$/;
const SAFE_CHUNK_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function plainText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\u0000]/.test(normalized)) throw new Error(`${label} must be plain text up to ${max} characters.`);
  return normalized;
}

function safeDate(value: unknown, label: string): string {
  const date = plainText(value, label, 40);
  if (Number.isNaN(Date.parse(date))) throw new Error(`${label} is invalid.`);
  return date;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return value as number;
}

function safeId(value: unknown, label: string): string {
  const id = plainText(value, label, 80);
  if (!SAFE_ID.test(id)) throw new Error(`${label} is unsafe.`);
  return id;
}

function hash(value: unknown, label = "Knowledge version hash"): string {
  const checked = plainText(value, label, 64).toLowerCase();
  if (!SHA256.test(checked)) throw new Error(`${label} must be a SHA-256 hash.`);
  return checked;
}

function textList(value: unknown, label: string, maxItems = 32, maxText = 100): readonly string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} must contain at most ${maxItems} items.`);
  const result = value.map((item) => plainText(item, label, maxText));
  return Object.freeze([...new Set(result)]);
}

export function validateKnowledgeSource(value: KnowledgeSource): KnowledgeSource {
  if (!value || typeof value !== "object" || value.kind !== "pdf") throw new Error("Knowledge source must be a PDF.");
  return Object.freeze({ id: safeId(value.id, "Knowledge source ID"), title: plainText(value.title, "Knowledge source title", 200), kind: "pdf", createdAt: safeDate(value.createdAt, "Knowledge source creation time") });
}

export function validateKnowledgeSourceVersion(value: KnowledgeSourceVersion): KnowledgeSourceVersion {
  if (!value || typeof value !== "object" || value.indexVersion !== KNOWLEDGE_INDEX_VERSION) throw new Error("Knowledge index version is unsupported.");
  return Object.freeze({
    sourceId: safeId(value.sourceId, "Knowledge source ID"),
    sha256: hash(value.sha256),
    byteSize: integer(value.byteSize, "Knowledge source byte size", 1, KNOWLEDGE_LIMITS.maxPdfBytes),
    pageCount: integer(value.pageCount, "Knowledge page count", 1, KNOWLEDGE_LIMITS.maxPages),
    chunkCount: integer(value.chunkCount, "Knowledge chunk count", 1, KNOWLEDGE_LIMITS.maxChunks),
    indexVersion: KNOWLEDGE_INDEX_VERSION,
    createdAt: safeDate(value.createdAt, "Knowledge version creation time"),
  });
}

export function validateKnowledgeChunk(value: KnowledgeChunk): KnowledgeChunk {
  if (!value || typeof value !== "object") throw new Error("Knowledge chunk is invalid.");
  const id = plainText(value.id, "Knowledge chunk ID", 160);
  if (!SAFE_CHUNK_ID.test(id)) throw new Error("Knowledge chunk ID is unsafe.");
  const pageStart = integer(value.pageStart, "Knowledge chunk first page", 1, KNOWLEDGE_LIMITS.maxPages);
  const pageEnd = integer(value.pageEnd, "Knowledge chunk last page", pageStart, KNOWLEDGE_LIMITS.maxPages);
  return Object.freeze({
    id,
    sourceId: safeId(value.sourceId, "Knowledge source ID"),
    sourceSha256: hash(value.sourceSha256),
    sourceTitle: plainText(value.sourceTitle, "Knowledge source title", 200),
    pageStart,
    pageEnd,
    location: plainText(value.location, "Knowledge chunk location", 240),
    ...(value.heading ? { heading: plainText(value.heading, "Knowledge chunk heading", 240) } : {}),
    tags: textList(value.tags, "Knowledge chunk tags", 24, 80),
    text: plainText(value.text, "Knowledge chunk text", KNOWLEDGE_LIMITS.maxChunkCharacters),
  });
}

export function validateMethodologyFramework(value: MethodologyFramework): MethodologyFramework {
  if (!value || typeof value !== "object") throw new Error("Methodology framework is invalid.");
  const sourceId = safeId(value.sourceId, "Knowledge source ID");
  const pageStart = integer(value.provenance?.pageStart, "Framework first page", 1, KNOWLEDGE_LIMITS.maxPages);
  const pageEnd = integer(value.provenance?.pageEnd, "Framework last page", pageStart, KNOWLEDGE_LIMITS.maxPages);
  return Object.freeze({
    id: safeId(value.id, "Framework ID"), sourceId,
    ...(value.sourceSha256 ? { sourceSha256: hash(value.sourceSha256) } : {}),
    title: plainText(value.title, "Framework title", 160),
    summary: plainText(value.summary, "Framework summary", 500),
    guidance: plainText(value.guidance, "Framework guidance", 1_200),
    stages: textList(value.stages, "Framework stages", 16, 80),
    candidateIds: textList(value.candidateIds, "Framework candidate IDs", 32, 80),
    objectionClasses: textList(value.objectionClasses, "Framework objection classes", 24, 80),
    stateTags: textList(value.stateTags, "Framework state tags", 32, 80),
    wording: textList(value.wording, "Framework wording", 32, 160),
    provenance: Object.freeze({ pageStart, pageEnd, section: plainText(value.provenance?.section, "Framework section", 240) }),
  });
}

function validateAttachment(value: ProfileKnowledgeAttachment): ProfileKnowledgeAttachment {
  if (!value || typeof value !== "object" || typeof value.enabled !== "boolean") throw new Error("Knowledge attachment is invalid.");
  return Object.freeze({
    sourceId: safeId(value.sourceId, "Knowledge source ID"), enabled: value.enabled,
    order: integer(value.order, "Knowledge attachment order", 0, 1_000),
    priority: integer(value.priority, "Knowledge attachment priority", 0, 100),
    role: plainText(value.role, "Knowledge attachment role", 160),
    scope: textList(value.scope, "Knowledge attachment scope", 24, 80),
  });
}

export function validateProfileKnowledgeAttachments(value: readonly ProfileKnowledgeAttachment[] | undefined): readonly ProfileKnowledgeAttachment[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 20) throw new Error("A profile may attach at most 20 knowledge sources.");
  const seen = new Set<string>();
  const validated = value.map((item) => {
    const attachment = validateAttachment(item);
    if (seen.has(attachment.sourceId)) throw new Error("Profile knowledge sources must be unique.");
    seen.add(attachment.sourceId);
    return attachment;
  }).sort((left, right) => left.order - right.order || right.priority - left.priority || left.sourceId.localeCompare(right.sourceId));
  return Object.freeze(validated);
}

export function validateKnowledgeSnapshotReferences(value: readonly KnowledgeSnapshotReference[] | undefined): readonly KnowledgeSnapshotReference[] {
  const attachments = validateProfileKnowledgeAttachments(value);
  const sourceValues = new Map((value ?? []).map((item) => [item.sourceId, item]));
  return Object.freeze(attachments.map((attachment) => {
    const original = sourceValues.get(attachment.sourceId)!;
    if (original.indexVersion !== KNOWLEDGE_INDEX_VERSION) throw new Error("Knowledge snapshot index version is unsupported.");
    return Object.freeze({ ...attachment, sourceTitle: plainText(original.sourceTitle, "Knowledge source title", 200), versionHash: hash(original.versionHash), indexVersion: KNOWLEDGE_INDEX_VERSION });
  }));
}

export function validateKnowledgeIndex(value: KnowledgeIndex): KnowledgeIndex {
  const source = validateKnowledgeSource(value.source);
  const version = validateKnowledgeSourceVersion(value.version);
  if (version.sourceId !== source.id) throw new Error("Knowledge source and version do not match.");
  if (!Array.isArray(value.chunks) || value.chunks.length !== version.chunkCount) throw new Error("Knowledge index chunk count does not match its version.");
  const chunks = Object.freeze(value.chunks.map(validateKnowledgeChunk));
  if (chunks.some((chunk) => chunk.sourceId !== source.id || chunk.sourceSha256 !== version.sha256 || chunk.pageEnd > version.pageCount)) throw new Error("Knowledge chunk provenance does not match its source version.");
  if (!Array.isArray(value.frameworks) || value.frameworks.length > KNOWLEDGE_LIMITS.maxFrameworks) throw new Error("Knowledge index has too many frameworks.");
  const frameworks = Object.freeze(value.frameworks.map(validateMethodologyFramework));
  if (frameworks.some((framework) => framework.sourceId !== source.id || (framework.sourceSha256 && framework.sourceSha256 !== version.sha256) || framework.provenance.pageEnd > version.pageCount)) throw new Error("Methodology framework provenance does not match its source version.");
  return Object.freeze({ source, version, chunks, frameworks });
}
