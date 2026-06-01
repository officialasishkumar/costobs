import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { PricingEngine } from "../src/pricing.js";
import { makeUsage } from "../src/schema.js";

const engine = new PricingEngine();

describe("pricing", () => {
  it("loads the bundled pricing version", () => {
    expect(engine.pricingVersion).toBe("2026.06");
  });

  it("gpt-4o input + output (prefix match)", () => {
    const usage = makeUsage({ input_tokens: 1000, output_tokens: 500 });
    const cost = engine.cost(usage, "openai", "gpt-4o-2024-08-06");
    const expected = new Decimal("0.0000025")
      .times(1000)
      .plus(new Decimal("0.00001").times(500));
    expect(cost.equals(expected)).toBe(true);
    expect(cost.equals(new Decimal("0.0075"))).toBe(true);
  });

  it("gpt-4o cached tokens billed at discounted rate", () => {
    const usage = makeUsage({
      input_tokens: 400,
      cached_input_tokens: 800,
      output_tokens: 300,
    });
    const cost = engine.cost(usage, "openai", "gpt-4o");
    const expected = new Decimal("0.0000025")
      .times(400)
      .plus(new Decimal("0.00000125").times(800))
      .plus(new Decimal("0.00001").times(300));
    expect(cost.equals(expected)).toBe(true);
  });

  it("o3 explicit reasoning rate", () => {
    const usage = makeUsage({
      input_tokens: 500,
      output_tokens: 2000,
      reasoning_tokens: 1800,
    });
    const cost = engine.cost(usage, "openai", "o3-mini");
    const expected = new Decimal("0.000002")
      .times(500)
      .plus(new Decimal("0.000008").times(2000))
      .plus(new Decimal("0.000008").times(1800));
    expect(cost.equals(expected)).toBe(true);
  });

  it("reasoning falls back to output rate when not specified", () => {
    const usage = makeUsage({ reasoning_tokens: 100 });
    const cost = engine.cost(usage, "openai", "gpt-4o");
    expect(cost.equals(new Decimal("0.00001").times(100))).toBe(true);
  });

  it("prefix match for anthropic with cache reads", () => {
    const usage = makeUsage({
      input_tokens: 400,
      cached_input_tokens: 1000,
      output_tokens: 250,
    });
    const cost = engine.cost(usage, "anthropic", "claude-sonnet-4-20250514");
    const expected = new Decimal("0.000003")
      .times(400)
      .plus(new Decimal("0.0000003").times(1000))
      .plus(new Decimal("0.000015").times(250));
    expect(cost.equals(expected)).toBe(true);
  });

  it("batch discount multiplier", () => {
    const eng = new PricingEngine(`
version: "test"
models:
  - provider: openai
    model: batch-model
    match: exact
    input_per_token: 0.000001
    output_per_token: 0.000002
    batch_discount: 0.5
`);
    const usage = makeUsage({ input_tokens: 1000, output_tokens: 1000 });
    const full = eng.cost(usage, "openai", "batch-model");
    const discounted = eng.cost(usage, "openai", "batch-model", { batch: true });
    expect(discounted.equals(full.times(new Decimal("0.5")))).toBe(true);
  });

  it("finetune surcharge multiplier", () => {
    const eng = new PricingEngine(`
version: "test"
models:
  - provider: openai
    model: ft-model
    match: exact
    input_per_token: 0.000001
    output_per_token: 0.000002
    finetune_surcharge: 1.5
`);
    const usage = makeUsage({ input_tokens: 1000, output_tokens: 1000 });
    const base = eng.cost(usage, "openai", "ft-model");
    const surcharged = eng.cost(usage, "openai", "ft-model", { finetuned: true });
    expect(surcharged.equals(base.times(new Decimal("1.5")))).toBe(true);
  });

  it("audio per second", () => {
    const usage = makeUsage({ audio_seconds: 60 });
    const cost = engine.cost(usage, "deepgram", "nova-3", { operation: "audio" });
    expect(cost.equals(new Decimal("0.0000071").times(new Decimal("60")))).toBe(
      true,
    );
  });

  it("image tiles", () => {
    const usage = makeUsage({ image_count: 2, image_tiles: 4 });
    const cost = engine.cost(usage, "openai", "gpt-4o");
    expect(cost.equals(new Decimal("0.000213").times(4))).toBe(true);
  });

  it("unknown model returns zero", () => {
    const usage = makeUsage({ input_tokens: 1000 });
    expect(engine.cost(usage, "openai", "does-not-exist").equals(0)).toBe(true);
  });

  it("exact match beats prefix", () => {
    const eng = new PricingEngine(`
version: "test"
models:
  - provider: openai
    model: gpt
    match: prefix
    input_per_token: 0.001
    output_per_token: 0.0
  - provider: openai
    model: gpt-special
    match: exact
    input_per_token: 0.002
    output_per_token: 0.0
`);
    const usage = makeUsage({ input_tokens: 100 });
    expect(
      eng.cost(usage, "openai", "gpt-special").equals(new Decimal("0.002").times(100)),
    ).toBe(true);
  });
});
