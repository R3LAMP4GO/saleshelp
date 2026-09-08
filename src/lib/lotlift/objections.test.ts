import { describe, expect, it } from "vitest";
import { DO_NOT_CONTACT_RESPONSE, isDoNotContactRequest } from "./dnc";
import { retrieveApprovedLotLiftResponse } from "./objections";
import { parseLotLiftPlaybook } from "./playbook";

describe("LotLift approved objection retrieval", () => {
  it("returns the approved price response without an LLM", () => {
    expect(retrieveApprovedLotLiftResponse("This is too much money for us right now.")).toMatchObject({
      id: "price",
      rule_id: "objection:no-budget",
      response: "“Is the concern the monthly number, setup effort, comparison with another option, or that the return is not clear enough?”",
    });
  });

  it("detects direct DNC requests and returns the fixed acknowledgement", () => {
    expect(isDoNotContactRequest("Don't call again.")).toBe(true);
    expect(DO_NOT_CONTACT_RESPONSE.response).toBe("Absolutely. I’ll mark this number do-not-call. Thanks for letting me know.");
  });

  it("keeps DNC acknowledgement available when structured policy is malformed", () => {
    expect(() => parseLotLiftPlaybook("# malformed")).toThrow();
    expect(DO_NOT_CONTACT_RESPONSE.response).toBe("Absolutely. I’ll mark this number do-not-call. Thanks for letting me know.");
  });

  it("detects alternate DNC wording before sales-context retrieval", () => {
    for (const text of ["Do not call.", "Remove us.", "Take us off your list.", "Stop calling."]) {
      expect(isDoNotContactRequest(text)).toBe(true);
    }
    expect(retrieveApprovedLotLiftResponse("Please take us off your list; we already have a CRM.")?.id).toBe("existing-solution");
  });

  it("keeps spouse context when a later price objection arrives", () => {
    const response = retrieveApprovedLotLiftResponse(
      "This is too much money for us.",
      ["I need to talk to my wife before we decide."],
    );
    expect(response).toMatchObject({
      id: "price-with-spouse",
      rule_id: "objection:spouse-partner",
      response: "“What will they want to know before they are comfortable?”",
    });
  });
});
