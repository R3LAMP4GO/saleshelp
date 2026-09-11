import { describe, expect, it, vi, beforeEach } from "vitest";
import type { LlmProvider, Settings } from "../types";

// The provider factories are the only thing under test: we care about the
// credential handed to them, not about talking to anyone. Declared inside the
// (hoisted) mock factories, then pulled back out below.
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => () => ({ id: "anthropic-model" })),
}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(() => ({ chatModel: () => ({ id: "oai-model" }) })),
}));
vi.mock("../cloud/client", () => ({ cloudToken: () => null, CLOUD_URL: "https://example.test" }));

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getModel, getProviderOptions } from "./provider";
import { isReasoningModel } from "./providers";

/**
 * Regression guard for the failure the pre-flight coach surfaced as
 * "AI_APICallError: invalid x-api-key": a key pasted with a trailing space or
 * newline passed the `hasProviderKey` gate (which trims) and then went out in
 * the header untrimmed. The provider's reply named the KEY as wrong rather than
 * the whitespace, so there was nothing actionable in it.
 */
function settingsFor(provider: LlmProvider, keyField: string, key: string): Settings {
  return {
    llmProviders: { realtime: provider, deep: provider },
    models: { [provider]: { realtime: "m-fast", deep: "m-smart" } },
    reasoningEffort: { realtime: "low", deep: "medium" },
    [keyField]: key,
  } as unknown as Settings;
}

const anthropicMock = vi.mocked(createAnthropic);
const oaiMock = vi.mocked(createOpenAICompatible);

describe("getModel credential handling", () => {
  beforeEach(() => {
    anthropicMock.mockClear();
    oaiMock.mockClear();
  });

  it("trims a pasted Anthropic key before it reaches the SDK", () => {
    getModel(settingsFor("anthropic", "anthropicApiKey", "  sk-ant-abc123\n"), "deep");
    expect(anthropicMock).toHaveBeenCalledTimes(1);
    expect(anthropicMock.mock.calls[0][0]).toMatchObject({ apiKey: "sk-ant-abc123" });
  });

  it("trims openai-compatible keys too", () => {
    getModel(settingsFor("groq", "groqApiKey", "gsk_abc123 "), "realtime");
    expect(oaiMock).toHaveBeenCalledTimes(1);
    expect(oaiMock.mock.calls[0][0]).toMatchObject({ apiKey: "gsk_abc123" });
  });

  it("leaves a clean key exactly as typed", () => {
    getModel(settingsFor("anthropic", "anthropicApiKey", "sk-ant-clean"), "realtime");
    expect(anthropicMock.mock.calls[0][0]).toMatchObject({ apiKey: "sk-ant-clean" });
  });
});

describe("OpenAI-compatible provider options", () => {
  it("recognizes only the supported GPT-5.6 reasoning models", () => {
    expect(isReasoningModel("gpt-5.6-terra")).toBe(true);
    expect(isReasoningModel("gpt-5.6-luna")).toBe(true);
    expect(isReasoningModel("gpt-5.6-sol")).toBe(true);
    expect(isReasoningModel("gpt-5.6-unlisted")).toBe(false);
  });

  it("passes Terra's selected no-reasoning setting to the OpenAI-compatible SDK", () => {
    const settings = settingsFor("openai", "openaiApiKey", "sk-test");
    settings.models.openai.realtime = "gpt-5.6-terra";
    settings.reasoningEffort.realtime = "none";
    expect(getProviderOptions(settings, "realtime")).toEqual({ openai: { reasoningEffort: "none" } });
  });

  it("disables hidden qwen reasoning for bounded Ollama structured selection", () => {
    expect(getProviderOptions(settingsFor("ollama", "ollamaApiKey", ""), "realtime")).toEqual({ ollama: { think: false } });
  });
});
