import { expect, it } from "vitest";
import { analyzeSalesPilotTurn } from "./pilotCoach";
import { compileSalesPilotProfile } from "./salesPilot";

const profile = compileSalesPilotProfile(`# Demo

## Call objective
Book a product demo.

## Script stages
### stage:opening
Open the conversation.
### stage:close
Book the demo.

## Objection rules
### rule:not-interested
Clarify the concern.

## Product facts
### product:lead-routing
**Statement:** Demo routes approved leads to assigned owners.
**Category:** capability`);
const turn = { id: "turn-1", source: "them", speaker: 0, text: "We miss leads after hours.", isFinal: true, startMs: 0, endMs: 1000 } as const;

it("accepts a compiled profile statement with fact provenance", async () => {
  const result = await analyzeSalesPilotTurn({ profile, currentStage: "opening", turn, conversation: [turn], model: async () => ({ needs_coaching: true, say: "Demo routes approved leads to assigned owners.", current_stage: "opening", next_stage: "close", customer_evidence: [], product_claims: [{ sentence: "Demo routes approved leads to assigned owners.", product_fact_id: "lead-routing" }] }) });
  expect(result).toMatchObject({ source: "model", next_stage: "close" });
});

it("accepts a question without a product claim", async () => {
  const result = await analyzeSalesPilotTurn({ profile, currentStage: "opening", turn, conversation: [turn], model: async () => ({ needs_coaching: true, say: "Who owns those leads after hours?", current_stage: "opening", next_stage: "close", customer_evidence: [{ segment_id: "turn-1", text: "We miss leads after hours." }], product_claims: [] }) });
  expect(result).toMatchObject({ source: "model", say: "Who owns those leads after hours?" });
});

it("fails closed for an unrelated fact ID and profiles without facts", async () => {
  const model = async () => ({ needs_coaching: true, say: "Demo routes approved leads to assigned owners.", current_stage: "opening", next_stage: "close", customer_evidence: [], product_claims: [{ sentence: "Demo routes approved leads to assigned owners.", product_fact_id: "missing" }] });
  expect((await analyzeSalesPilotTurn({ profile, currentStage: "opening", turn, conversation: [turn], model })).say).toBeNull();
  const empty = compileSalesPilotProfile(profileSourceWithoutFacts());
  expect((await analyzeSalesPilotTurn({ profile: empty, currentStage: "opening", turn, conversation: [turn], model: async () => ({ needs_coaching: true, say: "Demo routes approved leads to assigned owners.", current_stage: "opening", next_stage: "close", customer_evidence: [], product_claims: [{ sentence: "Demo routes approved leads to assigned owners.", product_fact_id: "lead-routing" }] }) })).say).toBeNull();
});

function profileSourceWithoutFacts(): string {
  return `# Empty

## Call objective
Book a product demo.

## Script stages
### stage:opening
Open the conversation.
### stage:close
Book the demo.

## Objection rules
### rule:not-interested
Clarify the concern.

## Product facts`;
}
