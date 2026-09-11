import { expect, it } from "vitest";
import {
  validateKnowledgeChunk,
  validateKnowledgeSource,
  validateKnowledgeSourceVersion,
  validateMethodologyFramework,
  validateProfileKnowledgeAttachments,
  validateKnowledgeSnapshotReferences,
  type KnowledgeSource,
  type KnowledgeSourceVersion,
} from "./knowledge";
import { resolveSalesProfile, type SalesProfile } from "./profiles";
import { salesMeetingMetadata } from "./meeting";

const HASH = "a".repeat(64);
const source: KnowledgeSource = {
  id: "objections-jeb-blount",
  title: "Objections",
  kind: "pdf",
  createdAt: "2026-09-11T00:00:00.000Z",
};
const version: KnowledgeSourceVersion = {
  sourceId: source.id,
  sha256: HASH,
  byteSize: 1_650_737,
  pageCount: 214,
  chunkCount: 120,
  indexVersion: 1,
  createdAt: "2026-09-11T00:00:00.000Z",
};

it("validates bounded source, version, chunk, and framework records", () => {
  expect(validateKnowledgeSource(source)).toEqual(source);
  expect(validateKnowledgeSourceVersion(version)).toEqual(version);
  expect(validateKnowledgeChunk({
    id: "objections-jeb-blount:0001",
    sourceId: source.id,
    sourceSha256: HASH,
    sourceTitle: source.title,
    pageStart: 106,
    pageEnd: 108,
    location: "Chapter 10",
    heading: "Three-Step Prospecting Objection Turnaround Framework",
    tags: ["objection", "prospecting"],
    text: "Acknowledge briefly, disrupt the expected pattern, then ask for a small next step.",
  })).toMatchObject({ pageStart: 106, pageEnd: 108 });
  expect(validateMethodologyFramework({
    id: "three-step-turnaround",
    sourceId: source.id,
    sourceSha256: HASH,
    title: "Prospecting objection turnaround",
    summary: "Lower resistance before requesting a small next step.",
    guidance: "Acknowledge the concern, interrupt the expected pattern, and ask one concise question.",
    stages: ["opening", "discovery"],
    candidateIds: ["first-refusal"],
    objectionClasses: ["not-interested"],
    stateTags: ["after-hours"],
    wording: ["not interested"],
    provenance: { pageStart: 106, pageEnd: 108, section: "Chapter 10" },
  })).toMatchObject({ id: "three-step-turnaround" });
});

it("rejects unsafe identifiers, hash mismatches, and unbounded text", () => {
  expect(() => validateKnowledgeSource({ ...source, id: "../outside" })).toThrow();
  expect(() => validateKnowledgeSourceVersion({ ...version, sha256: "nope" })).toThrow();
  expect(() => validateKnowledgeChunk({
    id: "chunk", sourceId: source.id, sourceSha256: HASH, sourceTitle: source.title,
    pageStart: 1, pageEnd: 1, location: "Page 1", tags: [], text: "x".repeat(4_001),
  })).toThrow();
});

it("keeps profile attachments independent, ordered, and immutable", () => {
  const input = [
    { sourceId: "cold-calling-sucks", enabled: true, order: 2, priority: 60, role: "cold-call execution", scope: ["opening"] },
    { sourceId: source.id, enabled: false, order: 1, priority: 90, role: "objection strategy", scope: ["objection"] },
  ];
  const validated = validateProfileKnowledgeAttachments(input);
  expect(validated.map((item) => item.sourceId)).toEqual([source.id, "cold-calling-sucks"]);
  input[0]!.scope[0] = "mutated";
  expect(validated[1]!.scope).toEqual(["opening"]);
  expect(Object.isFrozen(validated[1]!.scope)).toBe(true);
});

it("captures content hashes in immutable meeting snapshots", () => {
  const attachments = validateProfileKnowledgeAttachments([
    { sourceId: source.id, enabled: true, order: 1, priority: 90, role: "objection strategy", scope: ["objection"] },
  ]);
  const profile: SalesProfile = {
    id: "knowledge-profile", businessId: "test", label: "Knowledge", motion: "cold-outbound",
    profile: { version: "1", status: "approved" }, playbook: { version: "1", status: "approved" },
    productFacts: { version: "1", status: "approved" }, evaluation: { version: "1", status: "approved" },
    vocabulary: [], qualificationFields: [], prohibitedClaims: [],
    responsePolicy: { allowCitedProductFacts: false, allowDeterministicFallback: true }, productFactEntries: [],
    behavior: { version: 1, objective: "Learn the workflow.", moves: [{ id: "O1", title: "Open", goal: "Open.", script: "Hello there.", responseMode: "verbatim", maxWords: 3, variables: [] }], discovery: [], objections: [], closeRequirements: ["Close."], claimConstraints: ["No claims."], runtimePreferences: {} },
    knowledgeAttachments: attachments,
  };
  const resolved = resolveSalesProfile(profile);
  const snapshots = validateKnowledgeSnapshotReferences([{ sourceId: source.id, sourceTitle: source.title, versionHash: HASH, indexVersion: 1, enabled: true, order: 1, priority: 90, role: "objection strategy", scope: ["objection"] }]);
  const metadata = salesMeetingMetadata(profile, undefined, "2026-09-11T00:00:00.000Z", resolved, snapshots);
  expect(metadata.knowledgeSnapshots?.[0]).toMatchObject({ versionHash: HASH, role: "objection strategy" });
  expect(Object.isFrozen(metadata.knowledgeSnapshots?.[0])).toBe(true);
});
