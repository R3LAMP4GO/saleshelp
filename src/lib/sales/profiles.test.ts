import { expect, it } from "vitest";
import { getSalesProfile, isApproved, registerSalesProfile, type SalesProfile } from "./profiles";
import { salesMeetingMetadata, salesRecommendationMetadata } from "./meeting";

const profile: SalesProfile = {
  id: "test-profile", businessId: "test-business", label: "Test", motion: "cold-outbound",
  profile: { version: "1", status: "approved" }, playbook: { version: "2", status: "approved" },
  productFacts: { version: "3", status: "approved" }, evaluation: { version: "4", status: "approved" },
  vocabulary: [], qualificationFields: [], prohibitedClaims: [],
  responsePolicy: { allowCitedProductFacts: false, allowDeterministicFallback: true }, productFactEntries: [],
  behavior: { version: 1, objective: "Learn whether the workflow is relevant.", moves: [{ id: "O1", title: "Opening", goal: "Open the call.", script: "Hello.", responseMode: "verbatim", maxWords: 3, variables: [] }], discovery: [], objections: [], closeRequirements: ["Close respectfully."], claimConstraints: ["Do not make unsupported claims."], runtimePreferences: { modelBehavior: "bounded" } },
};

it("looks up registered profiles and persists immutable call metadata", () => {
  registerSalesProfile(profile);
  expect(getSalesProfile(profile.id)).toBe(profile);
  expect(salesMeetingMetadata(profile, { phone: "+15551234567" }, "2026-01-01T00:00:00.000Z")).toMatchObject({
    salesProfileId: profile.id, businessId: profile.businessId, playbookVersion: "2", productFactsVersion: "3", selectedAt: "2026-01-01T00:00:00.000Z",
  });
});

it("keeps prospect identifiers out of recommendation audit metadata", () => {
  const metadata = salesMeetingMetadata(profile, { phone: "+15551234567", crmLeadId: "lead-9" });
  expect(salesRecommendationMetadata(metadata)).not.toHaveProperty("prospect");
  expect(salesRecommendationMetadata(metadata)).toMatchObject({ salesProfileId: profile.id, playbookVersion: "2" });
});

it("defaults approval checks to deny", () => {
  expect(isApproved(undefined)).toBe(false);
  expect(isApproved({ version: "", status: "approved" })).toBe(false);
  expect(isApproved({ version: "1", status: "draft" })).toBe(false);
});
