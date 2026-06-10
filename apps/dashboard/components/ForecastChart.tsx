'use client';

import { AreaChart } from '@tremor/react';
import { fmtUsd } from '@/lib/format';
import type { ForecastResult } from '@/lib/forecast';

export function ForecastChart({
  result,
  showExponential,
}: {
  result: ForecastResult;
  showExponential: boolean;
}) {
  const data = result.points.map((p) => ({
    date: p.date,
    Actual: p.actual,
    'Linear projection': p.linear,
    ...(showExponential && p.exponential !== null
      ? { 'Exponential projection': p.exponential }
      : {}),
  }));

  const categories =
    showExponential && result.exponential
      ? ['Actual', 'Linear projection', 'Exponential projection']
      : ['Actual', 'Linear projection'];

  return (
    <section className="panel panel--ticked reveal reveal-4 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="label-mono">Daily spend — actual vs projected</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dark-tremor-content-subtle">
          projection begins {result.dividerDate ?? '—'}
        </span>
      </div>
      <AreaChart
        className="mt-4 h-80"
        data={data}
        index="date"
        categories={categories}
        colors={['amber', 'cyan', 'rose']}
        valueFormatter={fmtUsd}
        yAxisWidth={72}
        connectNulls
        noDataText="Not enough history to forecast"
      />
    </section>
  );
}
