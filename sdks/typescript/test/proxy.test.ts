import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { shutdown, wrap } from "../src/wrap.js";
import { CapturingQueue, OpenAI } from "./fakes.js";

const chatResp = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./recorded/openai_chat.json", import.meta.url)),
    "utf-8",
  ),
);

afterEach(async () => {
  await shutdown(500);
});

describe("proxy", () => {
  it("passes through unknown properties and methods", () => {
    const client = new OpenAI(() => chatResp);
    const obs = wrap(client, { apiKey: "k" });
    expect(obs.api_key).toBe("sk-test");
    expect(obs.somePassthroughMethod()).toBe("passthrough-ok");
  });

  it("intercepts the terminal create call and builds an event", () => {
    const client = new OpenAI(() => chatResp);
    const cap = new CapturingQueue();
    const obs = wrapInternal(client, cap, { team: "t", environment: "test" });
    const resp = obs.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(resp).toBe(chatResp);
    expect(cap.events).toHaveLength(1);
    const ev = cap.events[0]!;
    expect(ev.provider).toBe("openai");
    expect(ev.model).toBe("gpt-4o");
    expect(ev.operation).toBe("chat");
    expect(ev.team).toBe("t");
    expect(ev.input_tokens).toBe(400); // 1200 prompt - 800 cached
    expect(ev.cached_input_tokens).toBe(800);
    expect(ev.output_tokens).toBe(300);
    expect(ev.cost_usd as number).toBeGreaterThan(0);
    expect(ev.pricing_version).toBe("2026.06");
    expect(ev.sdk_lang).toBe("typescript");
  });

  it("strips the costobs field before forwarding to the provider", () => {
    const client = new OpenAI(() => chatResp);
    const cap = new CapturingQueue();
    const obs = wrapInternal(client, cap, {});
    obs.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      costobs: {
        feature: "search",
        promptKey: "pk1",
        promptVersion: "v3",
        tags: { exp: "B" },
      },
    });
    const forwarded = client.chat.completions.create.calls.at(-1)!;
    expect("costobs" in forwarded).toBe(false);
    expect(forwarded.model).toBe("gpt-4o");

    const ev = cap.events.at(-1)!;
    expect(ev.feature).toBe("search");
    expect(ev.prompt_key).toBe("pk1");
    expect(ev.prompt_version).toBe("v3");
    expect((ev.tags as Record<string, string>).exp).toBe("B");
  });

  it("returns the provider response before any enqueue (network path sacred)", () => {
    const order: string[] = [];
    const client = new OpenAI(() => {
      order.push("provider_returned");
      return chatResp;
    });
    const orderQueue = {
      enqueue() {
        order.push("enqueued");
      },
    };
    const obs = wrapInternal(client, orderQueue, {});
    obs.chat.completions.create({ model: "gpt-4o", messages: [] });
    expect(order).toEqual(["provider_returned", "enqueued"]);
  });

  it("emits an error event when the provider throws", () => {
    const client = new OpenAI(() => {
      throw new TypeError("provider down");
    });
    const cap = new CapturingQueue();
    const obs = wrapInternal(client, cap, {});
    expect(() =>
      obs.chat.completions.create({ model: "gpt-4o", messages: [] }),
    ).toThrow("provider down");
    expect(cap.events).toHaveLength(1);
    expect(cap.events[0]!.status).toBe("error");
    expect(cap.events[0]!.error_type).toBe("TypeError");
  });

  it("rejects an unknown client", () => {
    expect(() => wrap({ foo: "bar" } as object)).toThrow(/could not detect/);
  });
});

// --- internal helper: wrap then swap in a capturing queue via the proxy ---
// The proxy stores its recorder in a closure; we reach it by wrapping and then
// reading the shared recorder through a known test seam on the queue. Since
// wrap() shares a TelemetryQueue per (url,key), we instead inject the queue by
// constructing the recorder path directly through a dedicated test export.
import { detect } from "../src/adapters/base.js";
import { MetadataResolver } from "../src/metadata.js";
import { PricingEngine } from "../src/pricing.js";
import { createObservedClient } from "../src/proxy.js";

function wrapInternal<T extends object>(
  client: T,
  queue: { enqueue: (ev: Record<string, unknown>) => void },
  meta: { team?: string; environment?: string; service?: string },
): T {
  const adapter = detect(client);
  if (!adapter) throw new Error("no adapter");
  const resolver = new MetadataResolver({
    environment: meta.environment,
    team: meta.team,
    service: meta.service,
    tags: {},
  });
  const recorder = {
    adapter,
    resolver,
    pricing: PricingEngine.default(),
    queue: queue as { enqueue: (ev: Record<string, unknown>) => void },
  };
  return createObservedClient(client, recorder) as T;
}
