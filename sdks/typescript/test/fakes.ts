/** Offline fake provider clients + a capturing telemetry queue. */

import type { Event } from "../src/schema.js";

export class CapturingQueue {
  events: Array<Record<string, unknown>> = [];
  enqueue(ev: Event | Record<string, unknown>): void {
    this.events.push(ev as Record<string, unknown>);
  }
}

/** A callable terminal that records calls and returns a canned response. */
export interface FakeCreate {
  (options: Record<string, unknown>): unknown;
  calls: Array<Record<string, unknown>>;
  lastOptions?: Record<string, unknown>;
}

function makeCreate(
  responseFactory: (opts: Record<string, unknown>) => unknown,
): FakeCreate {
  const fn = ((options: Record<string, unknown> = {}) => {
    fn.calls.push({ ...options });
    fn.lastOptions = { ...options };
    return responseFactory(options);
  }) as FakeCreate;
  fn.calls = [];
  return fn;
}

/** Fake OpenAI-shaped client (constructor name drives detection). */
export class OpenAI {
  api_key = "sk-test";
  chat: { completions: { create: FakeCreate } };
  embeddings: { create: FakeCreate };

  constructor(responseFactory: (opts: Record<string, unknown>) => unknown) {
    this.chat = { completions: { create: makeCreate(responseFactory) } };
    this.embeddings = { create: makeCreate(responseFactory) };
  }

  somePassthroughMethod(): string {
    return "passthrough-ok";
  }
}

/** Fake Anthropic-shaped client. */
export class Anthropic {
  messages: { create: FakeCreate };
  constructor(responseFactory: (opts: Record<string, unknown>) => unknown) {
    this.messages = { create: makeCreate(responseFactory) };
  }
}

/** Async iterable wrapper over an array of chunks. */
export function asyncIterableOf<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

/** Sync iterable wrapper over an array of chunks. */
export function syncIterableOf<T>(items: T[]): Iterable<T> {
  return items[Symbol.iterator]
    ? { [Symbol.iterator]: () => items[Symbol.iterator]() }
    : items;
}
