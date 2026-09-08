import { expect, it } from "vitest";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../../../sales-profiles/lotlift/profile";

it("ships the approved LotLift profile with compiled product facts", () => {
  expect(LOTLIFT_COLD_OUTBOUND_PROFILE).toMatchObject({
    id: "lotlift-cold-outbound",
    businessId: "lotlift",
    responsePolicy: { allowCitedProductFacts: true, allowDeterministicFallback: true },
  });
  expect(LOTLIFT_COLD_OUTBOUND_PROFILE.productFactEntries.map((fact) => fact.id)).toEqual(["approved-inbound-workflow", "lead-ownership"]);
});
