import 'server-only';
import { Pool, type QueryResultRow } from 'pg';

// Singleton pg Pool built from POSTGRES_DSN. Holds org/api-key/alert-rule metadata.
let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const connectionString =
    process.env.POSTGRES_DSN ?? 'postgres://postgres:postgres@localhost:5432/costobs?sslmode=disable';
  pool = new Pool({ connectionString, max: 5 });
  return pool;
}

export async function pgQuery<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query<T>(sql, params);
  return res.rows;
}

// ---- Typed row shapes -------------------------------------------------------

export interface OrgRow {
  id: string;
  slug: string;
  name: string;
  created_at: string;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface AlertRuleRow {
  id: string;
  name: string;
  kind: string;
  scope: Record<string, unknown>;
  config: Record<string, unknown>;
  enabled: boolean;
  last_fired_at: string | null;
  cooldown_seconds: number;
  created_at: string;
}

// ---- Typed helpers ----------------------------------------------------------

export async function getOrgBySlug(slug: string): Promise<OrgRow | null> {
  const rows = await pgQuery<OrgRow>(
    `SELECT id::text, slug, name, created_at FROM orgs WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function listApiKeys(orgSlug: string): Promise<ApiKeyRow[]> {
  // Never select key_hash — the secret never leaves the server.
  return pgQuery<ApiKeyRow>(
    `SELECT k.id::text, k.name, k.key_prefix, k.last_used_at, k.revoked_at, k.created_at
       FROM api_keys k
       JOIN orgs o ON o.id = k.org_id
      WHERE o.slug = $1
      ORDER BY k.created_at DESC`,
    [orgSlug],
  );
}

export async function listAlertRules(orgSlug: string): Promise<AlertRuleRow[]> {
  return pgQuery<AlertRuleRow>(
    `SELECT r.id::text, r.name, r.kind, r.scope, r.config, r.enabled,
            r.last_fired_at, r.cooldown_seconds, r.created_at
       FROM alert_rules r
       JOIN orgs o ON o.id = r.org_id
      WHERE o.slug = $1
      ORDER BY r.created_at DESC`,
    [orgSlug],
  );
}
