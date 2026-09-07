import { useStore } from "../store";
import type { TimelineEvent, TranscriptSegment } from "../types";
import { newLotLiftCallState, persistLotLiftCallState, reduceLotLiftCallState, type CallStateEvent, type LotLiftCallState } from "./callState";
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

let lastSegmentId = "";
let callState: LotLiftCallState | null = null;

/** Attach one deterministic, no-network reply path to finalized prospect turns. */
export function initLotLiftCoach(): () => void {
  return useStore.subscribe((state, previous) => {
    const segment = state.segments[state.segments.length - 1];
    const previousSegment = previous.segments[previous.segments.length - 1];
    if (!segment || segment === previousSegment || !segment.isFinal || segment.source !== "them" || segment.id === lastSegmentId) return;
    lastSegmentId = segment.id;
    if (!state.settings.evaluations.some((evaluation) => evaluation.id.startsWith("lotlift-"))) return;
    const event = classifyLotLiftTurn(segment, state.segments.filter((item) => item.id !== segment.id && item.source === "them").map((item) => item.text));
    if (!event) return;

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

    const callId = `meeting-${state.meetingStartedAt ?? Date.now()}`;
    callState = reduceLotLiftCallState(callState ?? newLotLiftCallState(callId), event.state);
    void persistLotLiftCallState(callState).then((saved) => { callState = saved; }).catch(() => {
      // Coaching remains available if storage is temporarily unavailable; no state is silently claimed saved.
    });
  });
}
