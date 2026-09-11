import { expect, it } from "vitest";
import { LOTLIFT_KNOWLEDGE_ATTACHMENTS, LOTLIFT_METHODOLOGY_FRAMEWORKS } from "../../../sales-profiles/lotlift/methodology";
import type { KnowledgeIndex, ProfileKnowledgeAttachment } from "./knowledge";
import { buildRelevantMethodologyContext, METHODOLOGY_CONTEXT_MAX_CHARACTERS } from "./methodologyRetrieval";

const OBJECTIONS_HASH = "c".repeat(64);
const COLD_CALL_HASH = "d".repeat(64);

function index(sourceId: string, sourceTitle: string, hash: string, texts: string[]): KnowledgeIndex {
  return {
    source: { id: sourceId, title: sourceTitle, kind: "pdf", createdAt: "2026-09-11T00:00:00.000Z" },
    version: { sourceId, sha256: hash, byteSize: 100, pageCount: texts.length, chunkCount: texts.length, indexVersion: 1, createdAt: "2026-09-11T00:00:00.000Z" },
    chunks: texts.map((text, offset) => ({ id: `${sourceId}:${offset + 1}`, sourceId, sourceSha256: hash, sourceTitle, pageStart: offset + 1, pageEnd: offset + 1, location: `Page ${offset + 1}`, heading: offset === 0 ? "Objection guidance" : undefined, tags: ["objection"], text })),
    frameworks: [],
  };
}

const indexes = [
  index("objections-jeb-blount", "Objections", OBJECTIONS_HASH, ["A reflex response differs from a true objection. Acknowledge, disrupt, and ask one concise question.", "Prepare repeatable responses for common prospecting objections."]),
  index("cold-calling-sucks", "Cold Calling Sucks", COLD_CALL_HASH, ["For an existing CRM solution, agree with the current workflow before asking a neutral trap question about after-hours coverage.", "For price after pain, distinguish budget timing from value uncertainty without promising a discount.", "For a novel concern, agree with the concern and ask a short multiple-choice diagnostic question.", "Busy late in discovery can be a bandwidth constraint rather than an interruption reflex."]),
];

function retrieve(overrides: Partial<Parameters<typeof buildRelevantMethodologyContext>[0]> = {}) {
  return buildRelevantMethodologyContext({
    profileGuidance: "Follow LotLift policy. Ask one workflow question and honor a second refusal.",
    attachments: LOTLIFT_KNOWLEDGE_ATTACHMENTS,
    indexes,
    frameworks: LOTLIFT_METHODOLOGY_FRAMEWORKS,
    stage: "gap-confirmation",
    candidateIds: ["crm-coverage", "guided-objection-discovery"],
    objectionClass: "crm",
    stateTags: ["after-hours", "crm"],
    currentWording: "We use VinSolutions, but late leads sit until morning.",
    ...overrides,
  });
}

it("selects existing-solution guidance for verified CRM and after-hours wording", () => {
  const result = retrieve();
  expect(result.frameworks.map((item) => item.id)).toContain("existing-solution");
  expect(result.support.some((item) => item.text.includes("existing CRM"))).toBe(true);
  expect(result.sourceRefs).toContain(`cold-calling-sucks@${COLD_CALL_HASH}`);
});

it("selects situational guidance for price after verified pain", () => {
  const result = retrieve({ stage: "qualification", candidateIds: ["price-pain-value", "price-isolation"], objectionClass: "price", stateTags: ["pain-verified"], currentWording: "That sounds too expensive after all those missed leads." });
  expect(result.frameworks[0]?.id).toBe("situational-price");
  expect(result.support.some((item) => /price after pain/i.test(item.text))).toBe(true);
});

it("uses clarify guidance for a genuinely novel objection", () => {
  const result = retrieve({ stage: "relevance-discovery", candidateIds: ["guided-objection-discovery"], objectionClass: "unknown", stateTags: [], currentWording: "I worry the staff will think this is spying on them." });
  expect(result.frameworks.map((item) => item.id)).toContain("disarm-and-diagnose");
  expect(result.frameworks.some((item) => item.guidance.includes("diagnostic question"))).toBe(true);
});

it("scores identical busy wording differently by stage", () => {
  const early = retrieve({ stage: "owner-identification", candidateIds: ["first-refusal"], objectionClass: "busy", stateTags: [], currentWording: "I'm busy." });
  const late = retrieve({ stage: "qualification", candidateIds: ["guided-objection-discovery"], objectionClass: "busy", stateTags: [], currentWording: "I'm busy." });
  expect(early.frameworks[0]?.id).toBe("ledge-disrupt-ask");
  expect(late.frameworks[0]?.id).toBe("busy-as-bandwidth");
});

it("drops disabled and missing sources while preserving profile authority", () => {
  const disabled: ProfileKnowledgeAttachment[] = LOTLIFT_KNOWLEDGE_ATTACHMENTS.map((item) => ({ ...item, enabled: false }));
  const result = retrieve({ attachments: disabled });
  expect(result.frameworks).toEqual([]);
  expect(result.support).toEqual([]);
  expect(result.profileGuidance).toMatch(/^Follow LotLift policy/);
  expect(result.authority[0]).toMatch(/Safety and product truth/);
});

it("caps adversarially repetitive source material", () => {
  const huge = index("cold-calling-sucks", "Cold Calling Sucks", COLD_CALL_HASH, Array.from({ length: 200 }, () => "price budget pain workflow ".repeat(200)));
  const result = retrieve({ indexes: [huge], currentWording: "price budget pain workflow" });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(METHODOLOGY_CONTEXT_MAX_CHARACTERS);
  expect(result.support.length).toBeLessThanOrEqual(4);
  expect(result.chunkCount).toBe(result.support.length);
});
