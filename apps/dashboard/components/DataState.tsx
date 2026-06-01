// Small presentational helpers for empty / error states so data pages can
// degrade gracefully when ClickHouse/Postgres are unreachable (e.g. at build
// time or in a fresh deploy with no data yet).
import { Callout, Card } from '@tremor/react';

export function EmptyState({ message }: { message: string }) {
  return (
    <Card className="text-center">
      <p className="text-tremor-default text-tremor-content">{message}</p>
    </Card>
  );
}

export function QueryError({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <Callout title="Could not load data" color="amber">
      The query failed. Check that ClickHouse/Postgres are reachable and the
      schema is migrated.
      <span className="mt-2 block font-mono text-tremor-label opacity-80">{msg}</span>
    </Callout>
  );
}
