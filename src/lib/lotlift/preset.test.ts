import { expect, it } from "vitest";
import { LOTLIFT_OLLAMA_SETUP, lotLiftLocalReadiness } from "./preset";

it("documents explicit Ollama model pulls", () => {
  expect(LOTLIFT_OLLAMA_SETUP).toEqual(["ollama pull qwen3:4b", "ollama pull qwen3:8b"]);
});
it.each([[[], null, "missing-models"], [["qwen3:4b", "qwen3:8b"], "stopped", "parakeet-unavailable"], [["qwen3:4b", "qwen3:8b"], "ready", "ready"]] as const)("reports readiness", (models, status, expected) => expect(lotLiftLocalReadiness(models, status)).toBe(expected));
