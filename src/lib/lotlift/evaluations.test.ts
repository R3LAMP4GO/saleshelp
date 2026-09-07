import { describe, expect, it } from "vitest";
import { buildLotLiftEvaluationTemplate, LOTLIFT_EVALUATION_IDS } from "./evaluations";
import { lotLiftGuidance, lotLiftPlaybookSection } from "./playbook";

describe("LotLift playbook", () => {
  it("contains every required coaching section", () => {
    expect(lotLiftPlaybookSection("Discovery sequence")).toContain("Lead sources");
    expect(lotLiftGuidance("Qualification rules", "What not to say")).toContain("Do not");
  });

  it("ships the stable evaluation set", () => {
    const template = buildLotLiftEvaluationTemplate();
    expect(template.id).toBe("tpl-lotlift-sales");
    expect(template.evals.map((evaluation) => evaluation.id)).toEqual(LOTLIFT_EVALUATION_IDS);
  });
});
