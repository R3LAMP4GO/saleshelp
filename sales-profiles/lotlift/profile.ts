import { lotLiftSalesPilotProfile } from "../../src/lib/lotlift/playbook";
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
};

registerSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE);
