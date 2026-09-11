import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "../types";
import { newLotLiftCallState, type LotLiftFieldValue } from "./callState";
import { buildLotLiftCompositionPayload, buildLotLiftContextPack } from "./contextPack";

function segment(id: string, source: TranscriptSegment["source"], text: string, endMs: number): TranscriptSegment {
  return { id, source, text, speaker: 0, isFinal: true, startMs: endMs - 100, endMs };
}

function verified(value: string, id = "evidence"): LotLiftFieldValue<string> {
  return { value, status: "verified", evidence: { segment_id: id, text: value } };
}

describe("LotLift ContextPack", () => {
  it("selects recent dialogue, durable decision facts, prior objection responses, and relevant rules", () => {
    const state = newLotLiftCallState("call-1");
    state.current_solution = verified("VinSolutions", "old-objection");
    state.pain_points = [verified("Internet leads wait overnight", "recent-pain")];
    state.decision_stakeholders = [verified("wife", "old-objection")];
    state.authority = verified("general manager", "recent-authority");

    const conversation = [
      segment("old-objection", "them", "We already have a CRM.", 150_000),
      segment("old-response", "me", "How are those leads handled after hours?", 151_000),
      segment("too-old", "them", "This should stay out of the dialogue window.", 180_000),
      segment("recent-pain", "them", "Our internet leads wait overnight.", 230_000),
      segment("recent-authority", "me", "Who owns that workflow today?", 270_000),
      segment("current", "them", "We already have a CRM for that.", 300_000),
    ];
    const current = conversation[conversation.length - 1]!;

    const pack = buildLotLiftContextPack(state, current, conversation, ["objection:existing-crm", "qualification:pain", "qualification:authority", "discovery:lead-source"]);

    expect(pack.current_stage).toBe("objection");
    expect(pack.durable_facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "current_solution", value: "VinSolutions" }),
      expect.objectContaining({ field: "pain_points", value: "Internet leads wait overnight" }),
      expect.objectContaining({ field: "decision_stakeholders", value: "wife" }),
      expect.objectContaining({ field: "authority", value: "general manager" }),
    ]));
    expect(pack.recent_dialogue.map((item) => item.id)).toEqual(["recent-pain", "recent-authority", "current"]);
    expect(pack.previous_objections).toEqual([expect.objectContaining({
      rule_id: "objection:existing-crm",
      prospect_text: "We already have a CRM.",
      rep_response: "How are those leads handled after hours?",
    })]);
    expect(pack.playbook_rules.map((rule) => rule.id)).toEqual(["objection:existing-crm", "qualification:pain", "qualification:authority"]);
  });

  it("keeps the complete role-aware transcript local while bounding prompt retrieval", () => {
    const state = newLotLiftCallState("composition");
    state.workflow_owner = verified("internet manager", "owner");
    state.authority = verified("general manager", "authority");
    state.decision_stakeholders = [verified("wife", "stakeholder")];
    const conversation = [
      segment("owner", "them", "The internet manager owns it.", 100),
      segment("rep", "me", "Who decides?", 200),
      segment("authority", "them", "I am the general manager.", 300),
    ];
    const payload = buildLotLiftCompositionPayload(state, conversation[2]!, conversation, []);
    expect(payload).toMatchObject({
      composition_version: 3,
      full_transcript: conversation,
      next_unresolved_workflow_detail: "where paid online inquiries arrive",
      stakeholder_context: {
        owner: [expect.objectContaining({ value: "internet manager", status: "verified" })],
        authority: [expect.objectContaining({ value: "general manager", status: "verified" })],
        decision_stakeholders: [expect.objectContaining({ value: "wife", status: "verified" })],
      },
    });
    expect(payload.previous_rep_questions).toEqual([{ id: "rep", text: "Who decides?" }]);
  });

  it("keeps actual representative history outside the recent dialogue window", () => {
    const state = newLotLiftCallState("rep-memory");
    const conversation = [
      segment("first-no", "them", "We are not interested.", 0),
      segment("rep-question", "me", "Is that because coverage is consistent or it is not a priority?", 1_000),
      ...Array.from({ length: 12 }, (_, index) => segment(`filler-${index}`, "them", `Unrelated ${index}`, 10_000 + index * 10_000)),
      segment("current", "them", "No, we are still not interested.", 200_000),
    ];
    const payload = buildLotLiftCompositionPayload(state, conversation[conversation.length - 1]!, conversation, []);
    expect(payload.previous_rep_questions).toEqual(expect.arrayContaining([expect.objectContaining({ id: "rep-question" })]));
    expect(payload.previous_objection_responses).toEqual(expect.arrayContaining([expect.objectContaining({ rep_response: "Is that because coverage is consistent or it is not a priority?" })]));
  });

  it("caps recent dialogue while retaining the latest prospect turn", () => {
    const conversation = Array.from({ length: 21 }, (_, index) => segment(`turn-${index}`, index % 2 ? "me" : "them", `Turn ${index}`, 100_000 + index * 1_000));
    const current = conversation[conversation.length - 1]!;
    const pack = buildLotLiftContextPack(newLotLiftCallState("bounded"), current, conversation, []);

    expect(pack.recent_dialogue).toHaveLength(12);
    expect(pack.recent_dialogue[pack.recent_dialogue.length - 1]?.id).toBe(current.id);
    expect(pack.recent_dialogue.map((item) => item.id)).not.toContain("turn-0");
  });
});
