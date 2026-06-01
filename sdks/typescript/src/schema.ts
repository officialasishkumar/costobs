/**
 * Wire contract types for CostObs telemetry.
 *
 * `Event` mirrors `shared/proto/event.schema.json` 1:1. No prompt or response
 * bodies are ever carried here — token counts and metadata only.
 */

import { randomBytes } from "node:crypto";

/** SDK version stamped onto every event. */
export const SDK_VERSION = "0.1.0";
/** SDK language tag. */
export const SDK_LANG = "typescript";

/**
 * Normalized, provider-agnostic usage container.
 *
 * Adapters parse provider-specific response shapes into this. Token fields
 * default to 0 so the pricing engine and event builder can treat them
 * uniformly.
 */
export interface Usage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  tool_tokens: number;
  total_tokens: number;
  audio_seconds: number;
  image_count: number;
  image_tiles: number;
}

/**
 * Build a Usage from partial fields. If no explicit total is given, derive a
 * sensible one (input + output + reasoning) — mirrors the Python SDK.
 */
export function makeUsage(partial: Partial<Usage> = {}): Usage {
  const u: Usage = {
    input_tokens: partial.input_tokens ?? 0,
    cached_input_tokens: partial.cached_input_tokens ?? 0,
    output_tokens: partial.output_tokens ?? 0,
    reasoning_tokens: partial.reasoning_tokens ?? 0,
    tool_tokens: partial.tool_tokens ?? 0,
    total_tokens: partial.total_tokens ?? 0,
    audio_seconds: partial.audio_seconds ?? 0,
    image_count: partial.image_count ?? 0,
    image_tiles: partial.image_tiles ?? 0,
  };
  if (!u.total_tokens) {
    u.total_tokens = u.input_tokens + u.output_tokens + u.reasoning_tokens;
  }
  return u;
}

/** A single telemetry event. Field names == JSON keys == ClickHouse columns. */
export interface Event {
  // --- required ---
  request_id: string;
  ts: string;
  provider: string;
  model: string;
  operation: string;
  status: "ok" | "error";
  pricing_version: string;
  sdk_lang: string;
  sdk_version: string;

  // --- optional / defaulted ---
  stream: boolean;
  error_type: string;

  environment: string;
  team: string;
  service: string;
  customer_id: string;
  user_id: string;
  trace_id: string;
  feature: string;
  prompt_key: string;
  prompt_version: string;
  tags: Record<string, string>;

  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  tool_tokens: number;
  total_tokens: number;
  audio_seconds: number;
  image_count: number;
  image_tiles: number;

  cost_usd: number;

  latency_ms: number;
}

const _ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generate a client-side ULID (Crockford base32, 26 chars, time-sortable).
 * 48 bits of timestamp (ms) + 80 bits of randomness, encoded as 26 base32
 * characters. Small dependency-free implementation.
 */
export function newRequestId(): string {
  const tsMs = Date.now();
  const rand = randomBytes(10); // 80 bits

  const out = new Array<string>(26);

  // Encode the 48-bit timestamp into the first 10 chars (50 bits of space).
  let ts = tsMs;
  for (let i = 9; i >= 0; i--) {
    out[i] = _ENC[ts % 32]!;
    ts = Math.floor(ts / 32);
  }

  // Encode 80 bits of randomness into the remaining 16 chars (80 bits exactly).
  // Walk the 10 bytes as a bit stream, 5 bits per char.
  let bitBuffer = 0;
  let bitCount = 0;
  let pos = 10;
  for (let i = 0; i < rand.length; i++) {
    bitBuffer = (bitBuffer << 8) | rand[i]!;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      const idx = (bitBuffer >> bitCount) & 0x1f;
      out[pos++] = _ENC[idx]!;
    }
  }

  return out.join("");
}
