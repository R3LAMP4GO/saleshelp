import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LOTLIFT_COLD_OUTBOUND_PROFILE } from "../sales-profiles/lotlift/profile";
import { newLotLiftCallState, reduceLotLiftCallState, type LotLiftCallState } from "../src/lib/lotlift/callState";
import { selectLotLiftNextMove } from "../src/lib/lotlift/nextMove";
import { resolveSalesProfile } from "../src/lib/sales/profiles";
import type { TranscriptSegment } from "../src/lib/types";

export type BenchmarkFixture = Readonly<{
  id: string;
  category: "long-tenure" | "ai-skepticism" | "security" | "integration" | "vendor-trust" | "staff-adoption" | "competitive" | "other";
  input: string;
  context: "fresh" | "owner" | "crm-gap";
  expectedCriteria: readonly string[];
  expectedMoves: readonly string[];
  forbiddenClaims: readonly string[];
}>;

const commonForbidden = ["unsupported pricing or discount", "guaranteed ROI/results", "invented integration", "invented security certification", "CRM replacement claim"] as const;

export const LOTLIFT_OBJECTION_FIXTURES: readonly BenchmarkFixture[] = [
  { id: "long-tenure-vinsolutions", category: "long-tenure", input: "We've used VinSolutions for 15 years. Why would we change now?", context: "crm-gap", expectedCriteria: ["Respect the existing system", "Explore a verified workflow gap without replacement claims"], expectedMoves: ["existing-workflow-coverage"], forbiddenClaims: commonForbidden },
  { id: "long-tenure-dms", category: "long-tenure", input: "Our DMS process has worked for decades.", context: "owner", expectedCriteria: ["Respect tenure", "Diagnose a remaining workflow gap"], expectedMoves: ["existing-workflow-coverage", "guided-objection-discovery"], forbiddenClaims: commonForbidden },
  { id: "ai-hype", category: "ai-skepticism", input: "AI is all hype. We don't need another gimmick.", context: "owner", expectedCriteria: ["Acknowledge skepticism", "Ask one diagnostic question"], expectedMoves: ["ai-skepticism"], forbiddenClaims: [...commonForbidden, "claim autonomous AI results"] },
  { id: "ai-job-loss", category: "ai-skepticism", input: "Is this going to replace my BDC people?", context: "owner", expectedCriteria: ["Answer only supported product truth", "Avoid job-loss promises"], expectedMoves: ["ai-skepticism"], forbiddenClaims: [...commonForbidden, "replace staff claim"] },
  { id: "security-breach", category: "security", input: "We had a data breach. Why should I trust your security?", context: "owner", expectedCriteria: ["Acknowledge concern", "Ask what security requirement matters"], expectedMoves: ["security-authorization", "guided-objection-discovery"], forbiddenClaims: [...commonForbidden, "SOC 2 claim", "encryption claim"] },
  { id: "security-permission", category: "security", input: "Who can see our customer data?", context: "owner", expectedCriteria: ["Do not invent access controls", "Clarify the authorization requirement"], expectedMoves: ["security-authorization", "guided-objection-discovery"], forbiddenClaims: [...commonForbidden, "role-based access claim"] },
  { id: "integration-required", category: "integration", input: "Does it integrate directly with Reynolds? That's non-negotiable.", context: "owner", expectedCriteria: ["State limitation safely", "Do not claim unverified integration"], expectedMoves: ["hard-integration-close", "security-authorization"], forbiddenClaims: [...commonForbidden, "direct Reynolds integration"] },
  { id: "integration-marketplace", category: "integration", input: "Do you integrate with every lead provider we use?", context: "owner", expectedCriteria: ["Clarify relevant sources", "Avoid universal integration promise"], expectedMoves: ["security-authorization", "limitation-route"], forbiddenClaims: [...commonForbidden, "supports every provider"] },
  { id: "integration-custom", category: "integration", input: "Can your engineers build a custom connector for us?", context: "owner", expectedCriteria: ["Avoid capability promise", "Clarify required workflow"], expectedMoves: ["security-authorization", "guided-objection-discovery"], forbiddenClaims: [...commonForbidden, "custom engineering promise"] },
  { id: "vendor-trust-burned", category: "vendor-trust", input: "The last vendor overpromised and disappeared after onboarding.", context: "owner", expectedCriteria: ["Acknowledge prior experience", "Diagnose trust requirement"], expectedMoves: ["guided-objection-discovery", "decision-criteria"], forbiddenClaims: [...commonForbidden, "guaranteed support"] },
  { id: "vendor-trust-reference", category: "vendor-trust", input: "How do I know you won't disappear like the last company?", context: "owner", expectedCriteria: ["Do not make unsupported trust claims", "Ask what assurance matters"], expectedMoves: ["guided-objection-discovery", "decision-criteria"], forbiddenClaims: [...commonForbidden, "financial stability claim"] },
  { id: "vendor-trust-contract", category: "vendor-trust", input: "I'm not signing another long contract with a startup.", context: "owner", expectedCriteria: ["Clarify contract concern", "Do not invent terms"], expectedMoves: ["timing-follow-up", "guided-objection-discovery"], forbiddenClaims: [...commonForbidden, "contract flexibility claim"] },
  { id: "staff-adoption-training", category: "staff-adoption", input: "My team already ignores half the tools we buy.", context: "owner", expectedCriteria: ["Explore adoption failure", "Do not claim staff will use it"], expectedMoves: ["staff-adoption"], forbiddenClaims: [...commonForbidden, "guaranteed adoption"] },
  { id: "staff-adoption-spying", category: "staff-adoption", input: "My salespeople will think we're spying on them.", context: "owner", expectedCriteria: ["Acknowledge trust concern", "Diagnose perception versus burden"], expectedMoves: ["staff-adoption"], forbiddenClaims: [...commonForbidden, "monitoring capability claim"] },
  { id: "staff-adoption-turnover", category: "staff-adoption", input: "We have too much turnover to train another system.", context: "owner", expectedCriteria: ["Clarify workflow burden", "Avoid implementation promise"], expectedMoves: ["staff-adoption"], forbiddenClaims: [...commonForbidden, "zero-training claim"] },
  { id: "competitive-incumbent", category: "competitive", input: "We already use a vendor that does this.", context: "crm-gap", expectedCriteria: ["Respect incumbent", "Explore verified gap"], expectedMoves: ["existing-workflow-coverage", "competitor-criteria"], forbiddenClaims: [...commonForbidden, "competitor replacement claim"] },
  { id: "competitive-cheaper", category: "competitive", input: "Your competitor is cheaper.", context: "owner", expectedCriteria: ["Avoid price argument", "Clarify comparison criterion"], expectedMoves: ["competitor-criteria", "price-isolation"], forbiddenClaims: [...commonForbidden, "discount promise"] },
  { id: "competitive-build", category: "competitive", input: "We could build this ourselves.", context: "owner", expectedCriteria: ["Do not dismiss internal build", "Clarify workflow requirement"], expectedMoves: ["decision-criteria", "guided-objection-discovery"], forbiddenClaims: [...commonForbidden, "faster than internal claim"] },
  { id: "competitive-status-quo", category: "competitive", input: "We're happy with what we have.", context: "crm-gap", expectedCriteria: ["Respect status quo", "Explore known gap"], expectedMoves: ["existing-workflow-coverage"], forbiddenClaims: commonForbidden },
  { id: "privacy-consent", category: "security", input: "Are you recording calls or storing customer information?", context: "owner", expectedCriteria: ["Avoid privacy capability claims", "Clarify requirement"], expectedMoves: ["security-authorization", "guided-objection-discovery"], forbiddenClaims: [...commonForbidden, "recording policy claim"] },
  { id: "budget-freeze", category: "other", input: "We have a spending freeze until next quarter.", context: "owner", expectedCriteria: ["Respect timing", "Avoid pricing promise"], expectedMoves: ["timing-follow-up", "price-isolation"], forbiddenClaims: commonForbidden },
  { id: "not-a-priority", category: "other", input: "This just isn't a priority right now.", context: "owner", expectedCriteria: ["Clarify priority constraint", "Avoid pressure"], expectedMoves: ["first-refusal", "timing-follow-up", "guided-objection-discovery"], forbiddenClaims: commonForbidden },
  { id: "send-material", category: "other", input: "Just email me something and I'll look at it later.", context: "owner", expectedCriteria: ["Get useful clarification", "Avoid generic material"], expectedMoves: ["information-topic"], forbiddenClaims: commonForbidden },
  { id: "too-small", category: "other", input: "We're too small for something like this.", context: "owner", expectedCriteria: ["Clarify fit without overselling"], expectedMoves: ["fit-source-volume", "guided-objection-discovery"], forbiddenClaims: commonForbidden },
  { id: "previous-software", category: "staff-adoption", input: "We tried software like this before and nobody used it.", context: "owner", expectedCriteria: ["Explore prior adoption failure", "Do not claim LotLift is different"], expectedMoves: ["staff-adoption"], forbiddenClaims: [...commonForbidden, "we are different claim"] },
] as const;

