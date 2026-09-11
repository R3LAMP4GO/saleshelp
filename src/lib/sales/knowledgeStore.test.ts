import { expect, it } from "vitest";
import { prepareKnowledgeSessionFrom, type KnowledgeRegistryEntry } from "./knowledgeStore";
import type { KnowledgeIndex, ProfileKnowledgeAttachment } from "./knowledge";

const HASH = "b".repeat(64);
const entry: KnowledgeRegistryEntry = {
  source: { id: "source-one", title: "Source One", kind: "pdf", createdAt: "2026-09-11T00:00:00.000Z" },
  currentVersion: { sourceId: "source-one", sha256: HASH, byteSize: 100, pageCount: 1, chunkCount: 1, indexVersion: 1, createdAt: "2026-09-11T00:00:00.000Z" },
};
const attachment: ProfileKnowledgeAttachment = { sourceId: "source-one", enabled: true, order: 1, priority: 80, role: "strategy", scope: ["objection"] };
const index: KnowledgeIndex = {
  source: entry.source,
  version: entry.currentVersion,
  chunks: [{ id: "source-one:0001", sourceId: "source-one", sourceSha256: HASH, sourceTitle: "Source One", pageStart: 1, pageEnd: 1, location: "Page 1", tags: [], text: "Ask one useful question." }],
  frameworks: [],
};

it("preloads only enabled source versions into an immutable session", async () => {
  const session = await prepareKnowledgeSessionFrom([attachment, { ...attachment, sourceId: "disabled", enabled: false, order: 2 }], [entry], async () => index);
  expect(session.references).toHaveLength(1);
  expect(session.references[0]).toMatchObject({ sourceId: "source-one", versionHash: HASH });
  expect(Object.isFrozen(session.references[0])).toBe(true);
});

it("skips missing or corrupt source versions without failing the session", async () => {
  const missing = await prepareKnowledgeSessionFrom([attachment], [entry], async () => null);
  expect(missing).toEqual({ references: [], indexes: [] });
});
