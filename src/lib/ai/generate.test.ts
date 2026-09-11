import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Settings } from "../types";
import { coerceToSchema, generateObjectResilient } from "./generate";

// The deterministic salvage behind streamObjectResilient/generateObjectResilient:
// it rescues a structured call whose output was generated but didn't conform —
// most often a drifted wrapper key in json_object mode (Groq gpt-oss emitting
// {"moments":[…]} for a {"events":[…]} schema). No LLM round-trip.

const schema = z.object({
  events: z.array(z.object({ title: z.string(), n: z.number() })),
});

describe("coerceToSchema", () => {
  it("passes through output that already matches the schema", () => {
    const v = { events: [{ title: "a", n: 1 }] };
    expect(coerceToSchema(v, schema)).toEqual(v);
  });

  it("remaps a drifted single wrapper key onto the schema's key", () => {
    // The exact gpt-oss-on-Groq failure: right data under "moments", not "events".
    const drifted = { moments: [{ title: "a", n: 1 }, { title: "b", n: 2 }] };
    expect(coerceToSchema(drifted, schema)).toEqual({
      events: [{ title: "a", n: 1 }, { title: "b", n: 2 }],
    });
  });

  it("still validates element shape after remapping (rejects bad elements)", () => {
    const drifted = { moments: [{ title: "a" /* missing n */ }] };
    expect(coerceToSchema(drifted, schema)).toBeNull();
  });

  it("won't guess when there are multiple arrays (ambiguous)", () => {
    expect(coerceToSchema({ a: [{ title: "x", n: 1 }], b: [] }, schema)).toBeNull();
  });

  it("returns null for non-objects / no array payload", () => {
    expect(coerceToSchema(null, schema)).toBeNull();
    expect(coerceToSchema("nope", schema)).toBeNull();
    expect(coerceToSchema({ events: "not-an-array" }, schema)).toBeNull();
  });
});

function openAiTerraSettings(): Settings {
  return {
    llmProviders: { realtime: "openai", deep: "openai" },
    models: { openai: { realtime: "gpt-5.6-terra", deep: "gpt-5.6-terra" } },
    reasoningEffort: { realtime: "none", deep: "medium" },
    openaiApiKey: "test-key",
  } as unknown as Settings;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI-compatible structured requests", () => {
  it("sends Terra reasoning_effort=none with a strict JSON schema", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "gpt-5.6-terra",
      choices: [{ index: 0, message: { role: "assistant", content: '{"reply":"ready"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateObjectResilient({
      settings: openAiTerraSettings(),
      workload: "realtime",
      schema: z.object({ reply: z.string() }),
      system: "Return the requested JSON.",
      prompt: "Reply ready.",
      singleAttempt: true,
    });

    expect(result.object).toEqual({ reply: "ready" });
    const calls = fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit][];
    const request = JSON.parse(String(calls[0]?.[1]?.body));
    expect(request).toMatchObject({
      model: "gpt-5.6-terra",
      reasoning_effort: "none",
      max_completion_tokens: 32_000,
      response_format: { type: "json_schema", json_schema: { strict: true } },
    });
    expect(request.max_tokens).toBeUndefined();
  });
});