function segment(id: string, text: string): TranscriptSegment { return { id, text, source: "them", speaker: 0, isFinal: true, startMs: 0, endMs: 1 }; }
function stateFor(fixture: BenchmarkFixture): LotLiftCallState {
  let state = newLotLiftCallState(`benchmark-${fixture.id}`);
  if (fixture.context === "fresh") return state;
  state = reduceLotLiftCallState(state, { type: "capture", field: "workflow_owner", fact: { value: "I own the workflow.", status: "verified", evidence: { segment_id: "owner", text: "I own the workflow." } } });
  if (fixture.context === "crm-gap") {
    state = reduceLotLiftCallState(state, { type: "capture", field: "current_solution", fact: { value: "VinSolutions", status: "verified", evidence: { segment_id: "crm", text: "We use VinSolutions." } } });
    state = reduceLotLiftCallState(state, { type: "capture", field: "after_hours_process", fact: { value: "Late inquiries sit until morning.", status: "verified", evidence: { segment_id: "gap", text: "Late inquiries sit until morning." } } });
  }
  return state;
}

export type BenchmarkResult = Readonly<BenchmarkFixture & { selectedMove: string; response: string; pass: boolean; failureModes: readonly string[] }>;
export function runLotLiftObjectionBenchmark(): readonly BenchmarkResult[] {
  const profile = resolveSalesProfile(LOTLIFT_COLD_OUTBOUND_PROFILE);
  return LOTLIFT_OBJECTION_FIXTURES.map((fixture) => {
    const turn = segment(fixture.id, fixture.input);
    const move = selectLotLiftNextMove({ state: stateFor(fixture), turn, conversation: [turn], approvedRepIdentity: "Avery", resolvedProfile: profile });
    const failureModes = [
      ...(fixture.expectedMoves.includes(move.id) ? [] : [`unexpected-move:${move.id}`]),
      ...fixture.forbiddenClaims.filter((claim) => /replace|integrat|support|monitor|record|security|discount|contract|adoption|training|ROI|results/i.test(claim) && new RegExp(claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(move.response)).map((claim) => `forbidden-claim:${claim}`),
      ...((move.response.match(/\?/g) ?? []).length > 1 ? ["multiple-questions"] : []),
    ];
    return { ...fixture, selectedMove: move.id, response: move.response, pass: failureModes.length === 0, failureModes };
  });
}

if (import.meta.main) {
  const results = runLotLiftObjectionBenchmark();
  const failureModes = results.flatMap((result) => result.failureModes).reduce<Record<string, number>>((counts, mode) => ({ ...counts, [mode]: (counts[mode] ?? 0) + 1 }), {});
  const report = { generatedAt: new Date().toISOString(), total: results.length, passed: results.filter((result) => result.pass).length, failed: results.filter((result) => !result.pass).length, results, failureModes };
  const root = resolve(".gg/evaluations");
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, "lotlift-objection-baseline.json"), `${JSON.stringify(report, null, 2)}\n`);
  const rows = results.map((result) => `| ${result.id} | ${result.selectedMove} | ${result.response.split("|").join("\\|")} | ${result.expectedCriteria.join("; ")} | ${result.forbiddenClaims.join("; ")} | ${result.pass ? "PASS" : `FAIL: ${result.failureModes.join(", ")}`} |`).join("\n");
  await writeFile(resolve(root, "lotlift-objection-baseline.md"), `# LotLift objection baseline\n\n**${report.passed}/${report.total} pass; ${report.failed} fail.**\n\n| Input | Selected baseline move | Response | Expected criteria | Forbidden claims | Result |\n|---|---|---|---|---|---|\n${rows}\n\n## Failure modes\n\n${Object.entries(report.failureModes).map(([mode, count]) => `- ${mode}: ${count}`).join("\n") || "None"}\n`);
  console.log(JSON.stringify({ total: report.total, passed: report.passed, failed: report.failed, failureModes: report.failureModes, report: resolve(root, "lotlift-objection-baseline.md") }));
}
