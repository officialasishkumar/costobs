# @costobs/sdk — CostObs TypeScript/Node SDK

Drop-in AI/LLM cost observability for Node. Wrap your provider client once and
every call is measured (token counts + cost) and shipped to CostObs in the
background. The SDK mirrors the CostObs Python SDK's API surface.

## Principles

- **Network path is sacred.** The real provider call happens first. Cost
  calculation and enqueue happen after it returns; shipping is fully
  background. The SDK never adds latency to the provider call.
- **No prompt content storage.** Only token counts + metadata are sent — never
  prompt or response bodies.
- **Non-invasive.** A JS `Proxy` wraps the client and intercepts only an
  allowlist of terminal `create` methods. Everything else passes straight
  through, so the SDK survives provider SDK version churn.
- **Graceful degradation.** Unreachable ingest logs a warning and never throws
  into your app. The in-memory buffer is bounded — when full, events are
  dropped with a warning, never blocking.

## Install

```bash
npm install @costobs/sdk
```

Supported providers: `openai`, `@anthropic-ai/sdk`, `@google/genai`.

## Quickstart

```ts
import OpenAI from "openai";
import { wrap } from "@costobs/sdk";

// Wrap once. Client-level tags apply to every event.
const client = wrap(new OpenAI(), { team: "growth", environment: "prod" });

const resp = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
  // Call-site metadata — stripped before the provider ever sees it.
  costobs: { feature: "chat", promptVersion: "v3" },
});
```

The returned client has the **same type** as the one you passed in, so existing
code and types keep working unchanged.

### Configuration

`wrap()` resolves the ingest endpoint and API key from (in order): explicit
options, `configure()`, environment variables, then the default
`http://localhost:8080`.

```ts
import { configure } from "@costobs/sdk";

configure({
  ingestUrl: "https://ingest.costobs.example",
  apiKey: process.env.COSTOBS_API_KEY,
});
```

Environment variables: `COSTOBS_INGEST_URL`, `COSTOBS_API_KEY`.

### Call-site metadata

Pass a `costobs` field in the create options. It is read and **stripped** from
the options before the call is forwarded, so the provider never sees it.

```ts
await client.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 256,
  messages: [{ role: "user", content: "Hi" }],
  costobs: {
    feature: "support-bot",
    promptKey: "support/v2",
    promptVersion: "v2",
    tags: { experiment: "B" },
  },
});
```

### Request-scoped metadata (`requestContext`)

`requestContext(ctx, fn)` uses Node's `AsyncLocalStorage` to attach metadata to
every nested LLM call inside `fn` — including across `await` boundaries — and is
isolated between concurrent async flows. This is the async-propagating
equivalent of Python's ContextVar.

```ts
import { requestContext } from "@costobs/sdk";

await requestContext(
  { customerId: "cust_42", userId: "u_7", traceId: req.id },
  async () => {
    // Every wrapped call in here inherits customerId / userId / traceId.
    await client.chat.completions.create({ model: "gpt-4o", messages });
  },
);
```

#### Express middleware

```ts
import express from "express";
import { requestContext } from "@costobs/sdk";

const app = express();

app.use((req, res, next) => {
  requestContext(
    {
      customerId: req.header("x-customer-id") ?? "",
      traceId: req.header("x-request-id") ?? "",
    },
    () => next(),
  );
});
```

#### Fastify hook

```ts
import Fastify from "fastify";
import { requestContext } from "@costobs/sdk";

const app = Fastify();

app.addHook("onRequest", (req, _reply, done) => {
  requestContext(
    { customerId: req.headers["x-customer-id"] as string, traceId: req.id },
    () => done(),
  );
});
```

### Metadata precedence

`client (wrap options) < requestContext < call-site (costobs field)` — later
wins. `null`/`undefined` values are dropped at every layer.

### Streaming

Streaming works transparently. The SDK tees usage out of the chunk stream as it
flows and emits exactly one event when the stream completes **or** is broken
early. For OpenAI it injects `stream_options: { include_usage: true }` (unless
you set `stream_options` yourself) so the final chunk carries token counts.

```ts
const stream = await client.chat.completions.create({
  model: "gpt-4o",
  messages,
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
// One event is emitted here, on stream completion.
```

### Lifecycle

```ts
import { flush, shutdown } from "@costobs/sdk";

await flush();    // block until buffered events are shipped (best effort)
await shutdown(); // drain + stop background timers (idempotent)
```

A best-effort drain is also registered on `beforeExit` and `SIGTERM`.

## Pricing

Costs are computed locally from a bundled, versioned pricing file
(`pricing-v2026.06.yaml`) using `decimal.js` for exact decimal arithmetic — JS
floats lose precision and that is unacceptable for money. The pricing version
is stamped onto every event as `pricing_version`; the backend may recompute.

## Development

```bash
npm install
npm run build      # ESM + CJS + types via tsup (bundles the pricing file)
npm test           # vitest, fully offline
npm run typecheck
```

See `examples/quickstart.ts` for a runnable end-to-end demo (works offline with
a fake client; point it at the local stack with the dev key
`costobs_dev_secret_key`).
