import { useStore } from "../store";
import type { TimelineEvent } from "../types";
import { latestProspectTurn, prospectTurn } from "./speakerRoles";

/** Generic mode never makes product claims; it only offers a safe discovery question. */
export function safeDiscoveryQuestion(text: string): string {
  const turn = text.toLowerCase();
  if (/price|cost|budget|expensive|afford/.test(turn)) return "What range were you hoping to stay within?";
  if (/timing|later|busy|not now/.test(turn)) return "What would need to happen for the timing to work?";
  if (/not interested|already use|happy with|(?:don't|do not) think (?:we )?need/.test(turn)) return "What would make this worth revisiting?";
  return "What matters most as you consider the next step?";
}

/** Offers a copy-ready question for mixed-audio calls without a selected sales playbook. */
export function initGenericQuestionCoach(): () => void {
  let activeMeetingId: string | null = null;
  const processed = new Set<string>();
  return useStore.subscribe((state, previous) => {
    const meetingId = state.meetingStatus === "recording" || state.meetingStatus === "paused" ? state.meetingId : null;
    if (meetingId !== activeMeetingId) {
      activeMeetingId = meetingId;
      processed.clear();
    }
    if (!meetingId || state.salesMetadata) return;
    const speakerChanged = state.selfSpeakerKey !== previous.selfSpeakerKey;
    const rawTurn = speakerChanged ? latestProspectTurn(state.segments, state.selfSpeakerKey) : state.segments[state.segments.length - 1];
    if (!rawTurn || (!speakerChanged && rawTurn === previous.segments[previous.segments.length - 1]) || processed.has(rawTurn.id)) return;
    const turn = prospectTurn(rawTurn, state.selfSpeakerKey);
    if (!turn) return;
    processed.add(turn.id);
    const id = `generic-question-${turn.id}`;
    const finding: TimelineEvent = {
      id,
      atMs: turn.endMs,
      side: "them",
      severity: "info",
      source: "extra",
      title: "Ask next",
      detail: "A safe discovery question for this turn.",
      quotes: [turn.text],
      author: "generic-coach",
    };
    state.addFinding(finding);
    state.setFindingSolution(id, {
      status: "done",
      error: null,
      solution: { findingId: id, replies: [{ kind: "reframe", reply: safeDiscoveryQuestion(turn.text), consideration: "Clarify their priorities without making product claims." }] },
    });
    state.setSolutionFinding(id);
  });
}
