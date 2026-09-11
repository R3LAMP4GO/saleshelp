import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "../tauriEvents";
import {
  validateKnowledgeChunk,
  validateKnowledgeSource,
  validateKnowledgeSourceVersion,
  validateKnowledgeSnapshotReferences,
  validateMethodologyFramework,
  type KnowledgeIndex,
  type KnowledgeSnapshotReference,
  type KnowledgeSource,
  type KnowledgeSourceVersion,
  type ProfileKnowledgeAttachment,
} from "./knowledge";

export interface KnowledgeRegistryEntry {
  source: KnowledgeSource;
  currentVersion: KnowledgeSourceVersion;
}

export interface ImportedKnowledgeSource {
  source: KnowledgeSource;
  version: KnowledgeSourceVersion;
  deduplicated: boolean;
}

export interface KnowledgeSessionSnapshot {
  references: readonly KnowledgeSnapshotReference[];
  indexes: readonly KnowledgeIndex[];
}

const MAX_CACHED_INDEXES = 8;
const indexCache = new Map<string, KnowledgeIndex>();

function cacheKey(sourceId: string, versionHash: string): string {
  return `${sourceId}:${versionHash}`;
}

function cacheIndex(index: KnowledgeIndex): KnowledgeIndex {
  const key = cacheKey(index.source.id, index.version.sha256);
  indexCache.delete(key);
  indexCache.set(key, index);
  while (indexCache.size > MAX_CACHED_INDEXES) indexCache.delete(indexCache.keys().next().value!);
  return index;
}

function validateRegistryEntry(value: KnowledgeRegistryEntry): KnowledgeRegistryEntry {
  const source = validateKnowledgeSource(value.source);
  const currentVersion = validateKnowledgeSourceVersion(value.currentVersion);
  if (source.id !== currentVersion.sourceId) throw new Error("Knowledge registry source and version do not match.");
  return Object.freeze({ source, currentVersion });
}

function parseRegistry(raw: string): readonly KnowledgeRegistryEntry[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 100) throw new Error("Knowledge source registry is malformed.");
  const seen = new Set<string>();
  return Object.freeze(value.map((item) => {
    const entry = validateRegistryEntry(item as KnowledgeRegistryEntry);
    if (seen.has(entry.source.id)) throw new Error("Knowledge source registry contains duplicates.");
    seen.add(entry.source.id);
    return entry;
  }));
}

function parseIndex(raw: string, expectedSourceId: string, expectedHash: string): KnowledgeIndex {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Knowledge index is malformed.");
  const candidate = value as KnowledgeIndex;
  const source = validateKnowledgeSource(candidate.source);
  const version = validateKnowledgeSourceVersion(candidate.version);
  if (source.id !== expectedSourceId || version.sourceId !== expectedSourceId || version.sha256 !== expectedHash) throw new Error("Knowledge index does not match the requested immutable version.");
  if (!Array.isArray(candidate.chunks) || candidate.chunks.length !== version.chunkCount) throw new Error("Knowledge index chunk count is invalid.");
  const chunks = Object.freeze(candidate.chunks.map((chunk) => {
    const checked = validateKnowledgeChunk(chunk);
    if (checked.sourceId !== source.id || checked.sourceSha256 !== version.sha256 || checked.sourceTitle !== source.title || checked.pageEnd > version.pageCount) throw new Error("Knowledge chunk provenance is invalid.");
    return checked;
  }));
  if (!Array.isArray(candidate.frameworks)) throw new Error("Knowledge methodology is malformed.");
  const frameworks = Object.freeze(candidate.frameworks.map((framework) => {
    const checked = validateMethodologyFramework(framework);
    if (checked.sourceId !== source.id || (checked.sourceSha256 && checked.sourceSha256 !== version.sha256)) throw new Error("Knowledge framework provenance is invalid.");
    return checked;
  }));
  return Object.freeze({ source, version, chunks, frameworks });
}

