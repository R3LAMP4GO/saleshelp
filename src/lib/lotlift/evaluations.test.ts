import { describe, expect, it } from "vitest";
import { buildLotLiftEvaluationTemplate, evaluateLotLiftBestNextResponse, LOTLIFT_EVALUATION_IDS } from "./evaluations";
import { newLotLiftCallState, reduceLotLiftCallState } from "./callState";
import type { TranscriptSegment } from "../types";
import { lotLiftGuidance, lotLiftPlaybookRule, lotLiftPlaybookSection, parseLotLiftPlaybook } from "./playbook";

describe("LotLift playbook", () => {
  it("contains every required coaching section", () => {
    expect(lotLiftPlaybookSection("Discovery sequence")).toContain("Lead sources");
    expect(lotLiftGuidance("Qualification rules", "What not to say")).toContain("Do not");
  });

  it("retrieves structured objection policy from Markdown", () => {
    expect(lotLiftPlaybookRule("objection:no-budget")).toMatchObject({
      intent: "Prospect raises price, affordability, or budget.",
      good_examples: ["“I hear you. For the first 50 customers, the basic plan is $20 and everything included is $24.99. Is the concern the price itself, the setup effort, another option, or whether the value is clear?”"],
    });
  });

  it("fails loudly when a required Markdown rule is missing", () => {
    expect(() => parseLotLiftPlaybook("# Partial playbook")).toThrow("missing required rule objection:not-interested");
  });

  it("scores only grounded, stage-safe, one-question next responses as best", () => {
    const turn: TranscriptSegment = { id: "prospect", text: "Who is this?", source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100 };
    const candidate = { response: "Who owns paid online inquiry response there?", tactic_id: "permission-and-route" as const, allowed_claim_classes: ["prospect-evidence", "approved-policy-fact", "question"] as const, proposed_stage: "owner-identification" as const, grounding_segment_id: "prospect" };
    const compliant = evaluateLotLiftBestNextResponse({ state: newLotLiftCallState("evaluation"), turn, conversation: [turn], candidate });
    expect(compliant).toMatchObject({ hard_failures: [], total: 12, is_best_next_response: true });

    const premature = evaluateLotLiftBestNextResponse({ state: newLotLiftCallState("premature"), turn, conversation: [turn], candidate: { ...candidate, tactic_id: "scoped-next-step", proposed_stage: "meeting-invitation", response: "Would you be open to a workflow check?" } });
    const unsupported = evaluateLotLiftBestNextResponse({ state: newLotLiftCallState("claim"), turn, conversation: [turn], candidate: { ...candidate, response: "We will recover leads for you. Who owns it?" } });
    const wrongStage = evaluateLotLiftBestNextResponse({ state: newLotLiftCallState("stage"), turn, conversation: [turn], candidate: { ...candidate, tactic_id: "workflow-discovery", proposed_stage: "meeting-invitation", response: "Which source matters most?" } });
    const twoQuestions = evaluateLotLiftBestNextResponse({ state: newLotLiftCallState("two"), turn, conversation: [turn], candidate: { ...candidate, response: "Who owns it? Which source matters?" } });
    let terminal = newLotLiftCallState("terminal");
    terminal = reduceLotLiftCallState(terminal, { type: "do-not-contact", at: "now", evidence: { segment_id: "prospect", text: turn.text } });
    const terminalViolation = evaluateLotLiftBestNextResponse({ state: terminal, turn, conversation: [turn], candidate });
    const truthfulLimitation = evaluateLotLiftBestNextResponse({ state: terminal, turn, conversation: [turn], candidate: { ...candidate, tactic_id: "truthful-limitation", allowed_claim_classes: ["truthful-limitation"] as const, proposed_stage: "terminal", response: "We do not integrate with that system." } });
    for (const result of [premature, unsupported, wrongStage, twoQuestions, terminalViolation]) expect(result.is_best_next_response).toBe(false);
    expect(premature.hard_failures).toContain("unmet stage context");
    expect(unsupported.hard_failures).toContain("disallowed claim");
    expect(twoQuestions.hard_failures).toContain("more than one new question");
    expect(terminalViolation.hard_failures).toContain("terminal-or-opt-out violation");
    expect(truthfulLimitation.hard_failures).not.toContain("disallowed claim");
  });

  it("ships the stable evaluation set", () => {
    const template = buildLotLiftEvaluationTemplate();
    expect(template.id).toBe("tpl-lotlift-sales");
    expect(template.evals.map((evaluation) => evaluation.id)).toEqual(LOTLIFT_EVALUATION_IDS);
  });
});
