'use client';

import { AreaChart, Card, Title } from '@tremor/react';
import { fmtUsd } from '@/lib/format';
import type { DailySpendPoint } from '@/lib/queries';

export function SpendChart({ data }: { data: DailySpendPoint[] }) {
  const chartData = data.map((d) => ({ date: d.date, 'Spend (USD)': d.cost_usd }));
  return (
    <Card>
      <Title>Daily spend</Title>
      <AreaChart
        className="mt-4 h-72"
        data={chartData}
        index="date"
        categories={['Spend (USD)']}
        colors={['blue']}
        valueFormatter={fmtUsd}
        showLegend={false}
        yAxisWidth={72}
        noDataText="No spend in this range"
      />
    </Card>
  );
}
