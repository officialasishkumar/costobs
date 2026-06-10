import { describe, expect, it, vi } from "vitest";

const recordCalls: Array<Record<string, unknown>> = [];
vi.mock("../src/record.js", () => ({
  record: (opts: Record<string, unknown>) => {
    recordCalls.push(opts);
  },
}));
import { MetadataResolver } from "../src/metadata.js";
import { PricingEngine } from "../src/pricing.js";
import { type Recorder, createObservedClient } from "../src/proxy.js";
import { makeUsage } from "../src/schema.js";
import { CapturingQueue } from "./fakes.js";

describe("pricing: characters unit", () => {
  it("prices TTS characters via per_character", () => {
    const engine = PricingEngine.default();
    const cost = engine.cost(
      makeUsage({ characters: 1000 }),
      "elevenlabs",
      "eleven_multilingual_v2",
      { operation: "audio" },
    );
    expect(cost.toNumber()).toBeCloseTo(0.3, 9);
  });

  it("prices Bedrock model ids", () => {
    const engine = PricingEngine.default();
    const cost = engine.cost(
      makeUsage({ input_tokens: 1000, output_tokens: 100 }),
      "bedrock",
      "anthropic.claude-sonnet-4-6-v1:0",
      {},
    );
    expect(cost.toNumber()).toBeCloseTo(1000 * 0.000003 + 100 * 0.000015, 12);
  });
});

describe("bedrock adapter", () => {
  it("intercepts send() and parses converse usage", async () => {
    const { BedrockAdapter } = await import("../src/adapters/bedrock.js");
    const adapter = new BedrockAdapter();

    class BedrockRuntimeClient {
      async send(_command: unknown) {
        return {
          output: { message: { content: [] } },
          usage: {
            inputTokens: 1000,
            outputTokens: 100,
            totalTokens: 1100,
            cacheReadInputTokens: 50,
            cacheWriteInputTokens: 10,
          },
        };
      }
    }
    const client = new BedrockRuntimeClient();
    expect(adapter.detect(client)).toBe(true);

    const cap = new CapturingQueue();
    const recorder: Recorder = {
      adapter,
      resolver: new MetadataResolver({ tags: {} }),
      pricing: PricingEngine.default(),
      queue: cap,
      provider: "bedrock",
    };
    const obs = createObservedClient(client, recorder) as BedrockRuntimeClient;
    await obs.send({
      input: { modelId: "anthropic.claude-sonnet-4-6-v1:0", messages: [] },
    });

    expect(cap.events).toHaveLength(1);
    const ev = cap.events[0]!;
    expect(ev.provider).toBe("bedrock");
    expect(ev.model).toBe("anthropic.claude-sonnet-4-6-v1:0");
    expect(ev.input_tokens).toBe(1010); // cache writes billed as input
    expect(ev.cached_input_tokens).toBe(50);
    expect(ev.output_tokens).toBe(100);
    expect(ev.cost_usd as number).toBeGreaterThan(0);
  });
});

describe("vercel ai sdk helpers", () => {
  it("trackGenerateText reads v5 usage and guesses the provider", async () => {
    const { trackGenerateText } = await import("../src/vercel.js");
    recordCalls.length = 0;

    const result = await trackGenerateText(
      Promise.resolve({
        text: "hi",
        usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
        response: { modelId: "gpt-4o-mini" },
      }),
      { feature: "summarize" },
    );
    expect(result.text).toBe("hi");
    expect(recordCalls).toHaveLength(1);
    const call = recordCalls[0]!;
    expect(call.provider).toBe("openai");
    expect(call.model).toBe("gpt-4o-mini");
    expect(call.input_tokens).toBe(12);
    expect(call.output_tokens).toBe(7);
    expect(call.feature).toBe("summarize");
    expect(call.status).toBe("ok");
  });

  it("trackGenerateText reads v4 usage field names", async () => {
    const { trackGenerateText } = await import("../src/vercel.js");
    recordCalls.length = 0;

    await trackGenerateText(
      Promise.resolve({
        usage: { promptTokens: 5, completionTokens: 3 },
        response: { modelId: "claude-haiku-4-5" },
      }),
    );
    const call = recordCalls[0]!;
    expect(call.provider).toBe("anthropic");
    expect(call.input_tokens).toBe(5);
    expect(call.output_tokens).toBe(3);
  });

  it("trackStreamText emits when the usage promise resolves", async () => {
    const { trackStreamText } = await import("../src/vercel.js");
    recordCalls.length = 0;

    const stream = {
      usage: Promise.resolve({ inputTokens: 8, outputTokens: 4 }),
      response: Promise.resolve({ modelId: "gpt-4o" }),
      textStream: (async function* () {
        yield "chunk";
      })(),
    };
    const returned = trackStreamText(stream, { customer_id: "cust-1" });
    expect(returned).toBe(stream);
    await new Promise((r) => setTimeout(r, 0));
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0]!.model).toBe("gpt-4o");
    expect(recordCalls[0]!.customer_id).toBe("cust-1");
    expect(recordCalls[0]!.stream ?? false).toBe(false);
  });
});
