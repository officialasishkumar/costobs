import 'server-only';
import { createClient, type ClickHouseClient } from '@clickhouse/client';

// Singleton ClickHouse client built from CLICKHOUSE_URL (HTTP interface, port 8123).
// The URL may embed credentials and a database, e.g.
//   http://user:pass@clickhouse:8123/costobs
// @clickhouse/client accepts the full URL and parses auth/db out of it.

let client: ClickHouseClient | null = null;

export function getClickHouse(): ClickHouseClient {
  if (client) return client;
  const url = process.env.CLICKHOUSE_URL ?? 'http://localhost:8123/costobs';
  client = createClient({
    url,
    clickhouse_settings: {
      // Keep responses tidy and predictable for the dashboard.
      date_time_output_format: 'iso',
    },
  });
  return client;
}

export type QueryParams = Record<string, unknown>;

/**
 * Run a parameterized ClickHouse query and return typed rows.
 *
 * SQL must use the client's parameter binding syntax, e.g. `{org:String}`,
 * and pass values through `params`. NEVER string-concatenate user input —
 * this is the single choke point that keeps org isolation and tag filters
 * injection-safe.
 */
export async function chQuery<T>(sql: string, params: QueryParams = {}): Promise<T[]> {
  const ch = getClickHouse();
  try {
    const rs = await ch.query({
      query: sql,
      query_params: params,
      format: 'JSONEachRow',
    });
    return rs.json<T>();
  } catch (err) {
    // Normalize to a plain Error: the client throws AggregateError with an
    // EMPTY message on connection failures, which Next 15's RSC stream
    // serializer cannot encode (the page 500s instead of rendering our
    // QueryError fallback).
    throw new Error(`ClickHouse query failed: ${describeError(err)}`);
  }
}

function describeError(err: unknown): string {
  if (err instanceof AggregateError) {
    const parts = err.errors.map((e) =>
      e instanceof Error ? e.message : String(e),
    );
    const code = (err as { code?: string }).code;
    return [err.message, code, ...parts].filter(Boolean).join('; ') || 'connection failed';
  }
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}
