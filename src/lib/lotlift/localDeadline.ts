import type { Settings } from "../types";

export const LOTLIFT_LOCAL_MODEL_DEADLINE_MIN_MS = 500;
export const LOTLIFT_LOCAL_MODEL_DEADLINE_MAX_MS = 15_000;
export const LOTLIFT_LOCAL_MODEL_DEADLINE_DEFAULT_MS = 4_000;
export const LOTLIFT_REMOTE_MODEL_DEADLINE_DEFAULT_MS = 2_000;

export function clampLotLiftLocalModelDeadline(value: unknown): number {
  const deadline = typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : LOTLIFT_LOCAL_MODEL_DEADLINE_DEFAULT_MS;
  return Math.min(LOTLIFT_LOCAL_MODEL_DEADLINE_MAX_MS, Math.max(LOTLIFT_LOCAL_MODEL_DEADLINE_MIN_MS, deadline));
}

export function resolveLotLiftTurnDeadline(settings: Settings | undefined, override: number | undefined): number {
  if (override !== undefined) return clampLotLiftLocalModelDeadline(override);
  return settings?.llmProviders.realtime === "ollama"
    ? clampLotLiftLocalModelDeadline(settings.lotLiftLocalModelDeadlineMs)
    : LOTLIFT_REMOTE_MODEL_DEADLINE_DEFAULT_MS;
}
