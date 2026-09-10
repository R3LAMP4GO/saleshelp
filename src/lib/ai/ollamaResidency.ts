import type { Settings } from "../types";
import { PROVIDER_BY_ID } from "./providers";

/** Refreshes Ollama residency after prewarm and every realtime chat request. */
export const OLLAMA_REALTIME_KEEP_ALIVE = "30m";
export const OLLAMA_PREWARM_TIMEOUT_MS = 15_000;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type OllamaPrewarmResult = "skipped" | "warmed";

/**
 * Preload the configured realtime model without sending conversation content.
 * Ollama documents an empty chat request as the model-preload path.
 */
export async function prewarmOllamaRealtimeModel(
  settings: Settings,
  options: { fetcher?: Fetcher; timeoutMs?: number } = {},
): Promise<OllamaPrewarmResult> {
  if (settings.llmProviders.realtime !== "ollama") return "skipped";

  const endpoint = new URL(PROVIDER_BY_ID.ollama.baseURL!).origin;
  const apiKey = settings.ollamaApiKey.trim();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("Ollama prewarm deadline exceeded", "TimeoutError")), options.timeoutMs ?? OLLAMA_PREWARM_TIMEOUT_MS);

  try {
    const response = await (options.fetcher ?? fetch)(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.models.ollama.realtime,
        messages: [],
        stream: false,
        keep_alive: OLLAMA_REALTIME_KEEP_ALIVE,
      }),
    });
    if (!response.ok) throw new Error(`Ollama prewarm failed (${response.status})`);
    await response.arrayBuffer();
    return "warmed";
  } finally {
    clearTimeout(timeout);
  }
}

let activePrewarm: { key: string; promise: Promise<OllamaPrewarmResult> } | null = null;

/** Deduplicates startup/StrictMode prewarms without retaining an unbounded model cache. */
export function ensureOllamaRealtimeModelResident(settings: Settings): Promise<OllamaPrewarmResult> {
  if (settings.llmProviders.realtime !== "ollama") return Promise.resolve("skipped");
  const key = `${new URL(PROVIDER_BY_ID.ollama.baseURL!).origin}\n${settings.models.ollama.realtime}`;
  if (activePrewarm?.key === key) return activePrewarm.promise;

  const promise = prewarmOllamaRealtimeModel(settings);
  activePrewarm = { key, promise };
  void promise.catch(() => {
    if (activePrewarm?.promise === promise) activePrewarm = null;
  });
  return promise;
}
