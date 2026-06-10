/**
 * Vercel AI SDK helpers: track `generateText` / `streamText` calls without a
 * proxy — wrap the call's result and read its normalized usage.
 *
 *   import { generateText, streamText } from "ai";
 *   import { trackGenerateText, trackStreamText } from "@costobs/sdk";
 *
 *   const result = await trackGenerateText(
 *     generateText({ model: openai("gpt-4o"), prompt }),
 *     { feature: "summarize", customer_id: "cust-7" },
 *   );
 *
 *   const stream = trackStreamText(
 *     streamText({ model: openai("gpt-4o"), prompt }),
 *     { feature: "chat" },
 *   );
 */

import { read, readInt } from "./adapters/base.js";
import { record } from "./record.js";

export interface VercelTrackMeta {
  /** Override the provider name (else guessed from the model id). */
  provider?: string;
  /** Override the model id (else read from the result's response). */
  model?: string;
  [key: string]: unknown;
}

/** Bare-model fallbacks used when no provider override is given. */
const MODEL_PROVIDERS: ReadonlyArray<readonly [string, string]> = [
  ["gpt-", "openai"],
  ["o3", "openai"],
  ["o4", "openai"],
  ["claude-", "anthropic"],
  ["gemini-", "gemini"],
  ["grok-", "xai"],
  ["mistral-", "mistral"],
  ["deepseek-", "deepseek"],
];

function guessProvider(model: string): string {
  for (const [stem, provider] of MODEL_PROVIDERS) {
    if (model.startsWith(stem)) return provider;
  }
  return "vercel-ai";
}

function usageFields(usage: unknown): {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
} {
  // AI SDK v5 uses inputTokens/outputTokens (+ reasoningTokens,
  // cachedInputTokens); v4 used promptTokens/completionTokens.
  return {
    input: readInt(usage, "inputTokens", readInt(usage, "promptTokens", 0)),
    cached: readInt(usage, "cachedInputTokens", 0),
    output: readInt(usage, "outputTokens", readInt(usage, "completionTokens", 0)),
    reasoning: readInt(usage, "reasoningTokens", 0),
  };
}

function emitResult(
  usage: unknown,
  response: unknown,
  meta: VercelTrackMeta,
  startMs: number,
  status: "ok" | "error",
  errorType = "",
): void {
  const { provider, model, ...rest } = meta;
  const resolvedModel = model ?? String(read(response, "modelId") ?? "");
  const u = usageFields(usage);
  record({
    provider: provider ?? guessProvider(resolvedModel),
    model: resolvedModel,
    operation: "chat",
    status,
    error_type: errorType,
    latency_ms: Math.max(0, Math.round(Date.now() - startMs)),
    input_tokens: Math.max(0, u.input - u.cached),
    cached_input_tokens: u.cached,
    output_tokens: u.output,
    reasoning_tokens: u.reasoning,
    ...rest,
  });
}

/**
 * Track a `generateText` (or `generateObject`) call: pass the promise, get
 * the same promise back with telemetry attached.
 */
export async function trackGenerateText<T>(
  resultPromise: PromiseLike<T> | T,
  meta: VercelTrackMeta = {},
): Promise<T> {
  const start = Date.now();
  let result: T;
  try {
    result = await resultPromise;
  } catch (e) {
    emitResult(
      undefined,
      undefined,
      meta,
      start,
      "error",
      e instanceof Error ? e.name : "Error",
    );
    throw e;
  }
  emitResult(read(result, "usage"), read(result, "response"), meta, start, "ok");
  return result;
}

/**
 * Track a `streamText` call: pass the (synchronous) stream result through
 * unchanged; telemetry is emitted when its `usage` promise settles.
 */
export function trackStreamText<T extends object>(
  streamResult: T,
  meta: VercelTrackMeta = {},
): T {
  const start = Date.now();
  const usageP = Promise.resolve(read(streamResult, "usage"));
  const responseP = Promise.resolve(read(streamResult, "response"));
  void Promise.allSettled([usageP, responseP]).then(([u, r]) => {
    const usage = u.status === "fulfilled" ? u.value : undefined;
    const response = r.status === "fulfilled" ? r.value : undefined;
    const failed = u.status === "rejected";
    emitResult(
      usage,
      response,
      meta,
      start,
      failed ? "error" : "ok",
      failed ? "StreamError" : "",
    );
  });
  return streamResult;
}
