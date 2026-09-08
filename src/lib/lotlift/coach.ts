import { useStore } from "../store";
import type { TimelineEvent, TranscriptSegment } from "../types";
import { LotLiftCallStateManager, newLotLiftCallState, reduceLotLiftCallState, type CallStateEvent, type LotLiftFieldValue } from "./callState";
import { lotLiftDecisionContextChange, lotLiftDecisionContextEvent } from "./decisionContext";
import { DO_NOT_CONTACT_RESPONSE, isDoNotContactRequest } from "./dnc";
import type { ApprovedLotLiftResponse } from "./objections";
import { renderLotLiftScriptCard, selectLotLiftScriptCard } from "./scriptCards";
import { analyzeLotLiftTurn } from "./turnIntelligence";
import { markLotLiftTurn, measureLotLiftHardRule, startLotLiftTurn } from "./latency";
import { setLotLiftLiveStatus } from "./liveStatus";
import { canonicalProspectId, leadMemory } from "../sales/leadMemory";
import { salesRecommendationMetadata } from "../sales/meeting";

type CoachEvent = { response: ApprovedLotLiftResponse; state: CallStateEvent };

/** Deterministic script-card and DNC path, retained for unavailable or slow local inference. */
export function classifyLotLiftTurn(segment: TranscriptSegment, state: ReturnType<typeof newLotLiftCallState>, approvedRepIdentity: string | null | undefined): CoachEvent | null {
  if (isDoNotContactRequest(segment.text)) return { response: DO_NOT_CONTACT_RESPONSE, state: { type: "do-not-contact", at: new Date().toISOString(), evidence: { segment_id: segment.id, text: segment.text } } };
  const card = selectLotLiftScriptCard(segment, state);
  const response = card && renderLotLiftScriptCard(card, state, approvedRepIdentity);
  if (!card || !response) return null;
  return {
    response: { id: card.id, title: card.trigger, response, consideration: card.objective, rule_id: card.playbook_rule_id },
    state: { type: "recurring-objection", fact: { value: card.id, status: "inferred", evidence: { segment_id: segment.id, text: segment.text } } },
  };
}

const defaultCallStates = new LotLiftCallStateManager();

function display(segment: TranscriptSegment, response: { id: string; title: string; consideration: string; response: string }, critical = false, decisionEvidence?: LotLiftFieldValue<string>): void {
  const store = useStore.getState();
  const finding: TimelineEvent = { id: `lotlift-${segment.id}`, atMs: segment.endMs, side: "them", severity: critical ? "critical" : "warn", source: "eval", evalIds: [`lotlift-${response.id}`], title: decisionEvidence ? "Decision context changed" : response.title, detail: decisionEvidence ? "Clarify what changed, who needs to decide, and what they need to know." : response.consideration, quotes: decisionEvidence?.evidence ? [decisionEvidence.evidence.text, segment.text] : [segment.text], author: "lotlift", salesMetadata: store.salesMetadata ? salesRecommendationMetadata(store.salesMetadata) : undefined };
  if (store.findings.some((item) => item.id === finding.id)) return;
  store.addFinding(finding);
  store.setFindingSolution(finding.id, { status: "done", error: null, solution: { findingId: finding.id, replies: [{ kind: "reframe", reply: response.response, consideration: response.consideration }] } });
  store.setSolutionFinding(finding.id);
  markLotLiftTurn(segment.id, "visible");
  setLotLiftLiveStatus("Suggestion ready");
}

