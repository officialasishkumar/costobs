'use client';

import { SparkAreaChart } from '@tremor/react';
import { fmtUsd, fmtUsdPrecise, fmtCompact, fmtInt } from '@/lib/format';
import type { DailySpendPoint } from '@/lib/queries';

export interface Kpis {
  cost_usd: number;
  total_tokens: number;
  requests: number;
}

export function KpiCards({
  kpis,
  spark = [],
  momDeltaPct = null,
}: {
  kpis: Kpis;
  spark?: DailySpendPoint[];
  /** Month-to-date vs same span of last month, in percent. */
  momDeltaPct?: number | null;
}) {
  const avgCost = kpis.requests > 0 ? kpis.cost_usd / kpis.requests : 0;
  const sparkData = spark.map((d) => ({ date: d.date, spend: d.cost_usd }));
  const items = [
    {
      label: 'Total spend',
      value: fmtUsd(kpis.cost_usd),
      accent: true,
      spark: sparkData.length > 1 ? sparkData : null,
      delta: momDeltaPct,
    },
    { label: 'Total tokens', value: fmtCompact(kpis.total_tokens), accent: false, spark: null, delta: null },
    { label: 'Requests', value: fmtInt(kpis.requests), accent: false, spark: null, delta: null },
    { label: 'Avg cost / request', value: fmtUsdPrecise(avgCost), accent: false, spark: null, delta: null },
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
              {it.delta !== null && it.delta !== undefined ? (
                <p
                  className={`mt-1 font-mono text-[11px] ${
                    it.delta > 0 ? 'text-red-400' : 'text-emerald-400'
                  }`}
                  title="Month-to-date vs the same span of last month"
                >
                  {it.delta >= 0 ? '▲' : '▼'} {Math.abs(it.delta).toFixed(1)}% MoM
                </p>
              ) : null}
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
