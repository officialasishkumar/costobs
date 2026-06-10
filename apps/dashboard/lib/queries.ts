import 'server-only';
import { chQuery } from './clickhouse';
import { assertOrgScoped } from './tenant';

// =============================================================================
// All ClickHouse SQL lives here, one function per view need.
//
// PERFORMANCE: Overview / breakdown / prompts / forecast read the pre-aggregated
// rollup tables (cost_daily, cost_attr_hourly, prompt_version_daily) which are
// 100–10000x smaller than the raw `events` table, so they stay sub-second on
// 10M+ events. Only the /requests drill-down hits `events` directly, and only
// with a LIMIT + bloom-indexed filters.
//
// ISOLATION: Every query binds `org` and filters `WHERE org_id = {org:String}`.
// Values are passed via ClickHouse query_params (never string concatenation).
// =============================================================================

// ---------------------------------------------------------------------------
// OVERVIEW  (reads cost_daily — SummingMergeTree, must SUM partial rollups)
// ---------------------------------------------------------------------------

export interface OverviewTotals {
  cost_usd: number;
  total_tokens: number;
  requests: number;
}

export async function getOverviewTotals(
  org: string,
  from: string,
  to: string,
): Promise<OverviewTotals> {
  const params = { org, from, to };
  assertOrgScoped(params);
  const rows = await chQuery<{ cost_usd: string; total_tokens: string; requests: string }>(
    `SELECT
        sum(cost_usd)      AS cost_usd,
        sum(total_tokens)  AS total_tokens,
        sum(requests)      AS requests
     FROM cost_daily
     WHERE org_id = {org:String}
       AND date >= {from:Date}
       AND date <= {to:Date}`,
    params,
  );
  const r = rows[0];
  return {
    cost_usd: Number(r?.cost_usd ?? 0),
    total_tokens: Number(r?.total_tokens ?? 0),
    requests: Number(r?.requests ?? 0),
  };
}

export interface DailySpendPoint {
  date: string;
  cost_usd: number;
  requests: number;
}

export async function getDailySpend(
  org: string,
  from: string,
  to: string,
): Promise<DailySpendPoint[]> {
  const params = { org, from, to };
  assertOrgScoped(params);
  // The alias must not be named `date`: it would shadow the Date column in
  // WHERE/GROUP BY and make ClickHouse compare String to Date (NO_COMMON_TYPE).
  const rows = await chQuery<{ day: string; total_cost: string; total_requests: string }>(
    `SELECT
        toString(date)   AS day,
        sum(cost_usd)    AS total_cost,
        sum(requests)    AS total_requests
     FROM cost_daily
     WHERE org_id = {org:String}
       AND date >= {from:Date}
       AND date <= {to:Date}
     GROUP BY date
     ORDER BY date ASC`,
    params,
  );
  return rows.map((r) => ({
    date: r.day,
    cost_usd: Number(r.total_cost),
    requests: Number(r.total_requests),
  }));
}

export interface DimensionSlice {
  name: string;
  cost_usd: number;
  requests: number;
}

export async function getCostByProvider(
  org: string,
  from: string,
  to: string,
): Promise<DimensionSlice[]> {
  const params = { org, from, to };
  assertOrgScoped(params);
  const rows = await chQuery<{ name: string; total_cost: string; total_requests: string }>(
    `SELECT
        provider       AS name,
        sum(cost_usd)  AS total_cost,
        sum(requests)  AS total_requests
     FROM cost_daily
     WHERE org_id = {org:String}
       AND date >= {from:Date}
       AND date <= {to:Date}
     GROUP BY provider
     ORDER BY total_cost DESC
     LIMIT 12`,
    params,
  );
  return rows.map((r) => ({
    name: r.name || '(unknown)',
    cost_usd: Number(r.total_cost),
    requests: Number(r.total_requests),
  }));
}

export async function getCostByModel(
  org: string,
  from: string,
  to: string,
): Promise<DimensionSlice[]> {
  const params = { org, from, to };
  assertOrgScoped(params);
  const rows = await chQuery<{ name: string; total_cost: string; total_requests: string }>(
    `SELECT
        model          AS name,
        sum(cost_usd)  AS total_cost,
        sum(requests)  AS total_requests
     FROM cost_daily
     WHERE org_id = {org:String}
       AND date >= {from:Date}
       AND date <= {to:Date}
     GROUP BY model
     ORDER BY total_cost DESC
     LIMIT 8`,
    params,
  );
  return rows.map((r) => ({
    name: r.name || '(unknown)',
    cost_usd: Number(r.total_cost),
    requests: Number(r.total_requests),
  }));
}

