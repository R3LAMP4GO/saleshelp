import { describe, expect, it } from "vitest";
import { newLotLiftCallState, reduceLotLiftCallState } from "./callState";
import { analyzeLotLiftTurn } from "./turnIntelligence";
import type { TranscriptSegment } from "../types";

const turn = (text: string): TranscriptSegment => ({ id: "turn", text, source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 100 });

describe("LotLift hard policy precedes local selection", () => {
  it.each([
    ["Do not call again.", "do_not_contact"],
    ["Direct CRM integration is required.", "response"],
    ["We do not use AutoTrader or online inquiries.", "response"],
  ])("keeps %s outside model authority", async (text, event_type) => {
    const prospect = turn(text);
    const model = async () => { throw new Error("model must not run"); };
    const result = await analyzeLotLiftTurn({ state: newLotLiftCallState("hard"), turn: prospect, conversation: [prospect], model });
    expect(result.event_type).toBe(event_type);
    expect(result.source).toBe("hard-rule");
  });

  it("closes a second substantive refusal without asking the local model", async () => {
    const prospect = turn("No thanks, not interested.");
    const state = reduceLotLiftCallState(newLotLiftCallState("second"), { type: "coaching-progress", move_id: "first-no", substantive_refusal: true });
    const result = await analyzeLotLiftTurn({ state, turn: prospect, conversation: [prospect], model: async () => { throw new Error("model must not run"); } });
    expect(result).toMatchObject({ source: "hard-rule", move_id: "second-no-close" });
  });
});
