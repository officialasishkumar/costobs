/**
 * Provider adapter interface, registry, and detection.
 *
 * An adapter knows three things about a provider SDK client:
 *   - which terminal method paths to intercept (e.g. chat.completions.create),
 *   - how to parse a response object into a normalized Usage,
 *   - how to accumulate usage from a stream of chunks.
 */

import { type Usage, makeUsage } from "../schema.js";

/** An attribute path, e.g. ["chat", "completions", "create"]. */
export type Path = readonly string[];

/** Tees usage out of streaming chunks. One instance per stream. */
export interface StreamAccumulator {
  /** Consume one streamed chunk, updating internal usage in place. */
  feed(chunk: unknown): void;
  /** Final accumulated usage. */
  result(): Usage;
}

export interface ProviderAdapter {
  /** Human name stamped onto events, e.g. "openai". */
  readonly name: string;

  /** Attribute paths that are terminal create calls to intercept. */
  readonly terminalPaths: readonly Path[];

  /** Return true if `client` looks like an instance of this provider's SDK. */
  detect(client: unknown): boolean;

  /** Map a terminal path to an Event `operation` value. */
  operationFor(path: Path): string;

  /** Extract the model id from the call options object. */
  modelFromOptions(options: Record<string, unknown>): string;

  /** Parse a non-streaming response into a normalized Usage. */
  parseUsage(response: unknown, operation: string): Usage;

  /** Create a fresh accumulator for a streaming call. */
  newStreamAccumulator(model: string): StreamAccumulator;

  /** Whether the given call options request a stream. */
  isStream(options: Record<string, unknown>): boolean;

  /**
   * Optionally return mutated options that ensure usage is emitted while
   * streaming. Must not mutate the input; returns a copy when changed.
   */
  prepareStreamOptions(options: Record<string, unknown>): Record<string, unknown>;
}

/** Shared helpers for reading values off provider response objects. */
export function read(obj: unknown, key: string): unknown {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj === "object") {
    return (obj as Record<string, unknown>)[key];
  }
  return undefined;
}

export function readInt(obj: unknown, key: string, dflt = 0): number {
  const v = read(obj, key);
  if (v === null || v === undefined) return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}

export { makeUsage };

const registry: ProviderAdapter[] = [];

export function register(adapter: ProviderAdapter): void {
  registry.push(adapter);
}

/** Find the adapter that recognizes `client`. */
export function detect(client: unknown): ProviderAdapter | null {
  for (const adapter of registry) {
    try {
      if (adapter.detect(client)) return adapter;
    } catch {
      continue;
    }
  }
  return null;
}

export function allAdapters(): ProviderAdapter[] {
  return [...registry];
}
