-- MV 1: daily cost rollup (overview time series + forecasting input)
CREATE TABLE IF NOT EXISTS cost_daily
(
    org_id LowCardinality(String),
    date Date,
    provider LowCardinality(String),
    model LowCardinality(String),
    cost_usd Decimal(38, 10),
    total_tokens UInt64,
    requests UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (org_id, date, provider, model);

CREATE MATERIALIZED VIEW IF NOT EXISTS cost_daily_mv TO cost_daily AS
SELECT
    org_id,
    toDate(ts) AS date,
    provider,
    model,
    sum(cost_usd) AS cost_usd,
    sum(total_tokens) AS total_tokens,
    count() AS requests
FROM events
GROUP BY org_id, date, provider, model;

-- MV 2: hourly attribution rollup (breakdown by customer/feature/team)
CREATE TABLE IF NOT EXISTS cost_attr_hourly
(
    org_id LowCardinality(String),
    hour DateTime,
    customer_id String,
    feature LowCardinality(String),
    team LowCardinality(String),
    cost_usd Decimal(38, 10),
    requests UInt64,
    input_tokens UInt64,
    output_tokens UInt64,
    cached_input_tokens UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (org_id, hour, customer_id, feature, team);

CREATE MATERIALIZED VIEW IF NOT EXISTS cost_attr_hourly_mv TO cost_attr_hourly AS
SELECT
    org_id,
    toStartOfHour(ts) AS hour,
    customer_id,
    feature,
    team,
    sum(cost_usd) AS cost_usd,
    count() AS requests,
    sum(input_tokens) AS input_tokens,
    sum(output_tokens) AS output_tokens,
    sum(cached_input_tokens) AS cached_input_tokens
FROM events
GROUP BY org_id, hour, customer_id, feature, team;

-- MV 3: prompt-version A/B comparison (with latency p95 → AggregatingMergeTree)
CREATE TABLE IF NOT EXISTS prompt_version_daily
(
    org_id LowCardinality(String),
    date Date,
    prompt_key LowCardinality(String),
    prompt_version LowCardinality(String),
    model LowCardinality(String),
    cost_state    AggregateFunction(sum, Decimal(18, 10)),
    requests      AggregateFunction(count),
    out_tokens    AggregateFunction(sum, UInt32),
    latency_p95   AggregateFunction(quantile(0.95), UInt32)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (org_id, prompt_key, prompt_version, model, date);

CREATE MATERIALIZED VIEW IF NOT EXISTS prompt_version_daily_mv TO prompt_version_daily AS
SELECT
    org_id,
    toDate(ts) AS date,
    prompt_key,
    prompt_version,
    model,
    sumState(cost_usd) AS cost_state,
    countState() AS requests,
    sumState(output_tokens) AS out_tokens,
    quantileState(0.95)(latency_ms) AS latency_p95
FROM events
GROUP BY org_id, date, prompt_key, prompt_version, model;
