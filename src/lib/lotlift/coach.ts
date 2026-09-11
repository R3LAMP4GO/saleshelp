import { useStore } from "../store";
import type { TimelineEvent, TranscriptSegment } from "../types";
import { LotLiftCallStateManager, newLotLiftCallState, reduceLotLiftCallState, type CallStateEvent, type LotLiftFieldValue } from "./callState";
import { lotLiftDecisionContextChange, lotLiftDecisionContextEvent } from "./decisionContext";
import { DO_NOT_CONTACT_RESPONSE, isDoNotContactRequest } from "./dnc";
import type { ApprovedLotLiftResponse } from "./objections";
import { analyzeLotLiftTurn, extractLotLiftObservations } from "./turnIntelligence";
import { markLotLiftTurn, measureLotLiftHardRule, startLotLiftTurn } from "./latency";
import { setLotLiftLiveStatus } from "./liveStatus";
import { canonicalProspectId, leadMemory } from "../sales/leadMemory";
import { salesRecommendationMetadata } from "../sales/meeting";
import { latestProspectTurn, prospectTurn, roleAwareConversation } from "../sales/speakerRoles";
import { selectLotLiftNextMove } from "./nextMove";
import type { ResolvedSalesProfile } from "../sales/profiles";

type CoachEvent = { response: Omit<ApprovedLotLiftResponse, "tactic_id">; state: CallStateEvent };

function moveResponse(move: ReturnType<typeof selectLotLiftNextMove>) {
  return { id: move.id, title: move.title, consideration: move.goal, response: move.response, provenance: move.source, stage: move.stage };
}

/** Only DNC bypasses the candidate boundary; identity remains an eligible candidate. */
export function classifyLotLiftTurn(segment: TranscriptSegment, ..._legacy: unknown[]): CoachEvent | null {
  if (!isDoNotContactRequest(segment.text)) return null;
  return { response: DO_NOT_CONTACT_RESPONSE, state: { type: "do-not-contact", at: new Date().toISOString(), evidence: { segment_id: segment.id, text: segment.text } } };
}

const defaultCallStates = new LotLiftCallStateManager();

function display(segment: TranscriptSegment, response: { id: string; title: string; consideration: string; response: string; provenance?: string; stage?: string }, critical = false, decisionEvidence?: LotLiftFieldValue<string>): void {
  const store = useStore.getState();
  const provenance = response.provenance ?? "approved-script";
  const finding: TimelineEvent = { id: `lotlift-${segment.id}`, atMs: segment.endMs, side: "them", severity: critical ? "critical" : "warn", source: "eval", evalIds: [`lotlift-${response.id}`], title: decisionEvidence ? "Decision context changed" : response.title, detail: decisionEvidence ? "Clarify what changed, who needs to decide, and what they need to know." : response.consideration, quotes: decisionEvidence?.evidence ? [decisionEvidence.evidence.text, segment.text] : [segment.text], author: "lotlift", lotLiftRecommendation: { moveId: response.id, source: provenance, stage: response.stage ?? "unknown" }, salesMetadata: store.salesMetadata ? salesRecommendationMetadata(store.salesMetadata) : undefined };
  if (!store.findings.some((item) => item.id === finding.id)) store.addFinding(finding);
  store.setFindingSolution(finding.id, { status: "done", error: null, solution: { findingId: finding.id, replies: [{ kind: "reframe", reply: response.response, consideration: response.consideration }] } });
  store.setSolutionFinding(finding.id);
  markLotLiftTurn(segment.id, "visible");
  setLotLiftLiveStatus("Suggestion ready");
}

