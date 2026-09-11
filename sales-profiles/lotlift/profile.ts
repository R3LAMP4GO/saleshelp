import { lotLiftPlaybookSection, lotLiftSalesPilotProfile } from "../../src/lib/lotlift/playbook";
import { registerSalesProfile, type SalesProfile } from "../../src/lib/sales/profiles";

export const LOTLIFT_COLD_OUTBOUND_PROFILE: SalesProfile = {
  id: "lotlift-cold-outbound",
  businessId: "lotlift",
  label: "LotLift — Cold Outbound",
  motion: "cold-outbound",
  profile: { version: "1", status: "approved" },
  playbook: { version: "1", status: "approved" },
  productFacts: { version: "1", status: "approved" },
  evaluation: { version: "1", status: "approved" },
  vocabulary: ["LotLift", "Cars.com", "CarGurus", "AutoTrader", "BDC", "CRM", "DMS"],
  qualificationFields: ["lead_sources", "lead_arrival_point", "workflow_owner", "after_hours_process", "visibility_process", "pain_points", "authority", "urgency"],
  prohibitedClaims: ["pricing", "integration", "ROI", "customer claims", "booking", "email", "CRM", "owner claims"],
  responsePolicy: { allowCitedProductFacts: true, allowDeterministicFallback: true },
  productFactEntries: lotLiftSalesPilotProfile.productFacts.map((fact) => ({ ...fact, version: "1", approval: { version: "1", status: "approved" } })),
  behavior: {
    version: 1,
    objective: lotLiftSalesPilotProfile.objective,
    moves: [
      { id: "O0", title: "Greeting and permission", goal: "Earn permission for one discovery question.", script: "Hi, this is LotLift. I’m calling about how paid online inquiries are handled. Do you have 30 seconds for one quick question?", responseMode: "template", maxWords: 25, variables: [] },
      { id: "O2", title: "Who is this?", goal: "Identify the caller truthfully and wait.", script: "It’s [configured rep name], founder of LotLift.", responseMode: "template", maxWords: 15, variables: ["configured rep name"] },
      { id: "O3", title: "Purpose and permission", goal: "Learn one workflow fact without scheduling.", script: "I’m calling about who handles your online leads there. Is that you?", responseMode: "verbatim", maxWords: 20, variables: [], expectedAnswer: { kind: "confirmation", targetField: "workflow_owner" } },
      { id: "gap-after-hours", title: "After-hours coverage", goal: "Learn what happens to late online inquiries.", script: "How is coverage handled when an online inquiry arrives after hours?", responseMode: "compose", maxWords: 30, variables: [], expectedAnswer: { kind: "free-text", targetField: "after_hours_process" } },
      { id: "first-refusal", title: "Clarify first refusal", goal: "Ask one coverage question, then respect a second no.", script: "Totally fair. Before I go, how are paid online inquiries covered after hours?", responseMode: "compose", maxWords: 25, variables: [] },
      { id: "lead-source", title: "Confirm lead sources", goal: "Establish whether paid online inquiries are relevant.", script: "Which online sources generate most buyer inquiries for you today?", responseMode: "compose", maxWords: 20, variables: [] },
      { id: "confirm-authority", title: "Confirm decision ownership", goal: "Clarify the decision path before a workflow check.", script: "If you found a coverage gap, are you the person who would decide whether to review that workflow?", responseMode: "compose", maxWords: 30, variables: [] },
      { id: "workflow-check", title: "Invite a workflow check", goal: "Offer the approved next step after verified context.", script: "It sounds worth mapping the lead source, ownership, after-hours coverage, and visibility in a short 15-minute workflow check. Would you be open to that?", responseMode: "compose", maxWords: 35, variables: [] },
      { id: "terminal-close", title: "Close the call", goal: "Honor the prospect's terminal decision.", script: "Understood. Thank you.", responseMode: "verbatim", maxWords: 5, variables: [], terminal: true },
      { id: "disqualified-close", title: "Not a fit", goal: "Close without pursuing a meeting.", script: "Understood. Thank you.", responseMode: "verbatim", maxWords: 5, variables: [], terminal: true },
      { id: "abuse-close", title: "End respectfully", goal: "Do not pursue a meeting after abuse.", script: "Understood. Thank you.", responseMode: "verbatim", maxWords: 5, variables: [], terminal: true },
      { id: "hard-integration-close", title: "Integration requirement", goal: "Close when a required direct integration disqualifies the workflow.", script: "Understood. Thank you.", responseMode: "verbatim", maxWords: 5, variables: [], terminal: true },
      { id: "unsupported-fit-close", title: "Unsupported fit", goal: "Close when the lead workflow is unsupported.", script: "Understood. Thank you.", responseMode: "verbatim", maxWords: 5, variables: [], terminal: true },
      { id: "second-no-close", title: "Respect second refusal", goal: "End after the second substantive refusal.", script: "Understood. Thank you.", responseMode: "verbatim", maxWords: 5, variables: [], terminal: true },
    ],
    discovery: [
      { id: "lead-source", guidance: lotLiftPlaybookSection("Discovery sequence") },
      { id: "qualification", guidance: lotLiftPlaybookSection("Qualification rules") },
    ],
    objections: [{ id: "response-model", guidance: lotLiftPlaybookSection("Objection response model") }],
    closeRequirements: [lotLiftPlaybookSection("Close rules")],
    claimConstraints: [lotLiftPlaybookSection("What not to say")],
    runtimePreferences: { modelBehavior: "bounded" },
  },
};

registerSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE);
