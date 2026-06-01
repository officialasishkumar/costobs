import 'server-only';
import { auth } from './auth';

// Tenant helper. Every ClickHouse query MUST filter by org_id and every
// Postgres query MUST scope by org slug. Centralizing the resolution here
// makes that contract obvious and auditable.

export async function currentOrgSlug(): Promise<string> {
  const { orgSlug } = await auth();
  return orgSlug;
}

/**
 * Asserts that the params bag carries the org binding before a ClickHouse
 * query runs. Call this in query builders to fail loud if isolation is
 * accidentally dropped.
 */
export function assertOrgScoped(params: Record<string, unknown>, key = 'org'): void {
  const v = params[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(
      `Tenant isolation violation: query params missing non-empty "${key}" (org_id) binding`,
    );
  }
}
