import { describe, expect, it, vi } from "vitest";
import type { Settings } from "../types";
import { OLLAMA_REALTIME_KEEP_ALIVE, prewarmOllamaRealtimeModel } from "./ollamaResidency";

function settings(provider: "ollama" | "groq" = "ollama"): Settings {
  return {
    llmProviders: { realtime: provider },
    models: { ollama: { realtime: "qwen3:4b" } },
    ollamaApiKey: "",
  } as unknown as Settings;
}

describe("Ollama realtime model residency", () => {
  it("prewarms the configured model with an empty bounded-residency chat", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(prewarmOllamaRealtimeModel(settings(), { fetcher })).resolves.toBe("warmed");

    expect(fetcher).toHaveBeenCalledWith("http://localhost:11434/api/chat", expect.objectContaining({
      method: "POST",
      signal: expect.any(AbortSignal),
    }));
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      model: "qwen3:4b",
      messages: [],
      stream: false,
      keep_alive: OLLAMA_REALTIME_KEEP_ALIVE,
    });
  });

  it("does no startup network work when realtime Local AI is disabled", async () => {
    const fetcher = vi.fn();

    await expect(prewarmOllamaRealtimeModel(settings("groq"), { fetcher })).resolves.toBe("skipped");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails a rejected prewarm without retrying or changing model behavior", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));

    await expect(prewarmOllamaRealtimeModel(settings(), { fetcher })).rejects.toThrow("Ollama prewarm failed (503)");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
