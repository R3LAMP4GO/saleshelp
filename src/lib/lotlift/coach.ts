import { useStore } from "../store";
import type { TimelineEvent, TranscriptSegment } from "../types";
import { LotLiftCallStateManager, type CallStateEvent } from "./callState";
import { retrieveApprovedLotLiftResponse, type ApprovedLotLiftResponse } from "./objections";

type CoachEvent = { response: ApprovedLotLiftResponse; state: CallStateEvent };

export function classifyLotLiftTurn(segment: TranscriptSegment, priorProspectLines: readonly string[] = []): CoachEvent | null {
  const response = retrieveApprovedLotLiftResponse(segment.text, priorProspectLines);
  if (!response) return null;
  return {
    response,
    state: {
      type: "objection",
      kind: response.id,
      evidence: { segment_id: segment.id, text: segment.text },
    },
  };
}

const defaultCallStates = new LotLiftCallStateManager();

/** Attach one deterministic, no-network reply path to finalized prospect turns. */
export function initLotLiftCoach(callStates = defaultCallStates): () => void {
  let activeCallId: string | null = null;
  const unsubscribe = useStore.subscribe((state, previous) => {
    const meetingActive = state.meetingStatus === "recording" || state.meetingStatus === "paused";
    const callId = meetingActive && state.meetingId ? `lotlift-${state.meetingId}` : null;
    if (activeCallId && activeCallId !== callId) {
      void callStates.retire(activeCallId);
      activeCallId = null;
    }
    if (!callId) return;
    activeCallId = callId;
    callStates.activate(callId);

    const segment = state.segments[state.segments.length - 1];
    const previousSegment = previous.segments[previous.segments.length - 1];
    if (!segment || segment === previousSegment || !segment.isFinal || segment.source !== "them") return;
    if (!state.settings.evaluations.some((evaluation) => evaluation.id.startsWith("lotlift-"))) return;
    const event = classifyLotLiftTurn(
      segment,
      state.segments.filter((item) => item.id !== segment.id && item.source === "them").map((item) => item.text),
    );
    if (!event || !callStates.record(callId, segment.id, event.state)) return;

    const finding: TimelineEvent = {
      id: `lotlift-${segment.id}`,
      atMs: segment.endMs,
      side: "them",
      severity: event.response.id === "do-not-call" ? "critical" : "warn",
      source: "eval",
      evalIds: [`lotlift-${event.response.id}`],
      title: event.response.title,
      detail: event.response.consideration,
      quotes: [segment.text],
      author: "lotlift",
    };
    const store = useStore.getState();
    store.addFinding(finding);
    store.setFindingSolution(finding.id, {
      status: "done",
      error: null,
      solution: {
        findingId: finding.id,
        replies: [{ kind: "reframe", reply: event.response.response, consideration: event.response.consideration }],
      },
    });
    store.setSolutionFinding(finding.id);
  });
  return unsubscribe;
}
