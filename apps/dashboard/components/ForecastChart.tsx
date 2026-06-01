'use client';

import { AreaChart, Card, Title } from '@tremor/react';
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

  const categories = showExponential && result.exponential
    ? ['Actual', 'Linear projection', 'Exponential projection']
    : ['Actual', 'Linear projection'];

  return (
    <Card>
      <Title>Daily spend: actual vs projected</Title>
      <p className="mt-1 text-tremor-label text-tremor-content">
        Projection begins {result.dividerDate ?? '—'}
      </p>
      <AreaChart
        className="mt-4 h-80"
        data={data}
        index="date"
        categories={categories}
        colors={['blue', 'amber', 'rose']}
        valueFormatter={fmtUsd}
        yAxisWidth={72}
        connectNulls
        noDataText="Not enough history to forecast"
      />
    </Card>
  );
}
