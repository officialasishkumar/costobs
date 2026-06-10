# Billing sync & invoice reconciliation

CostObs tracks cost two ways:

1. **Tracked** — the SDK computes an estimate locally for every observed call
   (tokens × pricing file) and ships it to ingest. This is per-request and
   attributable, but it is an *estimate*, and it only covers instrumented code.
2. **Billed** — `billsyncd` pulls the *actual* daily cost from provider admin
   APIs into the ClickHouse `billed_daily` table.

The dashboard's **Reconciliation** page compares the two per provider and per
day, surfacing:

- **Drift** — billed vs tracked per provider (ok < 2%, warn < 10%, alert
  above). Persistent drift means pricing-file skew or missing token kinds.
- **Untracked spend** — billed cost with no corresponding SDK events: traffic
  outside your instrumentation (consoles, scripts, another team's keys).

## Enabling billsyncd

billsyncd is **off by default** and is the *only* CostObs component that makes
outbound network calls. Everything else stays fully offline. Enable it per
provider by setting an admin key in `.env`:

```bash
# OpenAI: an Admin API key with api.usage.read (Costs API)
COSTOBS_BILLING_OPENAI_ADMIN_KEY=sk-admin-...

# Anthropic: an Admin API key (Cost Report API)
COSTOBS_BILLING_ANTHROPIC_ADMIN_KEY=sk-ant-admin-...
```

Then `docker compose up -d billsyncd`. It syncs on boot and every
`COSTOBS_SYNC_INTERVAL` (default `6h`), upserting the last
`COSTOBS_SYNC_LOOKBACK_DAYS` (default 30) days. Re-syncs are idempotent
(`ReplacingMergeTree` keyed on sync time).

| Env var | Default | Meaning |
| --- | --- | --- |
| `COSTOBS_CLICKHOUSE_DSN` | — (required) | ClickHouse native DSN |
| `COSTOBS_ORG_SLUG` | `default` | Org the rows are attributed to |
| `COSTOBS_SYNC_INTERVAL` | `6h` | Sync cadence |
| `COSTOBS_SYNC_LOOKBACK_DAYS` | `30` | Days re-fetched each sync |
| `COSTOBS_HTTP_ADDR` | `:8082` | /healthz + /metrics listener |
| `COSTOBS_BILLING_OPENAI_ADMIN_KEY` | unset | Enables the OpenAI fetcher |
| `COSTOBS_BILLING_ANTHROPIC_ADMIN_KEY` | unset | Enables the Anthropic fetcher |
| `COSTOBS_BILLING_OPENAI_BASE_URL` | `https://api.openai.com` | Override for proxies/mirrors |
| `COSTOBS_BILLING_ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Override for proxies/mirrors |

## Manual import (air-gapped / unsupported providers)

`billed_daily` is just a table — import a CSV of any provider's invoice
without running billsyncd at all:

```sql
INSERT INTO billed_daily (org_id, provider, date, billed_usd, source)
VALUES ('default', 'gemini', '2026-06-01', 12.34, 'import');
```

Rows with the same `(org_id, provider, date)` replace older ones, so
corrections are safe to re-import.
