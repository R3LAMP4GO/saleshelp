export type TerraFirstScoreDimension = "contextualCorrectness" | "noRepeatedDiscovery" | "naturalness" | "objectionHandling" | "meetingProgression" | "gracefulExit" | "supportedClaims" | "noPhaseRegression";
export type TerraFirstFixture = { name: string; legacy: readonly TerraFirstScoreDimension[]; terra: readonly TerraFirstScoreDimension[] };
export type TerraFirstEvaluation = { limitation: string; fixtures: readonly TerraFirstFixture[]; legacy: Record<TerraFirstScoreDimension, number>; terra: Record<TerraFirstScoreDimension, number> };

const dimensions: readonly TerraFirstScoreDimension[] = ["contextualCorrectness", "noRepeatedDiscovery", "naturalness", "objectionHandling", "meetingProgression", "gracefulExit", "supportedClaims", "noPhaseRegression"];

/** Fixed validated fixture outputs compare routing policy, not live-model quality. */
export function evaluateTerraFirstFixtures(fixtures: readonly TerraFirstFixture[]): TerraFirstEvaluation {
  const score = (key: "legacy" | "terra") => Object.fromEntries(dimensions.map((dimension) => [dimension, fixtures.filter((fixture) => fixture[key].includes(dimension)).length])) as Record<TerraFirstScoreDimension, number>;
  return { limitation: "This deterministic fixture evaluation does not measure live Terra quality.", fixtures, legacy: score("legacy"), terra: score("terra") };
}

export const LOTLIFT_TERRA_FIRST_FIXTURES: readonly TerraFirstFixture[] = [
  { name: "gatekeeper ownership", legacy: ["contextualCorrectness", "supportedClaims", "noPhaseRegression"], terra: ["contextualCorrectness", "noRepeatedDiscovery", "naturalness", "supportedClaims", "noPhaseRegression"] },
  { name: "existing solution", legacy: ["contextualCorrectness", "supportedClaims"], terra: ["contextualCorrectness", "noRepeatedDiscovery", "naturalness", "supportedClaims", "noPhaseRegression"] },
  { name: "novel objection", legacy: ["supportedClaims"], terra: ["contextualCorrectness", "naturalness", "objectionHandling", "supportedClaims"] },
  { name: "verified workflow gap", legacy: ["meetingProgression", "supportedClaims"], terra: ["contextualCorrectness", "meetingProgression", "naturalness", "supportedClaims", "noPhaseRegression"] },
  { name: "fully covered workflow", legacy: ["supportedClaims"], terra: ["contextualCorrectness", "gracefulExit", "naturalness", "supportedClaims", "noPhaseRegression"] },
  { name: "do not contact", legacy: ["gracefulExit", "supportedClaims", "noPhaseRegression"], terra: ["gracefulExit", "supportedClaims", "noPhaseRegression"] },
];
