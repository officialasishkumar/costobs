/**
 * Request-scoped metadata propagated via Node's AsyncLocalStorage.
 *
 * This is the async-propagating equivalent of Python's ContextVar: values set
 * for the duration of `requestContext(ctx, fn)` are visible to every nested
 * LLM call inside `fn` — including across `await` boundaries — while staying
 * isolated between concurrent async flows.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  customerId?: string;
  userId?: string;
  traceId?: string;
  /** Any extra key/value pairs become tags (or known fields if recognized). */
  [key: string]: unknown;
}

const storage = new AsyncLocalStorage<Record<string, unknown>>();

/** Return the current request-context object (empty if none set). */
export function currentContext(): Record<string, unknown> {
  return { ...(storage.getStore() ?? {}) };
}

function clean(d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

/**
 * Run `fn` with `ctx` attached as request-scoped metadata. Works for sync and
 * async functions: the return value (including a Promise) is passed straight
 * through. Nesting accumulates — an inner context merges over the outer one.
 *
 * @example
 *   await requestContext({ customerId: "c1", traceId: "t1" }, async () => {
 *     await client.chat.completions.create({ ... });
 *   });
 */
export function requestContext<T>(ctx: RequestContext, fn: () => T): T {
  const merged = {
    ...(storage.getStore() ?? {}),
    ...clean(ctx as Record<string, unknown>),
  };
  return storage.run(merged, fn);
}
