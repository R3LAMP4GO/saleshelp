import { speakerKey } from "../store";
import type { TranscriptSegment } from "../types";

/** Returns a finalized prospect turn, including a diarized mixed-audio speaker once identified. */
export function prospectTurn(segment: TranscriptSegment, selfSpeakerKey: string | null): TranscriptSegment | null {
  if (!segment.isFinal || !segment.text.trim()) return null;
  if (segment.source === "them") return segment;
  if (segment.source !== "mix" || !selfSpeakerKey || speakerKey(segment) === selfSpeakerKey) return null;
  return { ...segment, source: "them" };
}

/** Normalizes mixed diarization to the user-selected me/them roles for coaching context. */
export function latestProspectTurn(segments: readonly TranscriptSegment[], selfSpeakerKey: string | null): TranscriptSegment | null {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const turn = prospectTurn(segments[index]!, selfSpeakerKey);
    if (turn) return turn;
  }
  return null;
}

export function roleAwareConversation(segments: readonly TranscriptSegment[], selfSpeakerKey: string | null): TranscriptSegment[] {
  return segments.filter((segment) => segment.isFinal).map((segment) => {
    if (segment.source !== "mix" || !selfSpeakerKey) return segment;
    return { ...segment, source: speakerKey(segment) === selfSpeakerKey ? "me" : "them" };
  });
}
