import { currentOrgSlug } from '@/lib/tenant';
import { resolveRange } from '@/lib/range';
import { getReconciliationByProvider, getReconciliationDaily } from '@/lib/queries';
import { ReconciliationView } from '@/components/ReconciliationView';
import { RangeSelect } from '@/components/RangeSelect';
import { PageHeader } from '@/components/PageHeader';
import { QueryError } from '@/components/DataState';

// Compares tracked SDK estimates (cost_daily) against actual provider bills
// (billed_daily, synced by billsyncd). Surfaces drift and untracked spend.
export const dynamic = 'force-dynamic';

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp.range);
  const org = await currentOrgSlug();

  const header = (
    <PageHeader
      eyebrow="06 / reconciliation"
      title="Invoice reconciliation"
      description="Tracked SDK estimates vs actual provider bills. Drift means missing instrumentation, pricing skew, or spend outside the SDK."
    >
      <RangeSelect value={range.key} />
    </PageHeader>
  );

  try {
    const [rows, daily] = await Promise.all([
      getReconciliationByProvider(org, range.from, range.to),
      getReconciliationDaily(org, range.from, range.to),
    ]);
    return (
      <div className="space-y-6">
        {header}
        <ReconciliationView rows={rows} daily={daily} />
      </div>
    );
  } catch (err) {
    return (
      <div className="space-y-6">
        {header}
        <QueryError error={err} />
      </div>
    );
  }
}
