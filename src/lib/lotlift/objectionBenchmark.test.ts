import { expect, it } from "vitest";
import { LOTLIFT_OBJECTION_FIXTURES, runLotLiftObjectionBenchmark } from "../../../scripts/lotlift-objection-benchmark.mts";

it("covers 25 realistic unsupported objections without introducing unsafe baseline claims", () => {
  const results = runLotLiftObjectionBenchmark();
  expect(LOTLIFT_OBJECTION_FIXTURES).toHaveLength(25);
  expect(results).toHaveLength(25);
  expect(results.every((result) => result.response.length > 0)).toBe(true);
  expect(results.flatMap((result) => result.failureModes).filter((mode) => mode.startsWith("forbidden-claim:"))).toEqual([]);
});
