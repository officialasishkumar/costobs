/**
 * Non-invasive JS Proxy that observes provider calls.
 *
 * The proxy never subclasses provider internals. Every property access is
 * forwarded; only an allowlist of terminal create method paths (per adapter)
 * is intercepted. Sub-namespaces on the way to a terminal stay wrapped so we
 * can reach the terminal method; everything else passes straight through, so
 * the proxy survives provider SDK version churn.
 *
 * The provider call ALWAYS executes first. Cost calc + enqueue happen after
 * the result resolves; shipping happens in the background. The synchronous
 * overhead on the hot path is a metadata object-merge plus an array push.
 */

import type { ProviderAdapter, StreamAccumulator } from "./adapters/base.js";
import type { CallSiteMeta, MetadataResolver } from "./metadata.js";
import type { PricingEngine } from "./pricing.js";
import type { TelemetryQueue } from "./telemetry.js";
import {
  type Event,
  type Usage,
  SDK_LANG,
  SDK_VERSION,
  makeUsage,
  newRequestId,
} from "./schema.js";

/** Shared dependencies for a wrapped client tree. */
export interface Recorder {
  adapter: ProviderAdapter;
  resolver: MetadataResolver;
  pricing: PricingEngine;
  queue: Pick<TelemetryQueue, "enqueue">;
  /**
   * Provider name resolved at wrap time; may differ from adapter.name for
   * OpenAI-compatible providers reached via baseURL. Defaults to adapter.name.
   */
  provider?: string;
}

function utcNowIso(): string {
  // RFC3339 UTC with millisecond precision (Date#toISOString already gives ms).
  return new Date().toISOString();
}

function pathEquals(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function isTerminal(path: readonly string[], adapter: ProviderAdapter): boolean {
  return adapter.terminalPaths.some((t) => pathEquals(path, t));
}

function isPrefixOfTerminal(
  path: readonly string[],
  adapter: ProviderAdapter,
): boolean {
  return adapter.terminalPaths.some(
    (t) => path.length < t.length && pathEquals(path, t.slice(0, path.length)),
  );
}

/** Wrap a target object in a Proxy that intercepts terminal create methods. */
function wrapNode(
  target: object,
  recorder: Recorder,
  path: readonly string[],
): unknown {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop !== "string") {
        return Reflect.get(obj, prop, receiver);
      }
      const value = Reflect.get(obj, prop, receiver);
      const newPath = [...path, prop];

      // Terminal create call: intercept.
      if (isTerminal(newPath, recorder.adapter) && typeof value === "function") {
        return makeWrappedCreate(
          value as (...a: unknown[]) => unknown,
          obj,
          recorder,
          newPath,
        );
      }

      // On the path to a terminal and the node is an object: keep wrapping so
      // we can reach the terminal method.
      if (
        isPrefixOfTerminal(newPath, recorder.adapter) &&
        value !== null &&
        (typeof value === "object" || typeof value === "function")
      ) {
        return wrapNode(value as object, recorder, newPath);
      }

      // Everything else passes straight through. Bind functions to the real
      // target so `this` is correct.
      if (typeof value === "function") {
        return value.bind(obj);
      }
      return value;
    },

    set(obj, prop, value, receiver) {
      return Reflect.set(obj, prop, value, receiver);
    },
  });
}

/** Split the call-site `costobs` field out of the provider options object. */
function splitOptions(
  args: unknown[],
): { callMeta: CallSiteMeta; forwardArgs: unknown[] } {
  if (args.length === 0) return { callMeta: {}, forwardArgs: args };
  const first = args[0];
  if (first === null || typeof first !== "object" || Array.isArray(first)) {
    return { callMeta: {}, forwardArgs: args };
  }
  const opts = first as Record<string, unknown>;
  if (!("costobs" in opts)) {
    return { callMeta: {}, forwardArgs: args };
  }
  // Strip `costobs` before forwarding so the provider never sees it.
  const { costobs, ...rest } = opts;
  const callMeta = (costobs ?? {}) as CallSiteMeta;
  const forwardArgs = [rest, ...args.slice(1)];
  return { callMeta, forwardArgs };
}

