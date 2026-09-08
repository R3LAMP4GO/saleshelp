import { expect, it } from "vitest";
import "../../../sales-profiles/lotlift/profile";
import { resolveApprovedSalesProfile } from "./policy";

const metadata = {
  salesProfileId: "lotlift-cold-outbound", businessId: "lotlift", motion: "cold-outbound" as const,
  profileVersion: "1", playbookVersion: "1", productFactsVersion: "1", evaluationVersion: "1", selectedAt: "2026-01-01T00:00:00.000Z",
};

it("fails closed for stale or cross-business profile metadata", () => {
  expect(resolveApprovedSalesProfile(metadata)?.id).toBe("lotlift-cold-outbound");
  expect(resolveApprovedSalesProfile({ ...metadata, playbookVersion: "stale" })).toBeNull();
  expect(resolveApprovedSalesProfile({ ...metadata, businessId: "other-business" })).toBeNull();
});
