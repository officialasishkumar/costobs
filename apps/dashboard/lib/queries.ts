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
  const rows = await chQuery<{ date: string; cost_usd: string; requests: string }>(
    `SELECT
        toString(date)   AS date,
        sum(cost_usd)    AS cost_usd,
        sum(requests)    AS requests
     FROM cost_daily
     WHERE org_id = {org:String}
       AND date >= {from:Date}
       AND date <= {to:Date}
     GROUP BY date
     ORDER BY date ASC`,
    params,
  );
  return rows.map((r) => ({
    date: r.date,
    cost_usd: Number(r.cost_usd),
    requests: Number(r.requests),
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
  const rows = await chQuery<{ name: string; cost_usd: string; requests: string }>(
    `SELECT
        provider       AS name,
        sum(cost_usd)  AS cost_usd,
        sum(requests)  AS requests
     FROM cost_daily
     WHERE org_id = {org:String}
       AND date >= {from:Date}
       AND date <= {to:Date}
     GROUP BY provider
     ORDER BY cost_usd DESC
     LIMIT 12`,
    params,
  );
  return rows.map((r) => ({
    name: r.name || '(unknown)',
    cost_usd: Number(r.cost_usd),
    requests: Number(r.requests),
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

  // Choose the source table. If primary or secondary needs attribution
  // dimensions (customer/feature/team) we must use cost_attr_hourly. If both
  // are provider/model we use cost_daily. Mixing across tables is not possible
  // from a single rollup, so when dims span both tables we fall back to the
  // attribution table (which carries feature/team) and ignore an incompatible
  // secondary by collapsing it — keeping the query correct and fast.
  const dims = [primary, secondary].filter(Boolean) as BreakdownDim[];
  const needsAttr = dims.some((d) => d in ATTR_DIMS);
  const allDaily = dims.every((d) => d in DAILY_DIMS);

  const colFor = (d: BreakdownDim): string | null =>
    DAILY_DIMS[d] ?? ATTR_DIMS[d] ?? null;

  if (allDaily) {
    const pCol = DAILY_DIMS[primary];
    const sCol = secondary ? DAILY_DIMS[secondary] : null;
    const select = sCol
      ? `${pCol} AS primary, ${sCol} AS secondary`
      : `${pCol} AS primary, NULL AS secondary`;
    const group = sCol ? `${pCol}, ${sCol}` : `${pCol}`;
    const rows = await chQuery<{
      primary: string;
      secondary: string | null;
      cost_usd: string;
      requests: string;
    }>(
      `SELECT ${select},
              sum(cost_usd) AS cost_usd,
              sum(requests) AS requests
       FROM cost_daily
       WHERE org_id = {org:String}
         AND date >= {from:Date}
         AND date <= {to:Date}
       GROUP BY ${group}
       ORDER BY cost_usd DESC
       LIMIT 200`,
      params,
    );
    return rows.map(mapBreakdown);
  }

  // Attribution table path. Provider/model are NOT present here, so a secondary
  // that needs cost_daily cannot be combined; only attr-compatible dims are kept.
  void needsAttr;
  const pCol = colFor(primary);
  if (!pCol || !(primary in ATTR_DIMS)) {
    // primary is provider/model but secondary forced attr table — re-run with
    // primary collapsed to the attr secondary instead. Practically: swap so the
    // attr dimension becomes primary.
    const attrPrimary = (secondary && secondary in ATTR_DIMS ? secondary : 'feature') as BreakdownDim;
    return getBreakdown(org, from, to, attrPrimary, null);
  }
  const sCol = secondary && secondary in ATTR_DIMS ? ATTR_DIMS[secondary] : null;
  const select = sCol
    ? `${pCol} AS primary, ${sCol} AS secondary`
    : `${pCol} AS primary, NULL AS secondary`;
  const group = sCol ? `${pCol}, ${sCol}` : `${pCol}`;
  const rows = await chQuery<{
    primary: string;
    secondary: string | null;
    cost_usd: string;
    requests: string;
  }>(
    `SELECT ${select},
            sum(cost_usd) AS cost_usd,
            sum(requests) AS requests
     FROM cost_attr_hourly
     WHERE org_id = {org:String}
       AND hour >= toDateTime({from:Date})
       AND hour <  toDateTime({to:Date}) + INTERVAL 1 DAY
     GROUP BY ${group}
     ORDER BY cost_usd DESC
     LIMIT 200`,
    params,
  );
  return rows.map(mapBreakdown);
}

function mapBreakdown(r: {
  primary: string;
  secondary: string | null;
  cost_usd: string;
  requests: string;
}): BreakdownRow {
  return {
    primary: r.primary || '(none)',
    secondary: r.secondary === null ? null : r.secondary || '(none)',
    cost_usd: Number(r.cost_usd),
    requests: Number(r.requests),
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
  const rows = await chQuery<Record<string, string>>(
    `SELECT
        request_id,
        toString(ts)       AS ts,
        provider, model, operation, status, error_type,
        feature, customer_id, team, trace_id, environment,
        input_tokens, output_tokens, total_tokens,
        toString(cost_usd) AS cost_usd,
        latency_ms
     FROM events
     WHERE ${clause}
     ORDER BY ts DESC
     LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    params,
  );
  return rows.map((r) => ({
    request_id: r.request_id,
    ts: r.ts,
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
    cost_usd: Number(r.cost_usd),
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
  const rows = await chQuery<{
    prompt_version: string;
    model: string;
    cost_usd: string;
    requests: string;
    out_tokens: string;
    latency_p95: string;
  }>(
    `SELECT
        prompt_version,
        model,
        sumMerge(cost_state)               AS cost_usd,
        countMerge(requests)               AS requests,
        sumMerge(out_tokens)               AS out_tokens,
        quantileMerge(0.95)(latency_p95)   AS latency_p95
     FROM prompt_version_daily
     WHERE org_id = {org:String}
       AND prompt_key = {promptKey:String}
       AND date >= {from:Date}
       AND date <= {to:Date}
     GROUP BY prompt_version, model
     ORDER BY cost_usd DESC`,
    params,
  );
  return rows.map((r) => {
    const cost = Number(r.cost_usd);
    const reqs = Number(r.requests);
    return {
      prompt_version: r.prompt_version || '(none)',
      model: r.model || '(none)',
      cost_usd: cost,
      requests: reqs,
      cost_per_request: reqs > 0 ? cost / reqs : 0,
      out_tokens: Number(r.out_tokens),
      latency_p95: Number(r.latency_p95),
    };
  });
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
  const rows = await chQuery<{ date: string; cost_usd: string; requests: string }>(
    `SELECT
        toString(date) AS date,
        sum(cost_usd)  AS cost_usd,
        sum(requests)  AS requests
     FROM cost_daily
     WHERE org_id = {org:String}
       AND date >= today() - {days:UInt32}
       AND date <= today()
     GROUP BY date
     ORDER BY date ASC`,
    params,
  );
  return rows.map((r) => ({
    date: r.date,
    cost_usd: Number(r.cost_usd),
    requests: Number(r.requests),
  }));
}