// ---------------------------------------------------------------------------
// BREAKDOWN
//   provider/model  -> cost_daily
//   customer/feature/team -> cost_attr_hourly
//   (both SummingMergeTree — SUM the partial rollups)
// ---------------------------------------------------------------------------

export type BreakdownDim = 'customer' | 'feature' | 'team' | 'model' | 'provider';

const DAILY_DIMS: Record<string, string> = { provider: 'provider', model: 'model' };
const ATTR_DIMS: Record<string, string> = {
  customer: 'customer_id',
  feature: 'feature',
  team: 'team',
};

export interface BreakdownRow {
  primary: string;
  secondary: string | null;
  cost_usd: number;
  requests: number;
}

export async function getBreakdown(
  org: string,
  from: string,
  to: string,
  primary: BreakdownDim,
  secondary: BreakdownDim | null,
): Promise<BreakdownRow[]> {
  const params: Record<string, unknown> = { org, from, to };
  assertOrgScoped(params);

  // Choose the source table. provider/model live in cost_daily;
  // customer/feature/team live in cost_attr_hourly. A combination that spans
  // both (e.g. provider × customer) exists in no rollup, so it falls back to
  // the raw `events` table — slower, but it returns exactly what was asked
  // for instead of silently substituting a different dimension.
  // Aggregate aliases are deliberately distinct from source column names so
  // ClickHouse never has to disambiguate an alias from the column it shadows.
  const dims = [primary, secondary].filter(Boolean) as BreakdownDim[];
  const allDaily = dims.every((d) => d in DAILY_DIMS);
  const allAttr = dims.every((d) => d in ATTR_DIMS);

  type Row = {
    primary: string;
    secondary: string | null;
    total_cost: string;
    total_requests: string;
  };

  if (allDaily) {
    const pCol = DAILY_DIMS[primary];
    const sCol = secondary ? DAILY_DIMS[secondary] : null;
    const select = sCol
      ? `${pCol} AS primary, ${sCol} AS secondary`
      : `${pCol} AS primary, NULL AS secondary`;
    const group = sCol ? `${pCol}, ${sCol}` : `${pCol}`;
    const rows = await chQuery<Row>(
      `SELECT ${select},
              sum(cost_usd) AS total_cost,
              sum(requests) AS total_requests
       FROM cost_daily
       WHERE org_id = {org:String}
         AND date >= {from:Date}
         AND date <= {to:Date}
       GROUP BY ${group}
       ORDER BY total_cost DESC
       LIMIT 200`,
      params,
    );
    return rows.map(mapBreakdown);
  }

  if (allAttr) {
    const pCol = ATTR_DIMS[primary];
    const sCol = secondary ? ATTR_DIMS[secondary] : null;
    const select = sCol
      ? `${pCol} AS primary, ${sCol} AS secondary`
      : `${pCol} AS primary, NULL AS secondary`;
    const group = sCol ? `${pCol}, ${sCol}` : `${pCol}`;
    const rows = await chQuery<Row>(
      `SELECT ${select},
              sum(cost_usd) AS total_cost,
              sum(requests) AS total_requests
       FROM cost_attr_hourly
       WHERE org_id = {org:String}
         AND hour >= toDateTime({from:Date})
         AND hour <  toDateTime({to:Date}) + INTERVAL 1 DAY
       GROUP BY ${group}
       ORDER BY total_cost DESC
       LIMIT 200`,
      params,
    );
    return rows.map(mapBreakdown);
  }

  // Mixed dims: raw events carries every dimension. Bounded by the date
  // range, org filter, and LIMIT; acceptable for an explicit drill-down.
  const colFor = (d: BreakdownDim): string => DAILY_DIMS[d] ?? ATTR_DIMS[d]!;
  const pCol = colFor(primary);
  const sCol = secondary ? colFor(secondary) : null;
  const select = sCol
    ? `${pCol} AS primary, ${sCol} AS secondary`
    : `${pCol} AS primary, NULL AS secondary`;
  const group = sCol ? `${pCol}, ${sCol}` : `${pCol}`;
  const rows = await chQuery<Row>(
    `SELECT ${select},
            sum(cost_usd) AS total_cost,
            count()       AS total_requests
     FROM events
     WHERE org_id = {org:String}
       AND ts >= toDateTime({from:Date})
       AND ts <  toDateTime({to:Date}) + INTERVAL 1 DAY
     GROUP BY ${group}
     ORDER BY total_cost DESC
     LIMIT 200`,
    params,
  );
  return rows.map(mapBreakdown);
}

