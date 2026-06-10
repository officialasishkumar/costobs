#!/usr/bin/env bash
# Seed synthetic demo data so the dashboard is fully populated in seconds.
# Inserts ~30k events over the last 45 days (rollups populate via the
# materialized views) plus simulated provider bills for the reconciliation
# page. Idempotent enough for demos: re-running adds another batch.
#
# Usage: make demo-data   (or: ./scripts/seed-demo.sh)
set -euo pipefail

CH_URL="${COSTOBS_CH_URL:-http://localhost:8123}"
CH_USER="${CLICKHOUSE_USER:-costobs}"
CH_PASS="${CLICKHOUSE_PASSWORD:-costobs}"
CH_DB="${CLICKHOUSE_DB:-costobs}"
ORG="${COSTOBS_DEV_ORG_SLUG:-default}"
EVENTS="${COSTOBS_DEMO_EVENTS:-30000}"

ch() {
  curl -fsS "${CH_URL}/?database=${CH_DB}" -u "${CH_USER}:${CH_PASS}" --data-binary "$1"
}

echo "seeding ${EVENTS} demo events into ${CH_URL}/${CH_DB} (org=${ORG})..."

ch "
INSERT INTO events (request_id, org_id, ts, received_at, provider, model, operation, stream, status, error_type, environment, team, service, customer_id, user_id, trace_id, feature, prompt_key, prompt_version, tags, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, tool_tokens, total_tokens, audio_seconds, characters, image_count, image_tiles, cost_usd, pricing_version, latency_ms, sdk_lang, sdk_version)
SELECT
  toString(generateUUIDv4()),
  '${ORG}',
  ts,
  ts,
  provider,
  model,
  'chat',
  toUInt8(cityHash64(number,4)%3=0),
  status,
  if(status='error','RateLimitError',''),
  arrayElement(['prod','prod','prod','staging'], toUInt8(cityHash64(number,6)%4)+1),
  arrayElement(['payments','search','support','growth'], toUInt8(cityHash64(number,7)%4)+1),
  'api',
  concat('cust-', toString(cityHash64(number,8)%40)),
  concat('user-', toString(cityHash64(number,9)%200)),
  concat('trace-', lower(hex(toUInt32(cityHash64(number,10))))),
  arrayElement(['summarize','chat','extract','classify','translate'], toUInt8(cityHash64(number,11)%5)+1),
  arrayElement(['support-triage','summarizer'], toUInt8(cityHash64(number,12)%2)+1),
  arrayElement(['v1','v2','v3'], toUInt8(cityHash64(number,13)%3)+1),
  map('region', arrayElement(['us','eu'], toUInt8(cityHash64(number,14)%2)+1),
      'pr', concat('pr-', toString(cityHash64(number,15)%25))),
  in_tok, cached, out_tok, reas, 0,
  in_tok + out_tok + reas,
  0, 0, 0, 0,
  toDecimal64(((in_tok*2.5 + out_tok*10 + reas*10) / 1000000.0) * trend * weekday, 10),
  'v2026.06',
  toUInt32(300 + cityHash64(number,24)%3500),
  arrayElement(['python','typescript'], toUInt8(cityHash64(number,25)%2)+1),
  '0.1.0'
FROM (
  SELECT
    number,
    now64(3) - toIntervalSecond(toUInt32(age_sec)) AS ts,
    age_sec,
    (1.0 + (45.0*86400.0 - age_sec) / (45.0*86400.0)) AS trend,
    -- weekday seasonality: weekends run ~45% lighter (visible in forecasts)
    if(toDayOfWeek(now() - toIntervalSecond(toUInt32(age_sec))) >= 6, 0.55, 1.0) AS weekday,
    arrayElement(['openai','openai','anthropic','anthropic','gemini'], toUInt8(cityHash64(number,2)%5)+1) AS provider,
    arrayElement(['gpt-5.2','gpt-5-mini','claude-fable-5','claude-haiku-4-5','gemini-3-pro'], toUInt8(cityHash64(number,3)%5)+1) AS model,
    if(cityHash64(number,5)%40=0,'error','ok') AS status,
    toUInt32(200 + cityHash64(number,20)%4000) AS in_tok,
    toUInt32(cityHash64(number,21)%500) AS cached,
    toUInt32(50 + cityHash64(number,22)%1500) AS out_tok,
    toUInt32(if(cityHash64(number,23)%3=0, cityHash64(number,26)%800, 0)) AS reas
  FROM (SELECT number, toUInt64(cityHash64(number,1) % (45*86400)) AS age_sec FROM numbers(${EVENTS}))
)
"

echo "seeding simulated provider bills (reconciliation demo)..."
ch "
INSERT INTO billed_daily (org_id, provider, date, billed_usd, source)
SELECT org_id, provider, date, toDecimal64(sum(cost_usd) * 1.07 + 0.18, 6), 'api'
FROM cost_daily
WHERE org_id = '${ORG}' AND provider IN ('openai', 'anthropic')
GROUP BY org_id, provider, date
"

TOTAL=$(ch "SELECT concat(toString(count()), ' events / \$', toString(round(sum(cost_usd),2))) FROM events WHERE org_id='${ORG}'")
echo "done: ${TOTAL} — open http://localhost:3000"