function optionsObject(args: unknown[]): Record<string, unknown> {
  const first = args[0];
  if (first !== null && typeof first === "object" && !Array.isArray(first)) {
    return first as Record<string, unknown>;
  }
  return {};
}

interface CallState {
  requestId: string;
  ts: string;
  operation: string;
  model: string;
  streaming: boolean;
  callMeta: CallSiteMeta;
  start: number;
}

function makeWrappedCreate(
  createFn: (...a: unknown[]) => unknown,
  thisArg: object,
  recorder: Recorder,
  path: readonly string[],
): (...a: unknown[]) => unknown {
  const adapter = recorder.adapter;
  const operation = adapter.operationFor(path);
  // Methods whose name ends in "Stream" (e.g. Gemini generateContentStream)
  // always return a stream regardless of any option flag.
  const isStreamingMethod = path[path.length - 1]!.endsWith("Stream");

  return function wrappedCreate(...args: unknown[]): unknown {
    const { callMeta, forwardArgs } = splitOptions(args);
    let options = optionsObject(forwardArgs);
    const streaming = isStreamingMethod || adapter.isStream(options);

    if (streaming && !isStreamingMethod) {
      const prepared = adapter.prepareStreamOptions(options);
      if (prepared !== options) {
        options = prepared;
        forwardArgs[0] = prepared;
      }
    }

    const state: CallState = {
      requestId: newRequestId(),
      ts: utcNowIso(),
      operation,
      model: adapter.modelFromOptions(options),
      streaming,
      callMeta,
      start: performanceNow(),
    };

    // --- the provider call: nothing of ours runs before this is invoked ---
    let result: unknown;
    try {
      result = createFn.apply(thisArg, forwardArgs);
    } catch (e) {
      emit(recorder, state, makeUsage(), {
        status: "error",
        errorType: errorName(e),
      });
      throw e;
    }

    // Promise-returning create (async clients, or sync clients that return a
    // Promise). Attach handlers without changing the returned value's identity
    // semantics beyond what the provider already does.
    if (isPromiseLike(result)) {
      return (result as Promise<unknown>).then(
        (resolved) => finishResult(resolved, recorder, state, adapter),
        (err) => {
          emit(recorder, state, makeUsage(), {
            status: "error",
            errorType: errorName(err),
          });
          throw err;
        },
      );
    }

    return finishResult(result, recorder, state, adapter);
  };
}

function finishResult(
  result: unknown,
  recorder: Recorder,
  state: CallState,
  adapter: ProviderAdapter,
): unknown {
  if (state.streaming && isAsyncIterable(result)) {
    return wrapAsyncIterable(result, recorder, state, adapter);
  }
  if (state.streaming && isSyncIterable(result)) {
    return wrapSyncIterable(result, recorder, state, adapter);
  }
  const usage = adapter.parseUsage(result, state.operation);
  emit(recorder, state, usage, {});
  return result;
}

function performanceNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function errorName(e: unknown): string {
  if (e instanceof Error) return e.name || e.constructor.name;
  if (e !== null && typeof e === "object") return e.constructor.name;
  return "Error";
}

function isPromiseLike(v: unknown): v is PromiseLike<unknown> {
  return (
    v !== null &&
    (typeof v === "object" || typeof v === "function") &&
    typeof (v as { then?: unknown }).then === "function"
  );
}

function isAsyncIterable(v: unknown): v is AsyncIterable<unknown> {
  return (
    v !== null &&
    typeof v === "object" &&
    typeof (v as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] ===
      "function"
  );
}

