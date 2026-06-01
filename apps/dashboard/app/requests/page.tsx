import { currentOrgSlug } from '@/lib/tenant';
import { resolveRange } from '@/lib/range';
import { getRequests, countRequests, type RequestFilters } from '@/lib/queries';
import { RequestsFilters } from '@/components/RequestsFilters';
import { RequestsTable } from '@/components/RequestsTable';
import { Pagination } from '@/components/Pagination';
import { QueryError } from '@/components/DataState';

// The ONLY view that queries raw `events`. Always bounded by a LIMIT/OFFSET and
// the bloom-indexed filters (feature / customer_id / trace_id) shown in the UI.
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

function str(v: string | undefined): string {
  return typeof v === 'string' ? v : '';
}

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp.range);
  const org = await currentOrgSlug();
  const page = Math.max(1, Number(sp.page) || 1);

  const filters: RequestFilters = {
    provider: str(sp.provider) || undefined,
    model: str(sp.model) || undefined,
    feature: str(sp.feature) || undefined,
    customer_id: str(sp.customer_id) || undefined,
    trace_id: str(sp.trace_id) || undefined,
    status: str(sp.status) || undefined,
    from: range.from,
    to: range.to,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  let body: React.ReactNode;
  try {
    const [rows, total] = await Promise.all([
      getRequests(org, filters),
      countRequests(org, filters),
    ]);
    body = (
      <>
        <RequestsTable rows={rows} />
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
      </>
    );
  } catch (err) {
    body = <QueryError error={err} />;
  }

  return (
    <div className="space-y-6">
      <RequestsFilters
        initial={{
          provider: str(sp.provider),
          model: str(sp.model),
          feature: str(sp.feature),
          customer_id: str(sp.customer_id),
          trace_id: str(sp.trace_id),
          status: str(sp.status),
          range: range.key,
        }}
      />
      {body}
    </div>
  );
}