/** Immediate finalized-prospect path; it deliberately bypasses the full-analysis timer. */
export function initLotLiftCoach(callStates = defaultCallStates, turnAnalyzer = analyzeLotLiftTurn, salesProfileId?: string): () => void {
  let activeCallId: string | null = null;
  let newestProspectSegmentId: string | null = null;
  let localSelectionAbort: AbortController | null = null;
  let sessionProfile: ResolvedSalesProfile | undefined;
  const processed = new Set<string>();
  const unsubscribe = useStore.subscribe((state, previous) => {
    const meetingActive = state.meetingStatus === "recording" || state.meetingStatus === "paused";
    const selectedProfile = !salesProfileId || state.salesMetadata?.salesProfileId === salesProfileId;
    // Legacy callers retain their historic LotLift key; profile-selected calls use the UUID unchanged.
    const callId = meetingActive && state.meetingId && selectedProfile ? salesProfileId ? state.meetingId : `lotlift-${state.meetingId}` : null;
    if (activeCallId && activeCallId !== callId) { localSelectionAbort?.abort(); localSelectionAbort = null; void callStates.retire(activeCallId); activeCallId = null; newestProspectSegmentId = null; sessionProfile = undefined; processed.clear(); }
    if (!callId) return;
    if (activeCallId !== callId) sessionProfile = state.salesMetadata?.resolvedProfile;
    activeCallId = callId;
    callStates.activate(callId);
    const speakerChanged = state.selfSpeakerKey !== previous.selfSpeakerKey;
    const rawSegment = speakerChanged ? latestProspectTurn(state.segments, state.selfSpeakerKey) : state.segments[state.segments.length - 1];
    if (!rawSegment || (!speakerChanged && rawSegment === previous.segments[previous.segments.length - 1]) || processed.has(rawSegment.id)) return;
    const segment = prospectTurn(rawSegment, state.selfSpeakerKey);
    // A selected LotLift sales profile owns SalesPilot activation; evaluations are unrelated meeting analysis.
    if (!segment || callStates.isDoNotContact(callId)) return;
    processed.add(segment.id);
    localSelectionAbort?.abort();
    localSelectionAbort = null;
    startLotLiftTurn(segment.id);
    setLotLiftLiveStatus("Thinking");
    newestProspectSegmentId = segment.id;
    const conversation = roleAwareConversation(state.segments, state.selfSpeakerKey);
    const newProspectSegments = (speakerChanged ? state.segments : state.segments
      .filter((item) => !previous.segments.some((previousItem) => previousItem.id === item.id)))
      .map((item) => prospectTurn(item, state.selfSpeakerKey))
      .filter((item): item is TranscriptSegment => item !== null);
    const decisionEvents = newProspectSegments.map(lotLiftDecisionContextEvent).filter((event): event is CallStateEvent => event !== null);
    const currentDecisionEvent = lotLiftDecisionContextEvent(segment);
    const decisionState = decisionEvents.reduce(reduceLotLiftCallState, callStates.stateFor(callId) ?? newLotLiftCallState(callId));
    const decisionEvidence = lotLiftDecisionContextChange(decisionState, currentDecisionEvent);
    const hardRuleStartedAt = performance.now();
    const deterministic = classifyLotLiftTurn(segment, decisionState, state.settings.userName, conversation);
    measureLotLiftHardRule(segment.id, hardRuleStartedAt);
    markLotLiftTurn(segment.id, "playbook");
    if (deterministic?.response.id === "do-not-call") {
      const prospectId = salesProfileId && state.salesMetadata?.businessId ? canonicalProspectId(state.salesMetadata.prospect) : null;
      if (prospectId && state.salesMetadata) leadMemory.recordDoNotContact({ businessId: state.salesMetadata.businessId, canonicalProspectId: prospectId, recordedAt: new Date().toISOString() });
      if (callStates.record(callId, segment.id, [...decisionEvents, deterministic.state])) { void callStates.flush(callId).then(() => markLotLiftTurn(segment.id, "persisted")); display(segment, deterministic.response, true); }
      return;
    }
    const fallbackMove = selectLotLiftNextMove({ state: decisionState, turn: segment, conversation, approvedRepIdentity: state.settings.userName, resolvedProfile: sessionProfile });
    const fallbackResponse = moveResponse(fallbackMove);
    if (fallbackMove.source === "terminal-policy") {
      const events = [...decisionEvents, ...fallbackMove.state_events];
      if (events.length && callStates.record(callId, segment.id, events)) void callStates.flush(callId).then(() => markLotLiftTurn(segment.id, "persisted"));
      display(segment, fallbackResponse, false, decisionEvidence ?? undefined);
      return;
    }
    // Do not record the fallback move before the selector runs: it would make this
    // very turn look like a repeated objection. The final selected/fallback move is persisted below.
    const initialEvents = deterministic ? [...decisionEvents, deterministic.state] : [...decisionEvents];
    if (initialEvents.length && callStates.record(callId, segment.id, initialEvents)) void callStates.flush(callId).then(() => markLotLiftTurn(segment.id, "persisted"));
    display(segment, deterministic?.response ?? fallbackResponse, false, decisionEvidence ?? undefined);
    const controller = new AbortController();
    localSelectionAbort = controller;
    void (async () => {
      await callStates.flush(callId);
      if (newestProspectSegmentId !== segment.id) return;
      try {
        markLotLiftTurn(segment.id, "modelStart");
        const result = await turnAnalyzer({ state: callStates.stateFor(callId)!, turn: segment, conversation, relevantRuleIds: deterministic ? [deterministic.response.rule_id] : undefined, settings: state.settings, signal: controller.signal, resolvedProfile: sessionProfile });
        markLotLiftTurn(segment.id, "modelFirstResponse");
        markLotLiftTurn(segment.id, "modelComplete");
        if (newestProspectSegmentId !== segment.id || localSelectionAbort !== controller || result.fallback_reason === "cancelled") return;
        // The safe card was already visible; an async miss is diagnostic-only to the rep.
        if (result.source === "fallback") setLotLiftLiveStatus(result.fallback_reason === "unconfigured" ? "API key missing — fallback used" : "Suggestion ready");
        const finalEvents = result.source === "fallback" ? fallbackMove.state_events : result.state_events;
        if (finalEvents.length && callStates.record(callId, `${segment.id}:model`, finalEvents)) void callStates.flush(callId).then(() => {
          markLotLiftTurn(segment.id, "persisted");
        });
        const deterministicResponse = deterministic?.response ?? fallbackResponse;
        const contextualResponse = result.source === "model" && result.selected_move && result.spoken_response
          ? { ...moveResponse(result.selected_move), response: result.spoken_response, provenance: "model-composed" }
          : result.source === "fallback" && result.selected_move
            ? { ...moveResponse(result.selected_move), provenance: "safe-fallback" }
            : deterministicResponse;
        display(segment, contextualResponse, false, decisionEvidence ?? undefined);
        // Memory is deliberately best-effort and cannot delay or replace Say This Now.
        void extractLotLiftObservations({ settings: state.settings, state: callStates.stateFor(callId)!, turn: segment, conversation, signal: controller.signal }).then((events) => {
          if (!events.length || controller.signal.aborted || newestProspectSegmentId !== segment.id) return;
          if (callStates.record(callId, `${segment.id}:memory`, events)) void callStates.flush(callId).then(() => markLotLiftTurn(segment.id, "persisted"));
        });
      } catch {
        if (controller.signal.aborted || newestProspectSegmentId !== segment.id || localSelectionAbort !== controller) return;
        setLotLiftLiveStatus("Local model unavailable");
        display(segment, { ...(deterministic?.response ?? fallbackResponse), provenance: "safe-fallback" }, false, decisionEvidence ?? undefined);
      } finally {
        if (localSelectionAbort === controller) localSelectionAbort = null;
      }
    })();
  });
  return () => {
    localSelectionAbort?.abort();
    localSelectionAbort = null;
    unsubscribe();
  };
}
