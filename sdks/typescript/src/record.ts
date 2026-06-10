/**
 * Manual event recording — for providers without a proxy adapter.
 *
 * `record()` covers anything the property-path proxy can't reach (Deepgram /
 * ElevenLabs call-style sub-clients, raw HTTP integrations, batch jobs). It
 * prices locally with the bundled pricing file, merges metadata with the
 * active request context, and ships asynchronously like every other event.
 *
 *   record({ provider: "elevenlabs", model: "eleven_multilingual_v2",
 *            operation: "audio", characters: text.length,
 *            feature: "narration", customer_id: "cust-7" });
 */

import { MetadataResolver } from "./metadata.js";
import { PricingEngine } from "./pricing.js";
import {
  type Event,
  SDK_LANG,
  SDK_VERSION,
  makeUsage,
  newRequestId,
} from "./schema.js";
import { getQueue, resolveIngest } from "./wrap.js";

export interface RecordOptions {
  provider: string;
  model: string;
  operation?: string;
  status?: "ok" | "error";
  error_type?: string;
  stream?: boolean;
  latency_ms?: number;

  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  tool_tokens?: number;
  audio_seconds?: number;
  characters?: number;
  image_count?: number;
  image_tiles?: number;

  /** Overrides the local pricing calculation when the exact cost is known. */
  cost_usd?: number;

  ingestUrl?: string;
  apiKey?: string;

  /** Attribution metadata; unknown keys become tags (same as proxied calls). */
  [key: string]: unknown;
}

const EMPTY_RESOLVER = new MetadataResolver({ tags: {} });

const USAGE_KEYS = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "tool_tokens",
  "audio_seconds",
  "characters",
  "image_count",
  "image_tiles",
] as const;

const NON_META_KEYS = new Set<string>([
  ...USAGE_KEYS,
  "provider",
  "model",
  "operation",
  "status",
  "error_type",
  "stream",
  "latency_ms",
  "cost_usd",
  "ingestUrl",
  "apiKey",
]);

/** Record one billable call. Non-blocking; never throws into the caller. */
export function record(opts: RecordOptions): void {
  try {
    const usage = makeUsage({
      input_tokens: opts.input_tokens,
      cached_input_tokens: opts.cached_input_tokens,
      output_tokens: opts.output_tokens,
      reasoning_tokens: opts.reasoning_tokens,
      tool_tokens: opts.tool_tokens,
      audio_seconds: opts.audio_seconds,
      characters: opts.characters,
      image_count: opts.image_count,
      image_tiles: opts.image_tiles,
    });
    const operation = opts.operation ?? "chat";
    const pricing = PricingEngine.default();
    const cost =
      opts.cost_usd ??
      pricing.cost(usage, opts.provider, opts.model, { operation }).toNumber();

    const callMeta: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(opts)) {
      if (!NON_META_KEYS.has(k)) callMeta[k] = v;
    }
    const meta = EMPTY_RESOLVER.merge(callMeta);

    const event: Event = {
      request_id: newRequestId(),
      ts: new Date().toISOString(),
      provider: opts.provider,
      model: opts.model,
      operation,
      stream: opts.stream ?? false,
      status: opts.status ?? "ok",
      error_type: opts.error_type ?? "",
      environment: meta.environment ?? "",
      team: meta.team ?? "",
      service: meta.service ?? "",
      customer_id: meta.customer_id ?? "",
      user_id: meta.user_id ?? "",
      trace_id: meta.trace_id ?? "",
      feature: meta.feature ?? "",
      prompt_key: meta.prompt_key ?? "",
      prompt_version: meta.prompt_version ?? "",
      tags: meta.tags,
      input_tokens: usage.input_tokens,
      cached_input_tokens: usage.cached_input_tokens,
      output_tokens: usage.output_tokens,
      reasoning_tokens: usage.reasoning_tokens,
      tool_tokens: usage.tool_tokens,
      total_tokens: usage.total_tokens,
      audio_seconds: usage.audio_seconds,
      characters: usage.characters,
      image_count: usage.image_count,
      image_tiles: usage.image_tiles,
      cost_usd: cost,
      pricing_version: pricing.pricingVersion,
      latency_ms: opts.latency_ms ?? 0,
      sdk_lang: SDK_LANG,
      sdk_version: SDK_VERSION,
    };
    const { baseUrl, key } = resolveIngest(opts.ingestUrl, opts.apiKey);
    getQueue(baseUrl, key).enqueue(event);
  } catch {
    // Telemetry must never break the caller.
  }
}
