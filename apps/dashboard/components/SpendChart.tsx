'use client';

import { AreaChart } from '@tremor/react';
import { fmtUsd } from '@/lib/format';
import type { DailySpendPoint } from '@/lib/queries';

export function SpendChart({ data }: { data: DailySpendPoint[] }) {
  const chartData = data.map((d) => ({ date: d.date, 'Spend (USD)': d.cost_usd }));
  return (
    <section className="panel panel--ticked reveal reveal-3 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="label-mono">Daily spend</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dark-tremor-content-subtle">
          usd / day
        </span>
      </div>
      <AreaChart
        className="mt-4 h-72"
        data={chartData}
        index="date"
        categories={['Spend (USD)']}
        colors={['amber']}
        valueFormatter={fmtUsd}
        showLegend={false}
        yAxisWidth={72}
        noDataText="No spend in this range"
      />
    </section>
  );
}
