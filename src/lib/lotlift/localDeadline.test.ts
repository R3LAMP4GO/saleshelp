import { describe, expect, it } from "vitest";
import { clampLotLiftLocalModelDeadline, LOTLIFT_CONTEXTUAL_MODEL_DEADLINE_MS, LOTLIFT_LOCAL_MODEL_DEADLINE_DEFAULT_MS, resolveLotLiftTurnDeadline } from "./localDeadline";
import type { Settings } from "../types";

const localSettings = (deadline: number) => ({
  llmProviders: { realtime: "ollama" },
  lotLiftLocalModelDeadlineMs: deadline,
} as unknown as Settings);

describe("LotLift local model deadline", () => {
  it("clamps persisted local deadlines to a safe range", () => {
    expect(clampLotLiftLocalModelDeadline(-1)).toBe(500);
    expect(clampLotLiftLocalModelDeadline(99_999)).toBe(15_000);
    expect(clampLotLiftLocalModelDeadline(undefined)).toBe(LOTLIFT_LOCAL_MODEL_DEADLINE_DEFAULT_MS);
  });

  it("uses one contextual deadline for hosted production and simulator requests", () => {
    expect(resolveLotLiftTurnDeadline(localSettings(3_500), undefined)).toBe(3_000);
    expect(resolveLotLiftTurnDeadline({ llmProviders: { realtime: "groq" } } as unknown as Settings, undefined)).toBe(LOTLIFT_CONTEXTUAL_MODEL_DEADLINE_MS);
    expect(resolveLotLiftTurnDeadline({ llmProviders: { realtime: "openai" } } as unknown as Settings, undefined)).toBe(LOTLIFT_CONTEXTUAL_MODEL_DEADLINE_MS);
  });
});
