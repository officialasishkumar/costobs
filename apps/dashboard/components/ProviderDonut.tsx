'use client';

import { Card, DonutChart, Legend, Title } from '@tremor/react';
import { fmtUsd } from '@/lib/format';
import type { DimensionSlice } from '@/lib/queries';

export function ProviderDonut({ data }: { data: DimensionSlice[] }) {
  const chartData = data.map((d) => ({ name: d.name, value: d.cost_usd }));
  return (
    <Card>
      <Title>Spend by provider</Title>
      <DonutChart
        className="mt-4 h-52"
        data={chartData}
        category="value"
        index="name"
        valueFormatter={fmtUsd}
        noDataText="No spend in this range"
      />
      <Legend className="mt-4" categories={chartData.map((d) => d.name)} />
    </Card>
  );
}