export async function listKnowledgeSources(): Promise<readonly KnowledgeRegistryEntry[]> {
  if (!isTauri()) return Object.freeze([]);
  return parseRegistry(await invoke<string>("list_sales_knowledge_sources"));
}

export async function importKnowledgePdf(sourceId: string, title: string): Promise<ImportedKnowledgeSource | null> {
  if (!isTauri()) throw new Error("PDF knowledge import is available in the desktop app.");
  const selected = await open({ multiple: false, directory: false, title: `Choose ${title} PDF`, filters: [{ name: "PDF document", extensions: ["pdf"] }] });
  if (!selected || Array.isArray(selected)) return null;
  const imported = await invoke<ImportedKnowledgeSource>("import_sales_knowledge_pdf", { path: selected, sourceId, title, createdAt: new Date().toISOString() });
  return Object.freeze({ source: validateKnowledgeSource(imported.source), version: validateKnowledgeSourceVersion(imported.version), deduplicated: Boolean(imported.deduplicated) });
}

export async function loadKnowledgeIndex(sourceId: string, versionHash: string): Promise<KnowledgeIndex | null> {
  const key = cacheKey(sourceId, versionHash);
  const cached = indexCache.get(key);
  if (cached) return cacheIndex(cached);
  if (!isTauri()) return null;
  try {
    const raw = await invoke<string>("read_sales_knowledge_version", { sourceId, versionHash });
    return cacheIndex(parseIndex(raw, sourceId, versionHash));
  } catch {
    return null;
  }
}

export async function prepareKnowledgeSessionFrom(
  attachments: readonly ProfileKnowledgeAttachment[],
  registry: readonly KnowledgeRegistryEntry[],
  loadIndex: (sourceId: string, versionHash: string) => Promise<KnowledgeIndex | null>,
): Promise<KnowledgeSessionSnapshot> {
  const enabled = [...attachments].filter((attachment) => attachment.enabled).sort((left, right) => left.order - right.order);
  const entries = new Map(registry.map((entry) => [entry.source.id, validateRegistryEntry(entry)]));
  const references: KnowledgeSnapshotReference[] = [];
  const indexes: KnowledgeIndex[] = [];
  for (const attachment of enabled) {
    const entry = entries.get(attachment.sourceId);
    if (!entry) continue;
    const index = await loadIndex(entry.source.id, entry.currentVersion.sha256);
    if (!index) continue;
    indexes.push(index);
    references.push({ ...attachment, sourceTitle: entry.source.title, versionHash: entry.currentVersion.sha256, indexVersion: entry.currentVersion.indexVersion });
  }
  return Object.freeze({ references: validateKnowledgeSnapshotReferences(references), indexes: Object.freeze(indexes) });
}

export async function prepareKnowledgeSession(attachments: readonly ProfileKnowledgeAttachment[]): Promise<KnowledgeSessionSnapshot> {
  try {
    return await prepareKnowledgeSessionFrom(attachments, await listKnowledgeSources(), loadKnowledgeIndex);
  } catch {
    return Object.freeze({ references: Object.freeze([]), indexes: Object.freeze([]) });
  }
}

export function knowledgeSessionFromReferences(references: readonly KnowledgeSnapshotReference[] | undefined): KnowledgeSessionSnapshot {
  const validated = validateKnowledgeSnapshotReferences(references);
  const indexes = validated.flatMap((reference) => {
    const index = indexCache.get(cacheKey(reference.sourceId, reference.versionHash));
    return index ? [index] : [];
  });
  const loadedIds = new Set(indexes.map((index) => cacheKey(index.source.id, index.version.sha256)));
  return Object.freeze({ references: Object.freeze(validated.filter((reference) => loadedIds.has(cacheKey(reference.sourceId, reference.versionHash)))), indexes: Object.freeze(indexes) });
}

export function clearKnowledgeIndexCache(): void {
  indexCache.clear();
}
