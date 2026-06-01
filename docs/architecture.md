# CostObs Architecture

CostObs is an open-source, **fully self-hostable** AI/LLM cost observability
platform. It attributes every LLM/provider request to a cost and a set of
business dimensions (customer, feature, team, environment, prompt version) so
you can answer "what is this costing us, and where is it going?" — without ever
shipping your data to a third party.

## Component diagram

```
                          YOUR APPLICATION PROCESS
        ┌────────────────────────────────────────────────────────┐
        │  app code                                                │
        │     │ client = costobs.wrap(OpenAI(), team=..., ...)     │
        │     ▼                                                    │
        │  ┌───────────────┐   1. REAL CALL (synchronous)          │
        │  │ CostObs SDK    │ ───────────────────────────────────────────►  LLM PROVIDER
        │  │ (thin wrapper) │ ◄───────────────────────────────────────────  (OpenAI / Anthropic /
        │  └───────────────┘   provider response (usage tokens)    │         Gemini / ...)
        │     │                                                    │
        │     │ 2. cost calc from LOCAL pricing file (sync, fast)  │
        │     │ 3. build telemetry event (NO prompt/response body) │
        │     ▼                                                    │
        │  ┌───────────────┐                                       │
        │  │ background     │   4. async batched POST (OFF hot path)│
        │  │ ship queue     │ ─────────┐                            │
        │  └───────────────┘          │                            │
        └─────────────────────────────┼────────────────────────────┘
                                       │ POST /v1/events  (Bearer API key)
                                       ▼
                         ┌──────────────────────────┐
                         │  ingest  (Go, :8080)      │  auth (Postgres api_keys, argon2id)
                         │  validate → dedup → batch │  dedup by request_id (ULID)
                         └─────────────┬─────────────┘
                          batched INSERT│         ▲ ping (healthz)
                                        ▼         │
                ┌───────────────────────────┐   ┌─┴───────────────────────────┐
                │  ClickHouse                │   │  Postgres                    │
                │  events (MergeTree)        │   │  orgs, users, memberships,   │
                │  + materialized rollups:   │   │  api_keys, alert_rules,      │
                │   cost_daily               │   │  alert_targets, dashboards,  │
                │   cost_attr_hourly         │   │  pricing_overrides           │
                │   prompt_version_daily     │   │  (metadata = source of truth)│
                └───────────┬───────────────┘   └──────────────┬───────────────┘
                            │ HTTP :8123 (reads)                │ reads/writes
                            ▼                                   ▼
                ┌───────────────────────────────────────────────────────────┐
                │  dashboard  (Next.js, :3000)   UI + read API                │
                │  org-scoped queries; auth: none | oidc                      │
                └───────────────────────────────────────────────────────────┘

                ┌───────────────────────────┐
                │  alertd  (Go, :8081)       │  periodic evaluator (singleton)
                │  reads alert_rules (PG),   │  thresholds/spike/budget over
                │  aggregates from ClickHouse│  ClickHouse rollups; fires
                │  → webhook / slack targets │  webhook/slack on breach
                └───────────────────────────┘
```

## Data flow

1. **Real provider call (synchronous).** `costobs.wrap()` returns a transparent
   proxy around your provider client. Your call goes **directly** to the
   provider over your own network path. CostObs never proxies, intercepts, or
   sits inline with provider traffic.
2. **Local cost calc (synchronous, microseconds).** From the provider response
   the SDK reads the usage counters (input/cached/output/reasoning tokens, audio
   seconds, image tiles) and multiplies by rates from a **local, versioned
   pricing file** (see [pricing.md](pricing.md)). All money math uses `Decimal`.
3. **Event construction.** The SDK assembles a telemetry event matching the wire
   contract (`shared/proto/event.schema.json`). It contains counters, the
   computed `cost_usd`, the `pricing_version`, and attribution dimensions —
   **never prompt or response content.**
