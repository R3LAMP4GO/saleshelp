import { describe, expect, it } from "vitest";
import { getLotLiftLiveStatus, setLotLiftLiveStatus } from "./liveStatus";

describe("LotLift live status", () => {
  it.each(["Listening", "Thinking", "Suggestion ready", "No intervention needed", "Local model unavailable", "Fallback used"] as const)("transitions to %s", (status) => {
    setLotLiftLiveStatus(status);
    expect(getLotLiftLiveStatus()).toBe(status);
  });
});
