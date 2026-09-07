import { describe, expect, it } from "vitest";
import { retrieveApprovedLotLiftResponse } from "./objections";

describe("LotLift approved objection retrieval", () => {
  it("returns the approved price response without an LLM", () => {
    expect(retrieveApprovedLotLiftResponse("This is too much money for us right now.")).toMatchObject({
      id: "price",
      response: "That’s fair. Is the concern the monthly number, setup effort, comparison with another option, or that the return is not clear enough?",
    });
  });

  it("prioritizes a do-not-call request over every sales response", () => {
    expect(retrieveApprovedLotLiftResponse("Please take us off your list; we already have a CRM.")).toMatchObject({
      id: "do-not-call",
      response: "Absolutely. I’ll mark this number do-not-call. Thanks for letting me know.",
    });
  });

  it("keeps spouse context when a later price objection arrives", () => {
    const response = retrieveApprovedLotLiftResponse(
      "This is too much money for us.",
      ["I need to talk to my wife before we decide."],
    );
    expect(response).toMatchObject({
      id: "price-with-spouse",
      response: "That makes sense. When you talk with your wife, is the concern the monthly number, setup effort, comparison with another option, or that the return is not clear enough?",
    });
  });
});
