CREATE TABLE IF NOT EXISTS events
(
    request_id      String,
    org_id          LowCardinality(String),
    ts              DateTime64(3, 'UTC'),
    received_at     DateTime64(3, 'UTC') DEFAULT now64(3),

    provider        LowCardinality(String),
    model           LowCardinality(String),
    operation       LowCardinality(String),
    stream          UInt8 DEFAULT 0,
    status          LowCardinality(String) DEFAULT 'ok',
    error_type      LowCardinality(String) DEFAULT '',

    environment     LowCardinality(String) DEFAULT '',
    team            LowCardinality(String) DEFAULT '',
    service         LowCardinality(String) DEFAULT '',
    customer_id     String DEFAULT '',
    user_id         String DEFAULT '',
    trace_id        String DEFAULT '',
    feature         LowCardinality(String) DEFAULT '',
    prompt_key      LowCardinality(String) DEFAULT '',
    prompt_version  LowCardinality(String) DEFAULT '',
    tags            Map(LowCardinality(String), String),

    input_tokens          UInt32 DEFAULT 0,
    cached_input_tokens   UInt32 DEFAULT 0,
    output_tokens         UInt32 DEFAULT 0,
    reasoning_tokens      UInt32 DEFAULT 0,
    tool_tokens           UInt32 DEFAULT 0,
    total_tokens          UInt32 DEFAULT 0,
    audio_seconds         Float32 DEFAULT 0,
    image_count           UInt16 DEFAULT 0,
    image_tiles           UInt32 DEFAULT 0,

    cost_usd        Decimal(18, 10) DEFAULT 0,
    pricing_version LowCardinality(String) DEFAULT '',

    latency_ms      UInt32 DEFAULT 0,
    sdk_lang        LowCardinality(String) DEFAULT '',
    sdk_version     LowCardinality(String) DEFAULT '',

    INDEX idx_feature  feature     TYPE bloom_filter GRANULARITY 4,
    INDEX idx_customer customer_id TYPE bloom_filter GRANULARITY 4,
    INDEX idx_trace    trace_id    TYPE bloom_filter GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (org_id, ts, provider, model, customer_id)
TTL toDateTime(ts) + INTERVAL 180 DAY DELETE
SETTINGS index_granularity = 8192;
