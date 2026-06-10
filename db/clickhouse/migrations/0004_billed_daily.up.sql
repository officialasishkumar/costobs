-- Actual billed cost per provider per day, synced from provider admin APIs by
-- billsyncd (or imported manually). ReplacingMergeTree keyed on synced_at so
-- re-syncs upsert. Readers must aggregate with argMax(billed_usd, synced_at)
-- or query with FINAL. NOTE: never put a semicolon inside comments here —
-- migrate's multi-statement splitter cuts on every semicolon it sees.
CREATE TABLE IF NOT EXISTS billed_daily
(
    org_id     LowCardinality(String),
    provider   LowCardinality(String),
    date       Date,
    billed_usd Decimal(18, 6),
    source     LowCardinality(String) DEFAULT 'api',
    synced_at  DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(synced_at)
ORDER BY (org_id, provider, date);