4. **Async batched ship (off the hot path).** Events go to a background queue
   and are POSTed in batches to `ingest` `/v1/events`. If ingest is slow or
   down, your request path is unaffected; the SDK degrades to dropping/logging.
5. **Ingest.** Authenticates the Bearer API key against Postgres (`api_keys`,
   argon2id hashes), stamps the resolved `org_id`, dedups by `request_id`
   (client-generated ULID, 5-minute window), buffers, and bulk-INSERTs into
   ClickHouse. ClickHouse **materialized views** maintain pre-aggregated rollups
   on write.
6. **Dashboard.** Reads org-scoped aggregates from ClickHouse over its HTTP
   interface (:8123) and metadata from Postgres. All ClickHouse queries are
   parameterized — org isolation and tag filters are injection-safe by
   construction.
7. **alertd.** A singleton periodic worker. It loads `alert_rules` from Postgres,
   evaluates them against ClickHouse aggregates on an interval
   (`COSTOBS_EVAL_INTERVAL`), and dispatches to webhook/slack targets with
   cooldowns.

## The two storage layers (and why)

| Layer | Store | Holds | Why |
| --- | --- | --- | --- |
| **Events / time-series** | **ClickHouse** | the `events` fact table + `cost_daily`, `cost_attr_hourly`, `prompt_version_daily` materialized rollups | Columnar, compresses high-cardinality event streams, and answers `GROUP BY time/customer/feature/model` aggregations over millions of rows in milliseconds. Partitioned by month, TTL 180 days. |
| **Metadata** | **Postgres** | orgs, users, memberships, `api_keys`, `alert_rules`, `alert_targets`, `dashboards`, `pricing_overrides` | Relational, transactional, the **source of truth** for identity, auth, and configuration. `orgs.slug` equals the ClickHouse `org_id`, tying the two layers together. |

ClickHouse is the analytical firehose; Postgres is the small, consistent
control plane. Neither is optional, but both can be **bundled single-node** (this
chart) or **external/managed** (BYO) — see [self-hosting.md](self-hosting.md).

## Wire contract (summary)

The SDK→ingest contract is `shared/proto/event.schema.json`. Field names map
1:1 to ClickHouse `events` columns. Highlights:

- **Identity/time:** `request_id` (ULID, dedup key), `ts` (RFC3339 UTC, ms).
- **What ran:** `provider`, `model`, `operation` (chat|embedding|audio|image|tool|responses), `stream`, `status`, `error_type`.
- **Attribution:** `environment`, `team`, `service`, `customer_id`, `user_id`, `trace_id`, `feature`, `prompt_key`, `prompt_version`, `tags` (string map).
- **Usage counters:** `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_tokens`, `tool_tokens`, `total_tokens`, `audio_seconds`, `image_count`, `image_tiles`.
- **Money:** `cost_usd` (SDK-computed, backend may recompute), `pricing_version`.
- **Provenance:** `latency_ms`, `sdk_lang`, `sdk_version`.
- `additionalProperties: false`, and **there is no field for prompt or response text.**

## Key principles

1. **The network path is sacred.** The SDK never sits inline with provider
   traffic. Telemetry is computed locally and shipped asynchronously; observing
   cost must never add latency or a failure mode to your product requests.
2. **The database is the truth.** Postgres holds identity/config; ClickHouse
   holds the immutable event record. Rollups are derived, never authoritative.
3. **No prompt content storage.** The wire schema has no slot for prompt or
   completion bodies. CostObs measures cost and shape, not content.
4. **Self-hosting is first-class.** Both Mode A (compose) and Mode B (this Helm
   chart) run **fully offline**: no required external calls, no licensing
   checks, no phone-home telemetry, no mandatory cloud dependency.
5. **Observability of the observer.** Every service exposes Prometheus
   `/metrics` and a `/healthz` endpoint, so you can monitor CostObs itself with
   the same tooling you use for everything else.
