import { Grid } from '@tremor/react';
import { currentOrgSlug } from '@/lib/tenant';
import { resolveRange } from '@/lib/range';
import {
  getOverviewTotals,
  getDailySpend,
  getCostByProvider,
} from '@/lib/queries';
import { KpiCards } from '@/components/KpiCards';
import { SpendChart } from '@/components/SpendChart';
import { ProviderDonut } from '@/components/ProviderDonut';
import { RangeSelect } from '@/components/RangeSelect';
import { QueryError } from '@/components/DataState';

// Reads pre-aggregated cost_daily only — sub-second on large event volumes.
export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp.range);
  const org = await currentOrgSlug();

  try {
    const [totals, daily, byProvider] = await Promise.all([
      getOverviewTotals(org, range.from, range.to),
      getDailySpend(org, range.from, range.to),
      getCostByProvider(org, range.from, range.to),
    ]);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-tremor-default text-tremor-content">
            {range.from} → {range.to}
          </p>
          <RangeSelect value={range.key} />
        </div>
        <KpiCards kpis={totals} />
        <SpendChart data={daily} />
        <Grid numItemsLg={2} className="gap-6">
          <ProviderDonut data={byProvider} />
        </Grid>
      </div>
    );
  } catch (err) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-tremor-default text-tremor-content">
            {range.from} → {range.to}
          </p>
          <RangeSelect value={range.key} />
        </div>
        <QueryError error={err} />
      </div>
    );
  }
}
