import type { TranscriptSegment } from "../types";
import { newLotLiftCallState, type LotLiftCallState } from "./callState";
import type { LotLiftFinalAnalysisModelOutput } from "./finalAnalysis";

type ModelFact = NonNullable<LotLiftFinalAnalysisModelOutput["summary"]>;
const fact = (value: string, segmentId: string, text: string): ModelFact => ({ value, status: "verified", evidence: { segment_id: segmentId, text } });
const segment = (id: string, text: string): TranscriptSegment => ({ id, text, source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 1 });

type ExpectedFact = {
  field: Exclude<keyof LotLiftFinalAnalysisModelOutput, "do_not_contact" | "dnc_at" | "dnc_evidence" | "recurring_objections">;
  value: string;
  evidence: { segment_id: string; text: string };
};

export type LotLiftFinalAnalysisFixture = {
  name: string;
  transcript: TranscriptSegment[];
  state: LotLiftCallState;
  output: LotLiftFinalAnalysisModelOutput;
  expected: { facts: ExpectedFact[] } | { dnc: true };
};

const state = (id: string) => newLotLiftCallState(id);

export const lotLiftFinalAnalysisFixtures: LotLiftFinalAnalysisFixture[] = [
  (() => {
    const transcript = [segment("qualified", "I am the general manager. We use VinSolutions and can talk Tuesday at 10 AM.")];
    const call = state("qualified");
    return { name: "qualified lead", transcript, state: call, output: {
      call_outcome: fact("general manager", "qualified", "I am the general manager"),
      recommended_follow_up: fact("Tuesday at 10 AM", "qualified", "can talk Tuesday at 10 AM"),
      stakeholders: [fact("general manager", "qualified", "I am the general manager")],
    }, expected: { facts: [
      { field: "call_outcome", value: "general manager", evidence: { segment_id: "qualified", text: "I am the general manager" } },
      { field: "recommended_follow_up", value: "Tuesday at 10 AM", evidence: { segment_id: "qualified", text: "can talk Tuesday at 10 AM" } },
      { field: "stakeholders", value: "general manager", evidence: { segment_id: "qualified", text: "I am the general manager" } },
    ] } };
  })(),
  (() => {
    const transcript = [segment("not-interested", "We are not interested. Please remove us from your prospecting list.")];
    return { name: "explicit not-interested", transcript, state: state("not-interested"), output: {
      call_outcome: fact("not interested", "not-interested", "We are not interested"),
    }, expected: { facts: [
      { field: "call_outcome", value: "not interested", evidence: { segment_id: "not-interested", text: "We are not interested" } },
    ] } };
  })(),
  (() => {
    const transcript = [segment("existing-solution", "Our existing solution handles every lead quickly, so we do not need another tool.")];
    return { name: "sufficient existing solution", transcript, state: state("existing-solution"), output: {
      current_solution: fact("existing solution", "existing-solution", "Our existing solution handles every lead quickly"),
      call_outcome: fact("do not need another tool", "existing-solution", "we do not need another tool"),
    }, expected: { facts: [
      { field: "current_solution", value: "existing solution", evidence: { segment_id: "existing-solution", text: "Our existing solution handles every lead quickly" } },
      { field: "call_outcome", value: "do not need another tool", evidence: { segment_id: "existing-solution", text: "we do not need another tool" } },
    ] } };
  })(),
  (() => {
    const transcript = [segment("callback", "Please call me back on October 3 at 10 AM.")];
    return { name: "explicit callback date", transcript, state: state("callback"), output: {
      next_action_at: fact("October 3 at 10 AM", "callback", "October 3 at 10 AM"),
      recommended_follow_up: fact("call me back", "callback", "Please call me back"),
    }, expected: { facts: [
      { field: "next_action_at", value: "October 3 at 10 AM", evidence: { segment_id: "callback", text: "October 3 at 10 AM" } },
      { field: "recommended_follow_up", value: "call me back", evidence: { segment_id: "callback", text: "Please call me back" } },
    ] } };
  })(),
  (() => {
    const transcript = [segment("partner", "I need to discuss this with my spouse before making a decision.")];
    return { name: "spouse or partner decision", transcript, state: state("partner"), output: {
      stakeholders: [fact("spouse", "partner", "my spouse")],
      call_outcome: fact("discuss this with my spouse", "partner", "discuss this with my spouse"),
    }, expected: { facts: [
      { field: "stakeholders", value: "spouse", evidence: { segment_id: "partner", text: "my spouse" } },
      { field: "call_outcome", value: "discuss this with my spouse", evidence: { segment_id: "partner", text: "discuss this with my spouse" } },
    ] } };
  })(),
  (() => {
    const transcript = [segment("integration", "We require a direct CRM integration, and without it this is not a fit.")];
    return { name: "required direct CRM integration disqualification", transcript, state: state("integration"), output: {
      fit_status: fact("not a fit", "integration", "this is not a fit"),
      disqualification_reason: fact("direct CRM integration", "integration", "direct CRM integration"),
    }, expected: { facts: [
      { field: "fit_status", value: "not a fit", evidence: { segment_id: "integration", text: "this is not a fit" } },
      { field: "disqualification_reason", value: "direct CRM integration", evidence: { segment_id: "integration", text: "direct CRM integration" } },
    ] } };
  })(),
  (() => {
    const transcript = [segment("dnc", "Do not call us again.")];
    const call = state("dnc");
    call.do_not_contact = true;
    call.dnc_at = "2026-09-07T12:00:00.000Z";
    call.dnc_evidence = { segment_id: "dnc", text: "Do not call us again" };
    return { name: "do not contact", transcript, state: call, output: {
      call_outcome: fact("Do not call", "dnc", "Do not call us again"),
      do_not_contact: false,
    }, expected: { dnc: true } };
  })(),
];
