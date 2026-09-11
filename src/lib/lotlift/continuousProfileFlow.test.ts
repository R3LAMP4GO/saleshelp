import { expect, it } from "vitest";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../../../sales-profiles/lotlift/profile";
import { resolveSalesProfile } from "../sales/profiles";
import { newLotLiftCallState, reduceLotLiftCallState } from "./callState";
import { buildLotLiftContextPack } from "./contextPack";
import { normalizeForIntent } from "./intentNormalization";
import { selectLotLiftNextMove } from "./nextMove";
import { pendingAnswerFromExecutedMove } from "./pendingAnswer";
import { buildLotLiftMethodologyContext } from "./methodologyContext";
import type { KnowledgeSessionSnapshot } from "../sales/knowledgeStore";

const profile = resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE);
const turn = (id: string, text: string) => ({ id, text, source: "them" as const, speaker: 0, isFinal: true, startMs: 0, endMs: 1 });

it("keeps one profile-driven call state through executed O3, ownership, CRM, and after-hours context", () => {
  let state = newLotLiftCallState("continuous");
  const conversation: ReturnType<typeof turn>[] = [];
  const route = (id: string, text: string) => {
    const prospect = turn(id, text); conversation.push(prospect);
    const move = selectLotLiftNextMove({ state, turn: prospect, conversation, approvedRepIdentity: "Avery Test", resolvedProfile: profile });
    state = move.state_events.reduce(reduceLotLiftCallState, state);
    return move;
  };

  const identity = route("p1", "Who’s this?");
  expect({ normalized: normalizeForIntent("Who’s this?"), move: identity.id, model: identity.response_mode === "compose" }).toEqual({ normalized: "who's this?", move: "O2", model: false });
  expect(state.pending_answer).toBeNull();

  const purpose = route("p2", "What’s this regarding?");
  expect(purpose.id).toBe("O3");
  const o3 = profile.behavior.moves.find((move) => move.id === "O3")!;
  state = reduceLotLiftCallState(state, { type: "pending-answer", pending: pendingAnswerFromExecutedMove(profile.profileId, profile.snapshotVersion, "rep-o3", o3, state.revision) });
  expect(state.pending_answer).toMatchObject({ move_id: "O3", target_field: "workflow_owner" });

  const owner = route("p3", "Yeah, I handle them.");
  expect(state.workflow_owner).toMatchObject({ value: "Yeah, I handle them.", status: "verified" });
  expect(state.pending_answer).toBeNull();
  expect(owner.id).not.toBe("identify-owner");
  expect(owner.id).not.toBe("O3");

  route("p4", "We use VinSolutions.");
  expect(state.current_solution).toMatchObject({ value: "VinSolutions", evidence: { text: "We use VinSolutions." } });

  const afterHours = profile.behavior.moves.find((move) => move.id === "gap-after-hours")!;
  state = reduceLotLiftCallState(state, { type: "pending-answer", pending: pendingAnswerFromExecutedMove(profile.profileId, profile.snapshotVersion, "rep-after-hours", afterHours, state.revision) });
  route("p5", "Sometimes the ones that come in late sit until the next morning.");
  expect(state.after_hours_process).toMatchObject({ value: "Sometimes the ones that come in late sit until the next morning.", evidence: { text: "Sometimes the ones that come in late sit until the next morning." } });

  const objection = route("p6", "We already have a CRM though.");
  const pack = JSON.stringify(buildLotLiftContextPack(state, turn("p6", "We already have a CRM though."), conversation, objection.rule_ids));
  expect(pack).toContain("VinSolutions");
  expect(pack).toContain("late sit until the next morning");
  expect(objection.id).not.toBe("identify-owner");

  const source = (id: string, title: string, hash: string, text: string) => ({ source: { id, title, kind: "pdf" as const, createdAt: "2026-09-11T00:00:00.000Z" }, version: { sourceId: id, sha256: hash, byteSize: 100, pageCount: 1, chunkCount: 1, indexVersion: 1 as const, createdAt: "2026-09-11T00:00:00.000Z" }, chunks: [{ id: `${id}:1`, sourceId: id, sourceSha256: hash, sourceTitle: title, pageStart: 1, pageEnd: 1, location: "Page 1", tags: ["objection"], text }], frameworks: [] });
  const objectionsHash = "c".repeat(64); const executionHash = "d".repeat(64);
  const knowledge: KnowledgeSessionSnapshot = { references: [], indexes: [source("objections-jeb-blount", "Objections", objectionsHash, "Distinguish a reflex response from a real objection before asking one concise question."), source("cold-calling-sucks", "Cold Calling Sucks", executionHash, "Respect an existing CRM, then ask about the verified after-hours workflow gap.")] };
  const methodology = buildLotLiftMethodologyContext({ state, turn: turn("p6", "We already have a CRM though."), candidates: [objection], resolvedProfile: profile, knowledge });
  expect(methodology.frameworks.map((framework) => framework.id)).toContain("existing-solution");
  expect(methodology.sourceRefs).toEqual(expect.arrayContaining([`objections-jeb-blount@${objectionsHash}`, `cold-calling-sucks@${executionHash}`]));
});
