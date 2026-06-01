import { Card, Grid, Metric, Text } from '@tremor/react';
import { fmtUsd, fmtUsdPrecise, fmtCompact, fmtInt } from '@/lib/format';

export interface Kpis {
  cost_usd: number;
  total_tokens: number;
  requests: number;
}

export function KpiCards({ kpis }: { kpis: Kpis }) {
  const avgCost = kpis.requests > 0 ? kpis.cost_usd / kpis.requests : 0;
  const items = [
    { label: 'Total spend', value: fmtUsd(kpis.cost_usd) },
    { label: 'Total tokens', value: fmtCompact(kpis.total_tokens) },
    { label: 'Requests', value: fmtInt(kpis.requests) },
    { label: 'Avg cost / request', value: fmtUsdPrecise(avgCost) },
  ];
  return (
    <Grid numItemsSm={2} numItemsLg={4} className="gap-4">
      {items.map((it) => (
        <Card key={it.label}>
          <Text>{it.label}</Text>
          <Metric>{it.value}</Metric>
        </Card>
      ))}
    </Grid>
  );
}
