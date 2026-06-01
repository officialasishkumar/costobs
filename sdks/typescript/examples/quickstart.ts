/**
 * CostObs TypeScript SDK quickstart — runnable offline against the local stack.
 *
 * Run:  npx tsx examples/quickstart.ts
 *
 * If COSTOBS_API_KEY / a real OpenAI client are not configured, this uses a
 * fake provider client so the full loop (wrap -> call -> cost calc -> enqueue
 * -> ship) runs end to end without any network calls leaving your machine.
 *
 * Against the local stack, point it at the ingest service with the dev key:
 *   COSTOBS_INGEST_URL=http://localhost:8080 \
 *   COSTOBS_API_KEY=costobs_dev_secret_key \
 *   npx tsx examples/quickstart.ts
 */

import { configure, flush, requestContext, shutdown, wrap } from "../src/index.js";

// ---- A fake OpenAI-shaped client (constructor name drives detection) ----
class OpenAI {
  chat = {
    completions: {
      create: (_opts: Record<string, unknown>) => ({
        id: "chatcmpl-demo",
        model: "gpt-4o-2024-08-06",
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 300,
          total_tokens: 1500,
          prompt_tokens_details: { cached_tokens: 800 },
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      }),
    },
  };
  embeddings = { create: (_opts: Record<string, unknown>) => ({ usage: {} }) };
}

async function main(): Promise<void> {
  // Dev defaults for the local stack. Env vars override these.
  configure({
    ingestUrl: process.env.COSTOBS_INGEST_URL ?? "http://localhost:8080",
    apiKey: process.env.COSTOBS_API_KEY ?? "costobs_dev_secret_key",
    flushIntervalMs: 250,
  });

  // 1. Wrap the provider client once. Client-level tags apply to every event.
  const client = wrap(new OpenAI(), {
    team: "growth",
    environment: "prod",
    service: "quickstart",
  });

  // 2. A plain call. Cost is computed locally and shipped in the background;
  //    the provider call always returns first.
  const resp = client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: "Say hi" }],
    // Call-site metadata: stripped before the provider ever sees it.
    costobs: { feature: "greeting", promptVersion: "v3" },
  });
  console.log("provider response id:", (resp as { id: string }).id);

  // 3. requestContext attaches per-request metadata to every nested LLM call,
  //    propagating across awaits (AsyncLocalStorage).
  await requestContext(
    { customerId: "cust_42", traceId: "trace_abc" },
    async () => {
      client.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: "And again" }],
        costobs: { feature: "followup" },
      });
      await Promise.resolve();
    },
  );

  // 4. Drain telemetry before exit (flush) and stop background timers (shutdown).
  await flush(2000);
  await shutdown(2000);
  console.log("done — sent 2 events to", process.env.COSTOBS_INGEST_URL ?? "http://localhost:8080");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
