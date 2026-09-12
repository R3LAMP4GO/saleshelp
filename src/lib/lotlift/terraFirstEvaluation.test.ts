import { expect, it } from "vitest";
import { evaluateTerraFirstFixtures, LOTLIFT_TERRA_FIRST_FIXTURES } from "./terraFirstEvaluation";

it("reproducibly compares fixed validated Terra-first fixtures with legacy routing", () => {
  const result = evaluateTerraFirstFixtures(LOTLIFT_TERRA_FIRST_FIXTURES);
  expect(result.limitation).toMatch(/does not measure live Terra quality/i);
  expect(result.terra.contextualCorrectness).toBeGreaterThan(result.legacy.contextualCorrectness);
  expect(result.terra.noRepeatedDiscovery).toBeGreaterThan(result.legacy.noRepeatedDiscovery);
  expect(result.terra.objectionHandling).toBeGreaterThan(result.legacy.objectionHandling);
  expect(result.terra.meetingProgression).toBeGreaterThanOrEqual(result.legacy.meetingProgression);
  expect(result.terra.gracefulExit).toBeGreaterThanOrEqual(result.legacy.gracefulExit);
  expect(result.terra.supportedClaims).toBe(result.legacy.supportedClaims);
  expect(result.terra.noPhaseRegression).toBeGreaterThanOrEqual(result.legacy.noPhaseRegression);
});
