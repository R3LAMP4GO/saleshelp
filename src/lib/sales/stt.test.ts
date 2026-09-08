import { expect, it } from "vitest";
import "../../../sales-profiles/lotlift/profile";
import { salesVocabularyTerms } from "./stt";

it("merges active profile terms before deduplicated global vocabulary", () => {
  expect(salesVocabularyTerms(["crm", "Parley", "LotLift"], {
    salesProfileId: "lotlift-cold-outbound", businessId: "lotlift", motion: "cold-outbound",
    profileVersion: "1", playbookVersion: "1", productFactsVersion: "1", evaluationVersion: "1", selectedAt: "2026-01-01T00:00:00.000Z",
  })).toEqual(["LotLift", "Cars.com", "CarGurus", "AutoTrader", "BDC", "CRM", "DMS", "Parley"]);
});

it("does not leak terms across businesses", () => {
  expect(salesVocabularyTerms(["Parley"], {
    salesProfileId: "lotlift-cold-outbound", businessId: "other-business", motion: "cold-outbound",
    profileVersion: "1", playbookVersion: "1", productFactsVersion: "1", evaluationVersion: "1", selectedAt: "2026-01-01T00:00:00.000Z",
  })).toEqual(["Parley"]);
});
