import { expect, it } from "vitest";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../../../sales-profiles/lotlift/profile";
import { resolveSalesProfile } from "../sales/profiles";
import { newLotLiftCallState, reduceLotLiftCallState } from "./callState";
import { buildLotLiftMethodologyContext } from "./methodologyContext";
import { selectLotLiftNextMove } from "./nextMove";
import { isDoNotContactRequest } from "./dnc";

const profile = resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE);
const prospect = (id: string, text: string) => ({ id, text, source: "them" as const, speaker: 0, isFinal: true, startMs: 0, endMs: 1 });
const select = (state: ReturnType<typeof newLotLiftCallState>, text: string) => selectLotLiftNextMove({ state, turn: prospect(`p-${state.revision}`, text), conversation: [prospect(`p-${state.revision}`, text)], approvedRepIdentity: "Avery Test", resolvedProfile: profile });

it("preserves policy routes across the methodology behavioral cases", () => {
  expect(select(newLotLiftCallState("not-interested"), "No thanks, I'm not interested.")).toMatchObject({ id: "first-refusal" });
  expect(select(newLotLiftCallState("send-info"), "Just send me some information.")).toMatchObject({ id: "information-topic", rule_ids: ["objection:send-information"], source: "approved-move" });

  let priceState = newLotLiftCallState("price-after-pain");
  priceState = select(priceState, "Our late internet leads sit until morning.").state_events.reduce(reduceLotLiftCallState, priceState);
  expect(select(priceState, "This sounds too expensive.")).toMatchObject({ id: "price-isolation", tactic_id: "concern-isolation", rule_ids: ["objection:no-budget"] });

  expect(select(newLotLiftCallState("novel"), "I worry the staff will think this is spying.")).toMatchObject({ id: "guided-objection-discovery", source: "approved-move" });

  let refusalState = newLotLiftCallState("second-no");
  refusalState = select(refusalState, "No thanks, not interested.").state_events.reduce(reduceLotLiftCallState, refusalState);
  expect(select(refusalState, "No, really, we're not interested.")).toMatchObject({ id: "second-no-close", source: "terminal-policy" });

  expect(isDoNotContactRequest("Do not call me again.")).toBe(true);
});

it("falls back to profile-only behavior when source indexes are unavailable", () => {
  const state = newLotLiftCallState("missing-sources");
  const turn = prospect("missing", "I worry the staff will dislike this.");
  const candidates = [select(state, turn.text)];
  const methodology = buildLotLiftMethodologyContext({ state, turn, candidates, resolvedProfile: profile, knowledge: { references: [], indexes: [] } });
  expect(methodology).toMatchObject({ frameworks: [], support: [], sourceRefs: [], sourceCount: 0, chunkCount: 0 });
  expect(methodology.profileGuidance).toContain("Earn a **15-minute Lead Response Workflow Check**");
});
