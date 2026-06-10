'use client';

import { SparkAreaChart } from '@tremor/react';
import { fmtUsd, fmtUsdPrecise, fmtCompact, fmtInt } from '@/lib/format';
import type { DailySpendPoint } from '@/lib/queries';

export interface Kpis {
  cost_usd: number;
  total_tokens: number;
  requests: number;
}

export function KpiCards({ kpis, spark = [] }: { kpis: Kpis; spark?: DailySpendPoint[] }) {
  const avgCost = kpis.requests > 0 ? kpis.cost_usd / kpis.requests : 0;
  const sparkData = spark.map((d) => ({ date: d.date, spend: d.cost_usd }));
  const items = [
    {
      label: 'Total spend',
      value: fmtUsd(kpis.cost_usd),
      accent: true,
      spark: sparkData.length > 1 ? sparkData : null,
    },
    { label: 'Total tokens', value: fmtCompact(kpis.total_tokens), accent: false, spark: null },
    { label: 'Requests', value: fmtInt(kpis.requests), accent: false, spark: null },
    { label: 'Avg cost / request', value: fmtUsdPrecise(avgCost), accent: false, spark: null },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((it, i) => (
        <div
          key={it.label}
          className={`panel reveal reveal-${i + 1} p-5 transition-shadow duration-200 hover:shadow-glow ${
            it.accent ? 'panel--ticked' : ''
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="label-mono">{it.label}</p>
              <p
                className={`readout mt-2 truncate text-[1.7rem] font-medium leading-9 ${
                  it.accent ? 'text-ember-bright' : ''
                }`}
              >
                {it.value}
              </p>
            </div>
            {it.spark ? (
              <SparkAreaChart
                data={it.spark}
                index="date"
                categories={['spend']}
                colors={['amber']}
                className="h-10 w-24 shrink-0"
              />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
