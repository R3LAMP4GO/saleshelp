import { useStore } from "../store";
import type { TimelineEvent, TranscriptSegment } from "../types";
import { DO_NOT_CONTACT_RESPONSE, isDoNotContactRequest } from "../lotlift/dnc";
import { canonicalProspectId, leadMemory } from "./leadMemory";
import { salesRecommendationMetadata } from "./meeting";
import { analyzeSalesPilotTurn } from "./pilotCoach";
import type { SalesPilotProfile } from "./salesPilot";
import { lotLiftSalesPilotProfile } from "../lotlift/playbook";
import { setSalesPilotLiveStatus } from "./liveStatus";

function selectedPolicy(): SalesPilotProfile | null {
  const metadata = useStore.getState().salesMetadata;
  if (!metadata) return null;
  if (metadata.customProfile) return metadata.customProfile.compiledProfile ?? null;
  return metadata.salesProfileId === "lotlift-cold-outbound" ? lotLiftSalesPilotProfile : null;
}

function acceptedNextStage(profile: SalesPilotProfile, currentStage: string, result: { current_stage: string; next_stage: string }): string | null {
  const currentIndex = profile.stages.findIndex((stage) => stage.id === currentStage);
  if (currentIndex < 0 || result.current_stage !== currentStage) return null;
  return [currentStage, profile.stages[currentIndex + 1]?.id].includes(result.next_stage) ? result.next_stage : null;
}

function display(segment: TranscriptSegment, profile: SalesPilotProfile, stage: string, say: string, critical = false): void {
  const store = useStore.getState();
  const id = `sales-pilot-${segment.id}`;
  if (store.findings.some((finding) => finding.id === id)) return;
  const finding: TimelineEvent = {
    id,
    atMs: segment.endMs,
    side: "them",
    severity: critical ? "critical" : "warn",
    source: "eval",
    evalIds: ["sales-pilot"],
    title: profile.title,
    detail: `Stage: ${stage.replace(/-/g, " ")}`,
    quotes: [segment.text],
    author: "sales-pilot",
    salesMetadata: store.salesMetadata ? salesRecommendationMetadata(store.salesMetadata) : undefined,
  };
  store.addFinding(finding);
  store.setFindingSolution(id, { status: "done", error: null, solution: { findingId: id, replies: [{ kind: "reframe", reply: say, consideration: profile.objective }] } });
  store.setSolutionFinding(id);
}

/** One finalized-prospect subscription for every compiled sales profile. */
export function initSalesPilotCoach(turnAnalyzer = analyzeSalesPilotTurn): () => void {
  let activeMeetingId: string | null = null;
  let newestSegmentId: string | null = null;
  const processed = new Set<string>();
  const doNotContactMeetings = new Set<string>();
  const stages = new Map<string, string>();
  return useStore.subscribe((state, previous) => {
    const meetingId = (state.meetingStatus === "recording" || state.meetingStatus === "paused") ? state.meetingId : null;
    if (activeMeetingId !== meetingId) { activeMeetingId = meetingId; newestSegmentId = null; processed.clear(); stages.clear(); if (meetingId) doNotContactMeetings.delete(meetingId); else setSalesPilotLiveStatus(null); }
    const policy = selectedPolicy();
    const segment = state.segments[state.segments.length - 1];
    if (!meetingId || !policy || doNotContactMeetings.has(meetingId) || !segment || segment === previous.segments[previous.segments.length - 1] || !segment.isFinal || segment.source !== "them" || processed.has(segment.id)) return;
    processed.add(segment.id);
    newestSegmentId = segment.id;
    const profileScope = `${meetingId}:${state.salesMetadata?.salesProfileId ?? policy.title}`;
    const currentStage = stages.get(profileScope) ?? policy.stages[0]!.id;
    stages.set(profileScope, currentStage);
    setSalesPilotLiveStatus({ profile: policy.title, stage: currentStage, label: "Thinking" });
    if (isDoNotContactRequest(segment.text)) {
      doNotContactMeetings.add(meetingId);
      const metadata = state.salesMetadata;
      const prospectId = metadata ? canonicalProspectId(metadata.prospect) : null;
      if (metadata && prospectId) leadMemory.recordDoNotContact({ businessId: metadata.businessId, canonicalProspectId: prospectId, recordedAt: new Date().toISOString() });
      display(segment, policy, currentStage, DO_NOT_CONTACT_RESPONSE.response, true);
      setSalesPilotLiveStatus({ profile: policy.title, stage: currentStage, label: "Do-not-contact recorded" });
      return;
    }
    const conversation = state.segments.filter((item) => item.isFinal);
    void turnAnalyzer({ profile: policy, currentStage, turn: segment, conversation, settings: state.settings }).then((result) => {
      if (newestSegmentId !== segment.id) return;
      const nextStage = acceptedNextStage(policy, currentStage, result);
      if (!nextStage) {
        setSalesPilotLiveStatus({ profile: policy.title, stage: currentStage, label: "No intervention needed" });
        return;
      }
      stages.set(profileScope, nextStage);
      setSalesPilotLiveStatus({ profile: policy.title, stage: nextStage, label: result.needs_coaching && result.say ? "Suggestion ready" : "No intervention needed" });
      if (!result.needs_coaching || !result.say) return;
      display(segment, policy, nextStage, result.say);
    });
  });
}
