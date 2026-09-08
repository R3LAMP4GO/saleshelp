import { describe, expect, it } from "vitest";
import { newLotLiftCallState } from "./callState";
import { LOTLIFT_SCRIPT_CARDS, renderLotLiftScriptCard, selectLotLiftScriptCard } from "./scriptCards";

const turn = (text: string) => ({
  id: text,
  source: "them" as const,
  speaker: 0,
  isFinal: true,
  startMs: 0,
  endMs: 1,
  text,
});

describe("LotLift executable script cards", () => {
  it.each([
    ["What is this regarding?", "G1"],
    ["We already have a CRM for this.", "C1"],
    ["We already use another vendor for this.", "C3"],
    ["I do not want another tool because it costs too much.", "P2"],
  ])("selects the one approved card for %s", (text, cardId) => {
    expect(selectLotLiftScriptCard(turn(text), newLotLiftCallState("call"))?.id).toBe(cardId);
  });

  it("preserves the exact approved rep and follow-up text", () => {
    expect(Object.fromEntries(LOTLIFT_SCRIPT_CARDS.map((card) => [card.id, [card.exact_rep_sentence, card.follow_up_sentence]]))).toEqual({
      G1: ["“It’s about how the dealership covers paid online inquiries from marketplace listings. Could you let [process owner name] know [configured rep name] from LotLift called?”", "“Is [process owner name] the owner of that process, or is there an internet-sales or sales manager I should speak with?”"],
      D1: ["“Fair enough. Most stores would not be looking for another tool. Before I close this out, is that because marketplace inquiries are already consistently covered there, or because that just is not a priority right now?”", "“What would have to happen for lead-response coverage to become worth revisiting?”"],
      D3: ["“That may mean LotLift is not worth adding. Roughly how many paid online inquiries do you get in a normal month?”", "“Which online sources generate most buyer inquiries, if any?”"],
      C1: ["“That makes sense. I would expect you to. When an online inquiry arrives, does it land directly in that workflow and get owned immediately, or is there still an inbox and handoff before it is worked?”", "“Sounds like you have it buttoned up. LotLift probably is not useful there.”"],
      C3: ["“Got it. What made you choose them, and what does that process handle well for you?”", "“Is there anything the team still has to do manually around lead routing, after-hours response, or appointments?”"],
      P2: ["“I can see why you would want to be careful about another tool. When you say expensive, is the issue the monthly number itself, the setup effort, comparison with another option, or that the return is not clear enough?”", "“So the real concern is [repeat it]. If we could address that through [a supported scope, success measure, or plan], would anything else stop you from moving forward?”"],
      N1: ["“Understood. I’ll leave it there. Thanks for your time.”", "None — end the call immediately."],
      N2: ["“Good—if it is working, you should keep it. What are you using today to make sure paid online inquiries do not sit unworked?”", "“Would it be useful to talk through after-hours and ownership, or are you comfortable leaving it as-is?”"],
    });
  });

  it("interpolates only configured identity and verified Call State facts", () => {
    const state = {
      ...newLotLiftCallState("call"),
      stakeholders: [{ value: "Morgan", status: "verified" as const, evidence: { segment_id: "owner", text: "Morgan owns this process." } }],
    };
    const gatekeeper = LOTLIFT_SCRIPT_CARDS.find((card) => card.id === "G1")!;
    expect(renderLotLiftScriptCard(gatekeeper, state, "Isaiah")).toBe("“It’s about how the dealership covers paid online inquiries from marketplace listings. Could you let Morgan know Isaiah from LotLift called?”");
  });

  it("suppresses missing variables and never displays brackets", () => {
    const gatekeeper = LOTLIFT_SCRIPT_CARDS.find((card) => card.id === "G1")!;
    const price = LOTLIFT_SCRIPT_CARDS.find((card) => card.id === "P2")!;
    expect(renderLotLiftScriptCard(gatekeeper, newLotLiftCallState("call"), "Isaiah")).toBeNull();
    expect(renderLotLiftScriptCard(gatekeeper, newLotLiftCallState("call"), "")).toBeNull();
    expect(renderLotLiftScriptCard(price, newLotLiftCallState("call"), "")).toBe(price.exact_rep_sentence);
    expect(renderLotLiftScriptCard(price, newLotLiftCallState("call"), "")?.includes("[")).toBe(false);
  });

  it("uses durable readiness evidence before recognizing a spouse decision-context change", () => {
    const state = {
      ...newLotLiftCallState("call"),
      stated_readiness: {
        value: "ready to proceed",
        status: "verified" as const,
        evidence: { segment_id: "ready", text: "Nothing is stopping me from moving forward." },
      },
    };
    expect(selectLotLiftScriptCard(turn("I need to talk to my wife."), state)).toBeNull();
  });

  it.each([
    "Would Tuesday morning or Thursday afternoon work for 15 minutes?",
    "I need to talk to my partner first.",
    "Please take me off your list.",
  ])("refuses owner-blocked or do-not-contact script %s", (text) => {
    expect(selectLotLiftScriptCard(turn(text), newLotLiftCallState("call"))).toBeNull();
  });
});
