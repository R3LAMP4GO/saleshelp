import type { CallStateEvent, LotLiftCallState } from "./callState";
import { pendingAnswerFromExecutedMove } from "./pendingAnswer";

export type SimulatorExecutedMove = { id: string; expectedAnswer?: { kind: "confirmation" | "free-text" | "entity"; targetField: string } };

/** Binds only an explicit simulator "I said this" action to a profile move. */
export function simulatorExecutedRepAction(state: LotLiftCallState, profile: { profileId: string; snapshotVersion: string }, repSegmentId: string, move?: SimulatorExecutedMove): CallStateEvent[] {
  if (!move) return [];
  const pending = pendingAnswerFromExecutedMove(profile.profileId, profile.snapshotVersion, repSegmentId, move, state.revision);
  return pending ? [{ type: "pending-answer", pending }] : [];
}