function isSyncIterable(v: unknown): v is Iterable<unknown> {
  return (
    v !== null &&
    typeof v === "object" &&
    typeof (v as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function"
  );
}

interface EmitOpts {
  status?: "ok" | "error";
  errorType?: string;
}

function emit(
  recorder: Recorder,
  state: CallState,
  usage: Usage,
  opts: EmitOpts,
): void {
  const latencyMs = Math.round(performanceNow() - state.start);
  const meta = recorder.resolver.merge(state.callMeta);
  const adapter = recorder.adapter;
  const provider =
    adapter.providerForCall?.(state.model, {}) ??
    recorder.provider ??
    adapter.name;
  // Normalized for both pricing and the stamped event (strips routing
  // prefixes like "anthropic/claude-...").
  const model = adapter.normalizeModel?.(state.model) ?? state.model;
  const cost = recorder.pricing.cost(usage, provider, model, {
    operation: state.operation,
  });

  const event: Event = {
    request_id: state.requestId,
    ts: state.ts,
    provider,
    model,
    operation: state.operation,
    stream: state.streaming,
    status: opts.status ?? "ok",
    error_type: opts.errorType ?? "",
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
    cost_usd: cost.toNumber(),
    pricing_version: recorder.pricing.pricingVersion,
    latency_ms: latencyMs,
    sdk_lang: SDK_LANG,
    sdk_version: SDK_VERSION,
  };
  recorder.queue.enqueue(event);
}

/**
 * Wrap an async-iterable stream: tee usage as chunks flow, emit exactly once
 * when iteration completes OR is broken early (try/finally around the
 * passthrough). The returned object preserves the original's async-iterable
 * interface and forwards other properties.
 */
function wrapAsyncIterable(
  stream: AsyncIterable<unknown>,
  recorder: Recorder,
  state: CallState,
  adapter: ProviderAdapter,
): AsyncIterable<unknown> {
  const acc: StreamAccumulator = adapter.newStreamAccumulator(state.model);
  let emitted = false;
  const finish = (opts: EmitOpts = {}): void => {
    if (emitted) return;
    emitted = true;
    emit(recorder, state, acc.result(), opts);
  };

  async function* generator(): AsyncGenerator<unknown> {
    try {
      for await (const chunk of stream) {
        try {
          acc.feed(chunk);
        } catch {
          // never let usage parsing break the user's stream
        }
        yield chunk;
      }
      finish();
    } catch (e) {
      finish({ status: "error", errorType: errorName(e) });
      throw e;
    } finally {
      // Covers early `break` (generator.return) — emit once if not already.
      finish();
    }
  }

  return makeStreamProxy(
    stream,
    generator(),
    Symbol.asyncIterator,
  ) as AsyncIterable<unknown>;
}

/** Sync-iterable variant (some clients return a sync iterator for streams). */
function wrapSyncIterable(
  stream: Iterable<unknown>,
  recorder: Recorder,
  state: CallState,
  adapter: ProviderAdapter,
): Iterable<unknown> {
  const acc: StreamAccumulator = adapter.newStreamAccumulator(state.model);
  let emitted = false;
  const finish = (opts: EmitOpts = {}): void => {
    if (emitted) return;
    emitted = true;
    emit(recorder, state, acc.result(), opts);
  };

  function* generator(): Generator<unknown> {
    try {
      for (const chunk of stream) {
        try {
          acc.feed(chunk);
        } catch {
          // ignore
        }
        yield chunk;
      }
      finish();
    } catch (e) {
      finish({ status: "error", errorType: errorName(e) });
      throw e;
    } finally {
      finish();
    }
  }

  return makeStreamProxy(stream, generator(), Symbol.iterator) as Iterable<unknown>;
}

/**
 * Proxy that exposes the teeing (async-)generator for iteration but forwards
 * every other property to the original stream object (so `.controller`,
 * `.response`, `.tee()`, etc. still work).
 */
function makeStreamProxy(
  original: object,
  gen: Iterator<unknown> | AsyncIterator<unknown>,
  iterSymbol: symbol,
): object {
  return new Proxy(original, {
    get(obj, prop, receiver) {
      if (prop === iterSymbol) {
        return () => gen;
      }
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value === "function") return value.bind(obj);
      return value;
    },
  });
}

/** Create the top-level observed client proxy. */
export function createObservedClient(client: object, recorder: Recorder): unknown {
  return wrapNode(client, recorder, []);
}
