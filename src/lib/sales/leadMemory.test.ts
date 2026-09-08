import { expect, it } from "vitest";
import { canonicalProspectId, createLeadMemory, isProspectDoNotContact, normalizePhone, normalizeProspect } from "./leadMemory";

it("normalizes a phone only for canonical prospect matching", () => {
  expect(normalizePhone("(555) 123-4567")).toBe("+5551234567");
  expect(normalizePhone("123")).toBeUndefined();
  expect(normalizeProspect({ name: " Ada ", phone: "(555) 123-4567" })).toEqual({ name: "Ada", phone: "+5551234567", role: undefined, crmLeadId: undefined });
  expect(canonicalProspectId({ crmLeadId: " LEAD-9 ", phone: "5551234567" })).toBe("crm:lead-9");
});

it("blocks DNC only for the same business and identifiable prospect", () => {
  const memory = createLeadMemory([{ businessId: "lotlift", canonicalProspectId: "phone:+5551234567", recordedAt: "2026-01-01T00:00:00.000Z" }]);
  expect(isProspectDoNotContact(memory, "lotlift", { phone: "555-123-4567" })).toBe(true);
  expect(memory.findDoNotContact("other-business", { phone: "555-123-4567" })).toBeNull();
  expect(memory.findDoNotContact("lotlift", { name: "Unidentified manual start" })).toBeNull();
});
