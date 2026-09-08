import type { Settings } from "../types";
import { buildLotLiftEvaluations } from "./evaluations";

/** Explicit user action only; API keys remain untouched. */
export function lotLiftLocalPreset(settings: Settings): Partial<Settings> {
  return {
    llmProviders: { ...settings.llmProviders, realtime: "ollama", deep: "ollama" },
    models: { ...settings.models, ollama: { ...settings.models.ollama, realtime: "qwen3:4b", deep: "qwen3:8b" } },
    transcriptionProvider: "mlx-parakeet",
    evaluations: buildLotLiftEvaluations(),
    delivery: { ...settings.delivery, pace: true, pauses: true, pitch: false, tone: false },
  };
}

export const LOTLIFT_OLLAMA_SETUP = ["ollama pull qwen3:4b", "ollama pull qwen3:8b"] as const;
export function lotLiftLocalReadiness(models: readonly string[], parakeetStatus: string | null): "ready" | "missing-models" | "parakeet-unavailable" {
  if (!["qwen3:4b", "qwen3:8b"].every((model) => models.includes(model))) return "missing-models";
  return parakeetStatus === "ready" ? "ready" : "parakeet-unavailable";
}
