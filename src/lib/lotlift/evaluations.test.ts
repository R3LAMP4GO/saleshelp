import { describe, expect, it } from "vitest";
import { buildLotLiftEvaluationTemplate, LOTLIFT_EVALUATION_IDS } from "./evaluations";
import { lotLiftGuidance, lotLiftPlaybookRule, lotLiftPlaybookSection, parseLotLiftPlaybook } from "./playbook";

describe("LotLift playbook", () => {
  it("contains every required coaching section", () => {
    expect(lotLiftPlaybookSection("Discovery sequence")).toContain("Lead sources");
    expect(lotLiftGuidance("Qualification rules", "What not to say")).toContain("Do not");
  });

  it("retrieves structured objection policy from Markdown", () => {
    expect(lotLiftPlaybookRule("objection:no-budget")).toMatchObject({
      intent: "Prospect raises price, affordability, or budget.",
      good_examples: ["“Is the concern the monthly number, setup effort, comparison with another option, or that the return is not clear enough?”"],
    });
  });

  it("fails loudly when a required Markdown rule is missing", () => {
    expect(() => parseLotLiftPlaybook("# Partial playbook")).toThrow("missing required rule objection:not-interested");
  });

  it("ships the stable evaluation set", () => {
    const template = buildLotLiftEvaluationTemplate();
    expect(template.id).toBe("tpl-lotlift-sales");
    expect(template.evals.map((evaluation) => evaluation.id)).toEqual(LOTLIFT_EVALUATION_IDS);
  });
});
