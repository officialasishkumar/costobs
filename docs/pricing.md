# Pricing

CostObs computes the cost of every request from a **single, versioned pricing
file** that is the source of truth for both the SDK (synchronous, on-device cost
calc) and the backend (reconciliation). Prices are in USD.

- Pricing data: `shared/pricing/pricing-v2026.06.yaml`
- Schema: `shared/pricing/schema.json`
- The SDK ships a copy of the pricing file inside its package
  (`sdks/python/costobs/data/pricing-v<version>.yaml`).

## How the versioned file works

The file has a top-level `version` (e.g. `"2026.06"`) and a `models` array.
The `version` string is stamped onto **every** event as `pricing_version`, so a
cost is always traceable to the exact rate card that produced it. Because both
the SDK and backend read the same file format, an event's `cost_usd` can be
independently recomputed and reconciled later.

```yaml
version: "2026.06"
currency: USD
models:
  - provider: openai
    model: gpt-4o
    match: prefix
    input_per_token: 0.0000025
    cached_input_per_token: 0.00000125
    output_per_token: 0.00001
    image_tiers:
      - { name: default, per_tile: 0.000213, base: 0.0 }
```

> **Per-token, not per-1M.** Rates are per single token deliberately, so the SDK
> hot path is one multiply per counter — no `/1_000_000` scaling that invites
> off-by-1e6 bugs. All arithmetic uses decimal (exact) math, never float.

## Field semantics

Each entry in `models`:

| Field | Meaning |
| --- | --- |
| `provider`, `model` | Identify the rule. `model` is an exact id or a prefix. |
| `match` | `exact` (default) or `prefix`. Prefix lets one rule cover `gpt-4o`, `gpt-4o-2024-...`, etc. |
| `operation` | `chat` (default), `embedding`, `audio`, `image`, ... — disambiguates models that price differently per operation. |
| `input_per_token` | Per input (prompt) token. |
| `cached_input_per_token` | Discounted rate applied to `cached_input_tokens` (prompt-cache hits). |
| `output_per_token` | Per output (completion) token. |
| `reasoning_per_token` | Per reasoning token. If **absent**, reasoning tokens are billed at the output rate. |
| `tool_per_token` | Per tool token, where the provider bills tool usage by tokens. |
| `image_tiers[]` | Per-image pricing by resolution tier: `per_tile` × tiles, plus an optional flat `base` per image. |
| `audio_per_second` | Per second of audio (transcription/TTS models). |
| `batch_discount` | Multiplier for the Batch API, e.g. `0.5` = 50% off. |
| `finetune_surcharge` | Multiplier for fine-tuned variants, e.g. `1.5`. Must be ≥ 1. |

`schema.json` (`additionalProperties: false`) enforces this shape and is how you
validate edits.

## Match resolution

Given an event's `(provider, model, operation)`, the resolver picks a rule by:

1. Filter to the same `provider` and `operation`.
2. Prefer an `exact` model match.
3. Otherwise the longest matching `prefix` rule wins (most specific).

This is why a generic `gpt-4o` prefix rule and a more specific exact rule can
coexist — the exact/longer match takes precedence.

## SDK (synchronous) vs. backend reconciliation

- **SDK — synchronous.** At wrap time the pricing file is loaded once into
  memory. After a provider call returns, the SDK reads the usage counters,
  resolves the matching rule, and computes `cost_usd` locally in microseconds,
  then stamps `pricing_version`. This keeps cost attribution **off the network
  hot path** — no backend round trip is needed to know the cost.
- **Backend — reconciliation + per-org overrides.** The ingest/backend side can
  recompute or adjust cost authoritatively. Postgres has a
  `pricing_overrides` table keyed by `(org_id, provider, model, effective_at)`
  holding a `pricing` JSON blob. This lets an org apply **negotiated/enterprise
  rates** or correct a rate retroactively without touching the shared file. The
  per-org override takes precedence over the bundled rate card for that org.

So: the SDK gives you an immediate, good-enough cost using the published rate
card; the backend gives you an authoritative, org-specific cost using overrides.
Both are anchored by the `pricing_version` recorded on the event.

## Updating pricing without an SDK release

The pricing data is just YAML — you do **not** need to cut an SDK release to
change rates.

1. Edit `shared/pricing/pricing-v<version>.yaml` (add models, change rates).
2. **Bump `version`** (e.g. `2026.06` → `2026.07`) so new events are stamped
   with the new rate card and remain distinguishable from old ones.
3. Validate against `shared/pricing/schema.json`.
4. Roll it out:
   - **Backend / reconciliation:** ship the updated file with the backend; new
     and recomputed costs use it immediately.
   - **SDKs:** SDKs bundle a copy for offline synchronous calc. Either publish
     the new file with the next SDK build, or — for an org that needs a custom
     rate *now* — add a row to `pricing_overrides` so the backend reconciles to
     the correct cost regardless of the SDK's bundled version.

Because every event carries its `pricing_version`, historical costs stay
reproducible: you always know which rate card produced a given number.
