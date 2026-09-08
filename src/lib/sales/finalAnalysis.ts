import type { Settings, TranscriptSegment } from "../types";
import { finalizeLotLiftCall, type LotLiftFinalCallAnalysis } from "../lotlift/finalAnalysis";
import type { SalesMeetingMetadata } from "./meeting";
import { resolveApprovedSalesProfile } from "./policy";

export type SalesFinalAnalysis = LotLiftFinalCallAnalysis | null;

/** Profile-routed final analysis. Legacy callers keep using their historical LotLift entry point. */
export async function finalizeSalesCall(meetingId: string, metadata: SalesMeetingMetadata | null | undefined, transcript: readonly TranscriptSegment[], settings?: Settings): Promise<SalesFinalAnalysis> {
  const profile = resolveApprovedSalesProfile(metadata);
  if (!profile) return null;
  if (profile.id === "lotlift-cold-outbound") return finalizeLotLiftCall(meetingId, transcript, settings);
  return null;
}