function mapBreakdown(r: {
  primary: string;
  secondary: string | null;
  total_cost: string;
  total_requests: string;
}): BreakdownRow {
  return {
    primary: r.primary || '(none)',
    secondary: r.secondary === null ? null : r.secondary || '(none)',
    cost_usd: Number(r.total_cost),
    requests: Number(r.total_requests),
  };
}

// ---------------------------------------------------------------------------
// REQUESTS  (the ONLY view hitting raw `events`; always LIMIT + indexed filters)
//   bloom_filter skip indexes exist on feature, customer_id, trace_id.
// ---------------------------------------------------------------------------

export interface RequestFilters {
  provider?: string;
  model?: string;
  feature?: string; // bloom-indexed
  customer_id?: string; // bloom-indexed
  trace_id?: string; // bloom-indexed
  status?: string;
  from: string;
  to: string;
  limit: number;
  offset: number;
}

export interface EventRow {
  request_id: string;
  ts: string;
  provider: string;
  model: string;
  operation: string;
  status: string;
  error_type: string;
  feature: string;
  customer_id: string;
  team: string;
  trace_id: string;
  environment: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  latency_ms: number;
}

function buildEventFilters(f: RequestFilters): { clause: string; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {
    org: undefined, // filled by caller-friendly assertion below
    from: f.from,
    to: f.to,
  };
  const clauses = [
    'org_id = {org:String}',
    'ts >= toDateTime({from:Date})',
    'ts < toDateTime({to:Date}) + INTERVAL 1 DAY',
  ];
  if (f.provider) {
    clauses.push('provider = {provider:String}');
    params.provider = f.provider;
  }
  if (f.model) {
    clauses.push('model = {model:String}');
    params.model = f.model;
  }
  if (f.feature) {
    clauses.push('feature = {feature:String}');
    params.feature = f.feature;
  }
  if (f.customer_id) {
    clauses.push('customer_id = {customer_id:String}');
    params.customer_id = f.customer_id;
  }
  if (f.trace_id) {
    clauses.push('trace_id = {trace_id:String}');
    params.trace_id = f.trace_id;
  }
  if (f.status) {
    clauses.push('status = {status:String}');
    params.status = f.status;
  }
  return { clause: clauses.join('\n       AND '), params };
}

