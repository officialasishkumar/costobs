import { describe, expect, it } from "vitest";
import { requestContext } from "../src/context.js";
import { MetadataResolver } from "../src/metadata.js";

describe("metadata precedence", () => {
  it("call-site wins over request-context wins over client", () => {
    const resolver = new MetadataResolver({ environment: "dev", team: "core" });
    let merged!: ReturnType<MetadataResolver["merge"]>;
    requestContext({ customerId: "cust-1", traceId: "t-1" }, () => {
      merged = resolver.merge({ environment: "prod", feature: "chat" });
    });
    expect(merged.environment).toBe("prod"); // call-site overrides client
    expect(merged.team).toBe("core"); // client preserved
    expect(merged.customer_id).toBe("cust-1"); // request-context layer
    expect(merged.trace_id).toBe("t-1");
    expect(merged.feature).toBe("chat");
  });

  it("null/undefined values are dropped", () => {
    const resolver = new MetadataResolver({ environment: "dev", service: undefined });
    const merged = resolver.merge({ team: undefined, feature: "x" });
    expect(merged.service ?? "").toBe("");
    expect(merged.team ?? "").toBe("");
    expect(merged.feature).toBe("x");
  });

  it("tags merge and call-site tags win", () => {
    const resolver = new MetadataResolver({
      environment: "dev",
      tags: { region: "us" },
    });
    let merged!: ReturnType<MetadataResolver["merge"]>;
    requestContext({ tier: "gold" }, () => {
      merged = resolver.merge({ tags: { region: "eu", exp: "A" } });
    });
    expect(merged.tags.region).toBe("eu"); // call-site tag wins
    expect(merged.tags.tier).toBe("gold"); // request-context extra became a tag
    expect(merged.tags.exp).toBe("A");
  });

  it("request context resets after the callback returns", () => {
    const resolver = new MetadataResolver({});
    requestContext({ customerId: "x" }, () => {});
    const merged = resolver.merge({});
    expect(merged.customer_id ?? "").toBe("");
  });

  it("camelCase call-site aliases map to snake_case fields", () => {
    const resolver = new MetadataResolver({});
    const merged = resolver.merge({ promptVersion: "v9", promptKey: "pk" });
    expect(merged.prompt_version).toBe("v9");
    expect(merged.prompt_key).toBe("pk");
  });
});

describe("AsyncLocalStorage propagation", () => {
  it("propagates across an await boundary", async () => {
    const resolver = new MetadataResolver({});
    const seen: Record<string, unknown> = {};

    async function inner(): Promise<void> {
      await new Promise((r) => setTimeout(r, 0)); // cross an await boundary
      Object.assign(seen, resolver.merge({}));
    }

    await requestContext(
      { customerId: "async-cust", userId: "u9" },
      async () => {
        await inner();
      },
    );

    expect(seen.customer_id).toBe("async-cust");
    expect(seen.user_id).toBe("u9");
  });

  it("isolates concurrent async flows", async () => {
    const resolver = new MetadataResolver({});
    const results: Record<string, string | undefined> = {};

    const task = (name: string): Promise<void> =>
      requestContext({ customerId: name }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        results[name] = resolver.merge({}).customer_id;
      });

    await Promise.all([task("a"), task("b"), task("c")]);
    expect(results).toEqual({ a: "a", b: "b", c: "c" });
  });
});

describe("openai-compatible provider detection", () => {
  it("maps baseURL hosts to provider names", async () => {
    const { OpenAIAdapter } = await import("../src/adapters/openai.js");
    const adapter = new OpenAIAdapter();
    const cases: Array<[string, string]> = [
      ["https://api.x.ai/v1", "xai"],
      ["https://api.together.xyz/v1", "together"],
      ["https://api.fireworks.ai/inference/v1", "fireworks"],
      ["https://openrouter.ai/api/v1", "openrouter"],
      ["https://api.groq.com/openai/v1", "groq"],
      ["https://api.deepseek.com/v1", "deepseek"],
      ["https://api.mistral.ai/v1", "mistral"],
      ["https://myorg.openai.azure.com/", "azure-openai"],
      ["https://api.openai.com/v1", "openai"],
    ];
    for (const [url, expected] of cases) {
      expect(adapter.providerFor({ baseURL: url })).toBe(expected);
    }
  });
});
