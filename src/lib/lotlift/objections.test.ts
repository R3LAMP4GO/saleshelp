import { describe, expect, it } from "vitest";
import { DO_NOT_CONTACT_RESPONSE, isDoNotContactRequest } from "./dnc";
import { LOTLIFT_OBJECTION_TACTICS, retrieveApprovedLotLiftResponse } from "./objections";
import { parseLotLiftPlaybook } from "./playbook";

describe("LotLift approved objection retrieval", () => {
  it("returns the approved price response without an LLM", () => {
    expect(retrieveApprovedLotLiftResponse("This is too much money for us right now.")).toMatchObject({
      id: "price",
      rule_id: "objection:no-budget",
      response: "“I hear you. Is the concern the monthly spend itself, the setup effort, another option, or whether closing the gap feels worth it?”",
    });
  });

  it.each([
    ["Send me an email.", "send-information"],
    ["Call me another time.", "call-later"],
    ["We need to think it over.", "need-to-think"],
    ["I do not have time right now.", "busy"],
    ["We are comparing competitors.", "competitor"],
    ["Perhaps we are not the most interested right now.", "not-interested"],
  ])("retrieves the matching approved policy for %s", (text, id) => {
    expect(retrieveApprovedLotLiftResponse(text)?.id).toBe(id);
  });

  it("maps every route and the spouse-plus-price override to a policy tactic", () => {
    expect(Object.keys(LOTLIFT_OBJECTION_TACTICS)).toEqual(expect.arrayContaining(["not-interested", "source-volume", "data-security", "roi"]));
    expect(retrieveApprovedLotLiftResponse("We need direct CRM integration.")?.tactic_id).toBe("truthful-limitation");
    expect(retrieveApprovedLotLiftResponse("This is too much money.", ["My spouse needs to agree."])?.tactic_id).toBe("decision-criteria");
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
      response: "“I understand another decision-maker needs to weigh in. What will they want to know before they’re comfortable?”",
    });
  });
});
