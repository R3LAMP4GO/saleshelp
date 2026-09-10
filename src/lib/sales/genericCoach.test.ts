import { afterEach, expect, it } from "vitest";
import { useStore } from "../store";
import { initGenericQuestionCoach, safeDiscoveryQuestion } from "./genericCoach";

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  useStore.setState({ meetingStatus: "idle", meetingId: null, salesMetadata: null, selfSpeakerKey: null, segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
});

it("offers a safe next question when a prospect says they do not need the product", () => {
  expect(safeDiscoveryQuestion("I just don't think we need it at this time.")).toBe("What would make this worth revisiting?");
});

it("offers only a safe question for a finalized non-self diarized turn", () => {
  useStore.setState({ meetingStatus: "recording", meetingId: "generic", salesMetadata: null, selfSpeakerKey: "mix-1", segments: [], findings: [], findingSolutions: {}, solutionFindingId: null });
  cleanup = initGenericQuestionCoach();
  useStore.setState({ segments: [{ id: "self", source: "mix", speaker: 1, text: "Tell me what you need.", isFinal: true, startMs: 0, endMs: 10 }] });
  expect(useStore.getState().findings).toEqual([]);
  useStore.setState({ segments: [...useStore.getState().segments, { id: "prospect", source: "mix", speaker: 2, text: "This seems expensive.", isFinal: true, startMs: 11, endMs: 20 }] });
  const id = "generic-question-prospect";
  expect(useStore.getState().findings).toMatchObject([{ id, title: "Ask next" }]);
  expect(useStore.getState().findingSolutions[id]?.solution?.replies[0]?.reply).toBe("What range were you hoping to stay within?");
});