/** Immediate finalized-prospect path; it deliberately bypasses the full-analysis timer. */
export function initLotLiftCoach(callStates = defaultCallStates, turnAnalyzer = analyzeLotLiftTurn, salesProfileId?: string): () => void {
  let activeCallId: string | null = null;
  let newestProspectSegmentId: string | null = null;
  const processed = new Set<string>();
  const unsubscribe = useStore.subscribe((state, previous) => {
    const meetingActive = state.meetingStatus === "recording" || state.meetingStatus === "paused";
    const selectedProfile = !salesProfileId || state.salesMetadata?.salesProfileId === salesProfileId;
    // Legacy callers retain their historic LotLift key; profile-selected calls use the UUID unchanged.
    const callId = meetingActive && state.meetingId && selectedProfile ? salesProfileId ? state.meetingId : `lotlift-${state.meetingId}` : null;
    if (activeCallId && activeCallId !== callId) { void callStates.retire(activeCallId); activeCallId = null; newestProspectSegmentId = null; processed.clear(); }
    if (!callId) return;
    activeCallId = callId;
    callStates.activate(callId);
    const segment = state.segments[state.segments.length - 1];
    if (!segment || segment === previous.segments[previous.segments.length - 1] || !segment.isFinal || segment.source !== "them" || processed.has(segment.id)) return;
    if (!state.settings.evaluations.some((evaluation) => evaluation.id.startsWith("lotlift-")) || callStates.isDoNotContact(callId)) return;
    processed.add(segment.id);
    startLotLiftTurn(segment.id);
    setLotLiftLiveStatus("Thinking");
    newestProspectSegmentId = segment.id;
    const conversation = state.segments.filter((item) => item.isFinal);
    const newProspectSegments = state.segments.filter((item) => item.source === "them" && item.isFinal && !previous.segments.some((previousItem) => previousItem.id === item.id));
    const decisionEvents = newProspectSegments.map(lotLiftDecisionContextEvent).filter((event): event is CallStateEvent => event !== null);
    const currentDecisionEvent = lotLiftDecisionContextEvent(segment);
    const decisionState = decisionEvents.reduce(reduceLotLiftCallState, callStates.stateFor(callId) ?? newLotLiftCallState(callId));
    const decisionEvidence = lotLiftDecisionContextChange(decisionState, currentDecisionEvent);
    const hardRuleStartedAt = performance.now();
    const deterministic = classifyLotLiftTurn(segment, decisionState, state.settings.userName);
    measureLotLiftHardRule(segment.id, hardRuleStartedAt);
    markLotLiftTurn(segment.id, "playbook");
    if (deterministic?.response.id === "do-not-call") {
      const prospectId = salesProfileId && state.salesMetadata?.businessId ? canonicalProspectId(state.salesMetadata.prospect) : null;
      if (prospectId && state.salesMetadata) leadMemory.recordDoNotContact({ businessId: state.salesMetadata.businessId, canonicalProspectId: prospectId, recordedAt: new Date().toISOString() });
      if (callStates.record(callId, segment.id, [...decisionEvents, deterministic.state])) { void callStates.flush(callId).then(() => markLotLiftTurn(segment.id, "persisted")); display(segment, deterministic.response, true); }
      return;
    }
    if (state.settings.llmProviders.realtime !== "ollama") {
      const events = deterministic ? [...decisionEvents, deterministic.state] : decisionEvents;
      if (events.length && callStates.record(callId, segment.id, events)) { void callStates.flush(callId).then(() => markLotLiftTurn(segment.id, "persisted")); if (deterministic) display(segment, deterministic.response, false, decisionEvidence ?? undefined); }
      return;
    }
    void (async () => {
      await callStates.flush(callId);
      if (newestProspectSegmentId !== segment.id) return;
      try {
        markLotLiftTurn(segment.id, "modelStart");
        const result = await turnAnalyzer({ state: callStates.stateFor(callId)!, turn: segment, conversation, relevantRuleIds: deterministic ? [deterministic.response.rule_id] : undefined, settings: state.settings });
        markLotLiftTurn(segment.id, "modelFirstResponse");
        markLotLiftTurn(segment.id, "modelComplete");
        if (newestProspectSegmentId !== segment.id) return;
        if (result.source === "fallback" && deterministic) {
          setLotLiftLiveStatus("Fallback used");
          if (callStates.record(callId, segment.id, [...decisionEvents, deterministic.state])) display(segment, deterministic.response, false, decisionEvidence ?? undefined);
          return;
        }
        const events = [...decisionEvents, ...result.state_events];
        if (events.length && callStates.record(callId, segment.id, events)) void callStates.flush(callId).then(() => {
          markLotLiftTurn(segment.id, "persisted");
        });
        if (!result.needs_coaching) { setLotLiftLiveStatus("No intervention needed"); return; }
        const contextualQuestion = result.source === "model" && result.say?.trim().endsWith("?")
          ? { id: "contextual-question", title: "Discovery question", consideration: result.goal ?? "Clarify the prospect's context.", response: result.say }
          : deterministic?.response;
        if (!contextualQuestion) { setLotLiftLiveStatus("No intervention needed"); return; }
        display(segment, contextualQuestion, false, decisionEvidence ?? undefined);
      } catch {
        setLotLiftLiveStatus("Local model unavailable");
        if (newestProspectSegmentId === segment.id && deterministic && callStates.record(callId, segment.id, [...decisionEvents, deterministic.state])) { void callStates.flush(callId).then(() => markLotLiftTurn(segment.id, "persisted")); display(segment, deterministic.response, false, decisionEvidence ?? undefined); }
      }
    })();
  });
  return unsubscribe;
}
