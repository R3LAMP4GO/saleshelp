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
    ["Send me an email.", "S1"],
    ["Call me another time.", "L1"],
    ["We need to think it over.", "T1"],
    ["I do not have time right now.", "B1"],
    ["We are comparing competitors.", "V1"],
    ["Do you integrate with our CRM?", "I1"],
  ])("selects the one approved card for %s", (text, cardId) => {
    expect(selectLotLiftScriptCard(turn(text), newLotLiftCallState("call"))?.id).toBe(cardId);
  });

  it.each([
    "Perhaps at this moment we're not the most interested right now.",
    "We're not really interested at the moment.",
    "This is not a priority right now.",
    "I don't know. I just don't think we need it at this time.",
  ])("routes a soft refusal to the approved first-refusal card: %s", (text) => {
    expect(selectLotLiftScriptCard(turn(text), newLotLiftCallState("call"))?.id).toBe("D1");
  });

  it("uses prior refusal context to end a second soft refusal professionally", () => {
    const state = {
      ...newLotLiftCallState("call"),
      recurring_objections: [{ value: "D1", count: 1, status: "inferred" as const, evidence: { segment_id: "first-no", text: "We're not interested." }, resolved: false }],
    };
    expect(selectLotLiftScriptCard(turn("We're not the most interested right now."), state)?.id).toBe("N1");
  });

  it("preserves the exact approved rep and follow-up text", () => {
    expect(Object.fromEntries(LOTLIFT_SCRIPT_CARDS.map((card) => [card.id, [card.exact_rep_sentence, card.follow_up_sentence]]))).toEqual({
      G1: ["“It’s about how the dealership covers paid online inquiries from marketplace listings. Could you let [process owner name] know [configured rep name] from LotLift called?”", "“Is [process owner name] the owner of that process, or is there an internet-sales or sales manager I should speak with?”"],
      D1: ["“Fair enough. Most stores wouldn’t be looking for another tool. Before I close this out, is that because marketplace inquiries are already consistently covered there, or because that just isn’t a priority right now?”", "“What would have to happen for lead-response coverage to become worth revisiting?”"],
      D3: ["“That may mean LotLift is not worth adding. Roughly how many paid online inquiries do you get in a normal month?”", "“Which online sources generate most buyer inquiries, if any?”"],
      C1: ["“That makes sense. I’d expect you to. When an online inquiry comes in, does it go straight into that workflow and get picked up right away, or is there still an inbox or handoff first?”", "“Sounds like you have it buttoned up. LotLift probably is not useful there.”"],
      C3: ["“Got it. What made you choose them, and what does that process handle well for you?”", "“Is there anything the team still has to do manually around lead routing, after-hours response, or appointments?”"],
      P2: ["“I hear you. For the first 50 customers, the basic plan is $20 and everything included is $24.99. Is the concern the price itself, the setup effort, another option, or whether the value is clear?”", "“So the real concern is [repeat it]. If we could address that through [a supported scope, success measure, or plan], would anything else stop you from moving forward?”"],
      S1: ["“Happy to. So I don’t send generic software material, what are you most trying to understand: how it works with your current process, supported lead sources, security, or pricing?”", "“After you look at that, would it make sense to spend 15 minutes and decide whether it is relevant?”"],
      L1: ["“Happy to. What’s changing later that would make this a better conversation?”", "“Would Tuesday at 10:30 or Thursday at 2:00 be less disruptive?”"],
      T1: ["“That’s fair. What’s the biggest thing you want to feel certain about before deciding?”", "“Other than that concern, is anything else keeping you from a yes?”"],
      B1: ["“That’s exactly why I don’t want to pitch you in the middle of it. Is there a calmer 15-minute window this week to map the workflow, or should I close this out for now?”", "None — respect the chosen time or close the call."],
      V1: ["“That makes sense. What are you using to compare the options?”", "“Where do you see LotLift as stronger or weaker right now?”"],
      I1: ["“Today, LotLift isn’t a CRM or DMS integration. It works around approved inbox lead flows and appointment workflow. Is direct CRM/DMS integration a hard requirement, or are you trying to solve a specific handoff issue?”", "If direct integration is required, I should not pretend this is the right fit."],
      N1: ["“Understood. I’ll leave it there. Thanks for your time.”", "None — end the call immediately."],
      N2: ["“Good, if it’s working, you should keep it. What are you using today to make sure paid online inquiries don’t sit unworked?”", "“Would it be useful to talk through after-hours and ownership, or are you comfortable leaving it as-is?”"],
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
