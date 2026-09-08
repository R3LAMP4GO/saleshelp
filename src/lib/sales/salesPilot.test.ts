import { expect, it } from "vitest";
import { SALES_PILOT_MAX_FACTS, compileSalesPilotProfile } from "./salesPilot";

const valid = `# Acme discovery

## Call objective
Book a product demo.

## Script stages
### stage:opening
Ask one relevant question.
### stage:discovery
Learn the current workflow.

## Objection rules
### rule:not-interested
Acknowledge and ask one clarifying question.

## Product facts
### product:lead-routing
**Statement:** Acme routes approved inbound leads to assigned owners.
**Category:** capability`;

it("compiles bounded allowlisted sales policy", () => {
  const profile = compileSalesPilotProfile(valid);
  expect(profile).toMatchObject({ title: "Acme discovery", objective: "Book a product demo." });
  expect(profile.stages.map((stage) => stage.id)).toEqual(["opening", "discovery"]);
  expect(profile.productFacts).toEqual([{ id: "lead-routing", statement: "Acme routes approved inbound leads to assigned owners.", category: "capability" }]);
});

it("allows an explicitly empty Product facts section", () => {
  expect(compileSalesPilotProfile(valid.replace(/### product:[\s\S]+$/, "")).productFacts).toEqual([]);
});

it("rejects malformed or unsafe product facts", () => {
  expect(() => compileSalesPilotProfile(valid.replace("lead-routing", "wrong id"))).toThrow("Product facts");
  expect(() => compileSalesPilotProfile(valid.replace("capability", "unsupported"))).toThrow("Category");
  expect(() => compileSalesPilotProfile(valid.replace("### product:lead-routing", "### product:lead-routing\n**Statement:** Duplicate\n**Category:** capability\n### product:lead-routing"))).toThrow("unique");
  expect(() => compileSalesPilotProfile(valid.replace("## Objection rules", "## Missing rules"))).toThrow("Objection rules");
  expect(() => compileSalesPilotProfile(valid.replace("Acme routes approved inbound leads to assigned owners.", "x".repeat(501)))).toThrow("plain-text");
  const facts = Array.from({ length: SALES_PILOT_MAX_FACTS + 1 }, (_, index) => `### product:fact-${index + 10}\n**Statement:** Approved product statement number ${index + 10}.\n**Category:** capability`).join("\n");
  expect(() => compileSalesPilotProfile(valid.replace(/### product:[\s\S]+$/, facts))).toThrow("limited");
});