export async function getRequests(
  org: string,
  f: RequestFilters,
): Promise<EventRow[]> {
  const { clause, params } = buildEventFilters(f);
  params.org = org;
  params.limit = f.limit;
  params.offset = f.offset;
  assertOrgScoped(params);
  // ts/cost_usd string casts must NOT reuse the column names: the aliases
  // would shadow the real columns in WHERE/ORDER BY (NO_COMMON_TYPE errors).
  const rows = await chQuery<Record<string, string>>(
    `SELECT
        request_id,
        toString(ts)       AS ts_str,
        provider, model, operation, status, error_type,
        feature, customer_id, team, trace_id, environment,
        input_tokens, output_tokens, total_tokens,
        toString(cost_usd) AS cost_str,
        latency_ms
     FROM events
     WHERE ${clause}
     ORDER BY ts DESC
     LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    params,
  );
  return rows.map((r) => ({
    request_id: r.request_id,
    ts: r.ts_str,
    provider: r.provider,
    model: r.model,
    operation: r.operation,
    status: r.status,
    error_type: r.error_type,
    feature: r.feature,
    customer_id: r.customer_id,
    team: r.team,
    trace_id: r.trace_id,
    environment: r.environment,
    input_tokens: Number(r.input_tokens),
    output_tokens: Number(r.output_tokens),
    total_tokens: Number(r.total_tokens),
    cost_usd: Number(r.cost_str),
    latency_ms: Number(r.latency_ms),
  }));
}

export async function countRequests(org: string, f: RequestFilters): Promise<number> {
  const { clause, params } = buildEventFilters(f);
  params.org = org;
  assertOrgScoped(params);
  const rows = await chQuery<{ c: string }>(
    `SELECT count() AS c FROM events WHERE ${clause}`,
    params,
  );
  return Number(rows[0]?.c ?? 0);
}

// ---------------------------------------------------------------------------
// PROMPTS  (prompt_version_daily — AggregatingMergeTree; MUST use *Merge)
// ---------------------------------------------------------------------------

export async function listPromptKeys(org: string): Promise<string[]> {
  const params = { org };
  assertOrgScoped(params);
  const rows = await chQuery<{ prompt_key: string }>(
    `SELECT DISTINCT prompt_key
     FROM prompt_version_daily
     WHERE org_id = {org:String} AND prompt_key != ''
     ORDER BY prompt_key
     LIMIT 500`,
    params,
  );
  return rows.map((r) => r.prompt_key);
}

export interface PromptVersionRow {
  prompt_version: string;
  model: string;
  cost_usd: number;
  requests: number;
  cost_per_request: number;
  out_tokens: number;
  latency_p95: number;
}

export async function getPromptComparison(
  org: string,
  promptKey: string,
  from: string,
  to: string,
): Promise<PromptVersionRow[]> {
  const params = { org, promptKey, from, to };
  assertOrgScoped(params);
  // Aliases must NOT shadow the aggregate-state column names (requests,
  // out_tokens, latency_p95): ClickHouse would resolve the alias instead of
  // the column inside the *Merge argument and reject the query.
  const rows = await chQuery<{
    prompt_version: string;
    model: string;
    total_cost: string;
    total_requests: string;
    total_out_tokens: string;
    latency_p95_ms: string;
  }>(
    `SELECT
        prompt_version,
        model,
        sumMerge(cost_state)               AS total_cost,
        countMerge(requests)               AS total_requests,
        sumMerge(out_tokens)               AS total_out_tokens,
        quantileMerge(0.95)(latency_p95)   AS latency_p95_ms
     FROM prompt_version_daily
     WHERE org_id = {org:String}
       AND prompt_key = {promptKey:String}
       AND date >= {from:Date}
       AND date <= {to:Date}
     GROUP BY prompt_version, model
     ORDER BY total_cost DESC`,
    params,
  );
  return rows.map((r) => {
    const cost = Number(r.total_cost);
    const reqs = Number(r.total_requests);
    return {
      prompt_version: r.prompt_version || '(none)',
      model: r.model || '(none)',
      cost_usd: cost,
      requests: reqs,
      cost_per_request: reqs > 0 ? cost / reqs : 0,
      out_tokens: Number(r.total_out_tokens),
      latency_p95: Number(r.latency_p95_ms),
    };
  });
}

// ---------------------------------------------------------------------------
// RECONCILIATION  (tracked SDK estimates vs billed_daily synced by billsyncd)
//   billed_daily is a ReplacingMergeTree(synced_at): aggregate with argMax.
// ---------------------------------------------------------------------------

export interface ProviderReconRow {
  provider: string;
  tracked_usd: number;
  billed_usd: number;
}

export async function getReconciliationByProvider(
  org: string,
  from: string,
  to: string,
): Promise<ProviderReconRow[]> {
  const params = { org, from, to };
  assertOrgScoped(params);

  const [tracked, billed] = await Promise.all([
    chQuery<{ provider: string; total_cost: string }>(
      `SELECT provider, sum(cost_usd) AS total_cost
       FROM cost_daily
       WHERE org_id = {org:String}
         AND date >= {from:Date}
         AND date <= {to:Date}
       GROUP BY provider`,
      params,
    ),
    chQuery<{ provider: string; total_billed: string }>(
      `SELECT provider, sum(billed) AS total_billed
       FROM (
         SELECT provider, date, argMax(billed_usd, synced_at) AS billed
         FROM billed_daily
         WHERE org_id = {org:String}
           AND date >= {from:Date}
           AND date <= {to:Date}
         GROUP BY provider, date
       )
       GROUP BY provider`,
      params,
    ),
  ]);

  const byProvider = new Map<string, ProviderReconRow>();
  for (const r of tracked) {
    byProvider.set(r.provider, {
      provider: r.provider,
      tracked_usd: Number(r.total_cost),
      billed_usd: 0,
    });
  }
  for (const r of billed) {
    const row = byProvider.get(r.provider) ?? {
      provider: r.provider,
      tracked_usd: 0,
      billed_usd: 0,
    };
    row.billed_usd = Number(r.total_billed);
    byProvider.set(r.provider, row);
  }
  return [...byProvider.values()].sort((a, b) => b.billed_usd + b.tracked_usd - (a.billed_usd + a.tracked_usd));
}

export interface ReconDailyPoint {
  date: string;
  tracked_usd: number;
  billed_usd: number;
}

/** Daily tracked vs billed, restricted to providers that HAVE billing data
 * (comparing against providers without a billing sync would show fake drift). */
export async function getReconciliationDaily(
  org: string,
  from: string,
  to: string,
): Promise<ReconDailyPoint[]> {
  const params = { org, from, to };
  assertOrgScoped(params);

  const [tracked, billed] = await Promise.all([
    chQuery<{ day: string; total_cost: string }>(
      `SELECT toString(date) AS day, sum(cost_usd) AS total_cost
       FROM cost_daily
       WHERE org_id = {org:String}
         AND date >= {from:Date}
         AND date <= {to:Date}
         AND provider IN (
           SELECT DISTINCT provider FROM billed_daily WHERE org_id = {org:String}
         )
       GROUP BY date
       ORDER BY date ASC`,
      params,
    ),
    chQuery<{ day: string; total_billed: string }>(
      `SELECT toString(date) AS day, sum(billed) AS total_billed
       FROM (
         SELECT date, argMax(billed_usd, synced_at) AS billed
         FROM billed_daily
         WHERE org_id = {org:String}
           AND date >= {from:Date}
           AND date <= {to:Date}
         GROUP BY provider, date
       )
       GROUP BY date
       ORDER BY date ASC`,
      params,
    ),
  ]);

  const byDay = new Map<string, ReconDailyPoint>();
  for (const r of tracked) {
    byDay.set(r.day, { date: r.day, tracked_usd: Number(r.total_cost), billed_usd: 0 });
  }
  for (const r of billed) {
    const row = byDay.get(r.day) ?? { date: r.day, tracked_usd: 0, billed_usd: 0 };
    row.billed_usd = Number(r.total_billed);
    byDay.set(r.day, row);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// MONTH-OVER-MONTH  (month-to-date vs the same day-count of last month)
// ---------------------------------------------------------------------------

export interface MoMTotals {
  current_mtd: number;
  previous_mtd: number;
  /** Percentage change, null when there is no previous-month baseline. */
  delta_pct: number | null;
}

export async function getMoMTotals(org: string): Promise<MoMTotals> {
  const params = { org };
  assertOrgScoped(params);
  const rows = await chQuery<{ cur: string; prev: string }>(
    `SELECT
        sumIf(cost_usd, date >= toStartOfMonth(today())) AS cur,
        sumIf(
          cost_usd,
          date >= toStartOfMonth(today() - INTERVAL 1 MONTH)
          AND date <= toStartOfMonth(today() - INTERVAL 1 MONTH)
                      + (today() - toStartOfMonth(today()))
        ) AS prev
     FROM cost_daily
     WHERE org_id = {org:String}
       AND date >= toStartOfMonth(today() - INTERVAL 1 MONTH)`,
    params,
  );
  const cur = Number(rows[0]?.cur ?? 0);
  const prev = Number(rows[0]?.prev ?? 0);
  return {
    current_mtd: cur,
    previous_mtd: prev,
    delta_pct: prev > 0 ? ((cur - prev) / prev) * 100 : null,
  };
}

// ---------------------------------------------------------------------------
// FORECAST  (cost_daily daily totals — last 30 days input)
// ---------------------------------------------------------------------------

export async function getDailyTotalsForForecast(
  org: string,
  days: number,
): Promise<DailySpendPoint[]> {
  const params = { org, days };
  assertOrgScoped(params);
  const rows = await chQuery<{ day: string; total_cost: string; total_requests: string }>(
    `SELECT
        toString(date) AS day,
        sum(cost_usd)  AS total_cost,
        sum(requests)  AS total_requests
     FROM cost_daily
     WHERE org_id = {org:String}
       AND date >  today() - {days:UInt32}
       AND date <= today()
     GROUP BY date
     ORDER BY date ASC`,
    params,
  );
  return rows.map((r) => ({
    date: r.day,
    cost_usd: Number(r.total_cost),
    requests: Number(r.total_requests),
  }));
}
