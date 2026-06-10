// Small presentational helpers for empty / error states so data pages can
// degrade gracefully when ClickHouse/Postgres are unreachable (e.g. at build
// time or in a fresh deploy with no data yet).

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="panel reveal flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="font-mono text-2xl text-dark-tremor-content-subtle">∅</span>
      <p className="text-sm text-dark-tremor-content">{message}</p>
    </div>
  );
}

export function QueryError({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      className="panel reveal border-l-2 border-l-ember px-5 py-4"
    >
      <p className="label-mono text-ember">query failed</p>
      <p className="mt-2 text-sm text-dark-tremor-content-emphasis">
        Could not load data. Check that ClickHouse/Postgres are reachable and the
        schema is migrated.
      </p>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-tremor-small bg-carbon-900 px-3 py-2 font-mono text-xs leading-relaxed text-dark-tremor-content">
        {msg}
      </pre>
    </div>
  );
}
