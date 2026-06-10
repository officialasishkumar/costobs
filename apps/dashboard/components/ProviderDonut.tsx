'use client';

import { DonutChart, Legend } from '@tremor/react';
import { fmtUsd } from '@/lib/format';
import type { DimensionSlice } from '@/lib/queries';

const COLORS = ['amber', 'cyan', 'emerald', 'rose', 'violet', 'sky', 'lime', 'orange'];

export function ProviderDonut({ data }: { data: DimensionSlice[] }) {
  const chartData = data.map((d) => ({ name: d.name, value: d.cost_usd }));
  return (
    <section className="panel reveal reveal-4 p-5">
      <h2 className="label-mono">Spend by provider</h2>
      <DonutChart
        className="mt-5 h-52"
        data={chartData}
        category="value"
        index="name"
        colors={COLORS}
        valueFormatter={fmtUsd}
        noDataText="No spend in this range"
      />
      <Legend className="mt-4" categories={chartData.map((d) => d.name)} colors={COLORS} />
    </section>
  );
}
