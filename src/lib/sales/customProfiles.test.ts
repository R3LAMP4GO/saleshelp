import { expect, it } from "vitest";
import { customSalesMeetingMetadata, salesRecommendationMetadata } from "./meeting";
import { CUSTOM_PROFILE_TEXT_LIMIT, normalizePlaybookText, validateCustomSalesProfile } from "./customProfiles";

const profile = {
  id: "89e711c1-e6e5-4c96-a136-cc96e162bc3c",
  businessName: "  Acme   Co. ",
  modeName: " Discovery ",
  sourceName: "playbook.md",
  playbookText: "# Opening\r\n\r\nAsk why now.\u0000",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

it("normalizes bounded custom playbook text and fields", () => {
  expect(normalizePlaybookText(" a\r\nb\u0000 ")).toBe("a\nb");
  expect(normalizePlaybookText("x".repeat(CUSTOM_PROFILE_TEXT_LIMIT + 1))).toHaveLength(CUSTOM_PROFILE_TEXT_LIMIT);
  expect(validateCustomSalesProfile(profile)).toMatchObject({ businessName: "Acme Co.", modeName: "Discovery" });
  expect(() => validateCustomSalesProfile({ ...profile, id: "not-a-uuid" })).toThrow("Profile ID is invalid.");
  expect(() => validateCustomSalesProfile({ ...profile, playbookText: "  " })).toThrow("Playbook text is required.");
});

it("persists a custom profile source snapshot without prospect data in recommendations", () => {
  const metadata = customSalesMeetingMetadata(profile, { phone: "+15551234567" }, "2026-01-03T00:00:00.000Z");
  expect(metadata.customProfile).toMatchObject({ businessName: "Acme Co.", sourceName: "playbook.md", playbookText: "# Opening\n\nAsk why now." });
  expect(salesRecommendationMetadata(metadata)).not.toHaveProperty("prospect");
  expect(salesRecommendationMetadata(metadata)).toHaveProperty("customProfile.playbookText");
});
