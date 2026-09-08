import { expect, it } from "vitest";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../../../sales-profiles/lotlift/profile";

it("ships only the approved question-only LotLift profile", () => {
  expect(LOTLIFT_COLD_OUTBOUND_PROFILE).toMatchObject({
    id: "lotlift-cold-outbound",
    businessId: "lotlift",
    responsePolicy: { allowCitedProductFacts: false, allowDeterministicFallback: true },
    productFactEntries: [],
  });
});
