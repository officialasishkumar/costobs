import { currentOrgSlug } from '@/lib/tenant';
import { resolveRange } from '@/lib/range';
import {
  getOverviewTotals,
  getDailySpend,
  getCostByProvider,
  getCostByModel,
  getMoMTotals,
} from '@/lib/queries';
import { KpiCards } from '@/components/KpiCards';
import { SpendChart } from '@/components/SpendChart';
import { ProviderDonut } from '@/components/ProviderDonut';
import { TopModels } from '@/components/TopModels';
import { GettingStarted } from '@/components/GettingStarted';
import { RangeSelect } from '@/components/RangeSelect';
import { PageHeader } from '@/components/PageHeader';
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

  const header = (
    <PageHeader
      eyebrow="01 / overview"
      title="Spend overview"
      description={
        <span className="font-mono text-xs">
          {range.from} → {range.to}
        </span>
      }
    >
      <RangeSelect value={range.key} />
    </PageHeader>
  );

  try {
    const [totals, daily, byProvider, byModel, mom] = await Promise.all([
      getOverviewTotals(org, range.from, range.to),
      getDailySpend(org, range.from, range.to),
      getCostByProvider(org, range.from, range.to),
      getCostByModel(org, range.from, range.to),
      getMoMTotals(org),
    ]);

    // First run: no events for this org yet — show guided setup instead of
    // empty charts.
    if (totals.requests === 0) {
      return (
        <div className="space-y-6">
          {header}
          <GettingStarted />
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {header}
        <KpiCards kpis={totals} spark={daily} momDeltaPct={mom.delta_pct} />
        <SpendChart data={daily} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ProviderDonut data={byProvider} />
          <TopModels data={byModel} />
        </div>
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
