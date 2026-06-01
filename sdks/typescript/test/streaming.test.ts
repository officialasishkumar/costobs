import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// Side-effect import registers the built-in adapters in the registry.
import "../src/adapters/openai.js";
import "../src/adapters/anthropic.js";
import "../src/adapters/gemini.js";
import { detect } from "../src/adapters/base.js";
import { MetadataResolver } from "../src/metadata.js";
import { PricingEngine } from "../src/pricing.js";
import { type Recorder, createObservedClient } from "../src/proxy.js";
import { CapturingQueue, OpenAI, asyncIterableOf } from "./fakes.js";

const chunks = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./recorded/openai_stream_chunks.json", import.meta.url)),
    "utf-8",
  ),
) as Array<Record<string, unknown>>;

function wrapInternal<T extends object>(
  client: T,
  cap: CapturingQueue,
): T {
  const adapter = detect(client);
  if (!adapter) throw new Error("no adapter");
  const recorder: Recorder = {
    adapter,
    resolver: new MetadataResolver({ tags: {} }),
    pricing: PricingEngine.default(),
    queue: cap,
  };
  return createObservedClient(client, recorder) as T;
}

describe("streaming (sync iterable)", () => {
  it("injects stream_options.include_usage when streaming", () => {
    const client = new OpenAI(() => chunks[Symbol.iterator]());
    const cap = new CapturingQueue();
    const obs = wrapInternal(client, cap);
    const stream = obs.chat.completions.create({
      model: "gpt-4o",
      messages: [],
      stream: true,
    }) as Iterable<unknown>;
    [...stream];
    const forwarded = client.chat.completions.create.lastOptions!;
    expect(forwarded.stream_options).toEqual({ include_usage: true });
  });

  it("emits usage exactly once on full consumption", () => {
    const client = new OpenAI(() => chunks[Symbol.iterator]());
    const cap = new CapturingQueue();
    const obs = wrapInternal(client, cap);
    const stream = obs.chat.completions.create({
      model: "gpt-4o",
      messages: [],
      stream: true,
    }) as Iterable<unknown>;
    const received = [...stream];
    expect(received).toHaveLength(chunks.length);
    expect(cap.events).toHaveLength(1);
    const ev = cap.events[0]!;
    expect(ev.stream).toBe(true);
    expect(ev.input_tokens).toBe(50);
    expect(ev.output_tokens).toBe(12);
    expect(ev.total_tokens).toBe(62);
    expect(ev.cost_usd as number).toBeGreaterThan(0);
  });

  it("emits exactly once on early break", () => {
    const client = new OpenAI(() => chunks[Symbol.iterator]());
    const cap = new CapturingQueue();
    const obs = wrapInternal(client, cap);
    const stream = obs.chat.completions.create({
      model: "gpt-4o",
      messages: [],
      stream: true,
    }) as Iterable<unknown>;
    let i = 0;
    for (const _chunk of stream) {
      if (i === 1) break; // early exit -> generator return -> finally -> emit
      i++;
    }
    expect(cap.events).toHaveLength(1);
    expect(cap.events[0]!.stream).toBe(true);
  });

  it("does not double-emit when re-iterated", () => {
    const client = new OpenAI(() => chunks[Symbol.iterator]());
    const cap = new CapturingQueue();
    const obs = wrapInternal(client, cap);
    const stream = obs.chat.completions.create({
      model: "gpt-4o",
      messages: [],
      stream: true,
    }) as Iterable<unknown>;
    const it = stream[Symbol.iterator]();
    while (!it.next().done) {
      /* drain */
    }
    // Exhausting again should not emit again.
    while (!it.next().done) {
      /* drain */
    }
    expect(cap.events).toHaveLength(1);
  });
});

describe("streaming (async iterable)", () => {
  it("emits usage exactly once on full async consumption", async () => {
    const client = new OpenAI(() => Promise.resolve(asyncIterableOf(chunks)));
    const cap = new CapturingQueue();
    const obs = wrapInternal(client, cap);
    const stream = (await obs.chat.completions.create({
      model: "gpt-4o",
      messages: [],
      stream: true,
    })) as AsyncIterable<unknown>;
    const out: unknown[] = [];
    for await (const chunk of stream) out.push(chunk);
    expect(out).toHaveLength(chunks.length);
    expect(cap.events).toHaveLength(1);
    expect(cap.events[0]!.output_tokens).toBe(12);
  });

  it("emits exactly once on early async break", async () => {
    const client = new OpenAI(() => Promise.resolve(asyncIterableOf(chunks)));
    const cap = new CapturingQueue();
    const obs = wrapInternal(client, cap);
    const stream = (await obs.chat.completions.create({
      model: "gpt-4o",
      messages: [],
      stream: true,
    })) as AsyncIterable<unknown>;
    let i = 0;
    for await (const _chunk of stream) {
      if (i === 1) break;
      i++;
    }
    expect(cap.events).toHaveLength(1);
  });
});
