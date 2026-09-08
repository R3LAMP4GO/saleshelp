import { describe, expect, it } from "vitest";
import { newLotLiftCallState, reduceLotLiftCallState } from "./callState";
import { lotLiftDecisionContextChange, lotLiftDecisionContextEvent } from "./decisionContext";

const prospect = (id: string, text: string) => ({
  id,
  source: "them" as const,
  speaker: 0,
  isFinal: true,
  startMs: 0,
  endMs: 1,
  text,
});

describe("LotLift durable decision context", () => {
  it("retains explicit readiness across nine later turns", () => {
    const readiness = prospect("ready", "Nothing is stopping me from moving forward.");
    const readinessEvent = lotLiftDecisionContextEvent(readiness);
    expect(readinessEvent).not.toBeNull();

    let state = reduceLotLiftCallState(newLotLiftCallState("call"), readinessEvent!);
    for (let index = 0; index < 9; index += 1) {
      const event = lotLiftDecisionContextEvent(prospect(`later-${index}`, "Okay."));
      expect(event).toBeNull();
    }
    const spouseEvent = lotLiftDecisionContextEvent(prospect("partner", "I need to talk to my partner first."));

    expect(state.stated_readiness.evidence).toEqual({ segment_id: "ready", text: readiness.text });
    expect(lotLiftDecisionContextChange(state, spouseEvent)?.evidence).toEqual(state.stated_readiness.evidence);
  });

  it("requires two explicit verified facts before flagging a spouse or partner", () => {
    const spouseEvent = lotLiftDecisionContextEvent(prospect("wife", "I need to talk to my wife."));
    const empty = newLotLiftCallState("call");
    const inferred = {
      ...empty,
      stated_readiness: {
        value: "ready to proceed",
        status: "inferred" as const,
        evidence: { segment_id: "guess", text: "Nothing is stopping me from moving forward." },
      },
    };

    expect(lotLiftDecisionContextChange(empty, spouseEvent)).toBeNull();
    expect(lotLiftDecisionContextChange(inferred, spouseEvent)).toBeNull();
  });
});
