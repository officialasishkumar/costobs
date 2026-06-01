'use client';

import {
  BarChart,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Title,
} from '@tremor/react';
import { fmtUsd, fmtUsdPrecise, fmtInt } from '@/lib/format';
import type { PromptVersionRow } from '@/lib/queries';

export function PromptComparison({ rows }: { rows: PromptVersionRow[] }) {
  const chartData = rows.map((r) => ({
    name: `${r.prompt_version} · ${r.model}`,
    'Cost / request': r.cost_per_request,
  }));

  return (
    <div className="space-y-6">
      <Card>
        <Title>Cost per request by version</Title>
        <BarChart
          className="mt-4 h-72"
          data={chartData}
          index="name"
          categories={['Cost / request']}
          colors={['indigo']}
          valueFormatter={fmtUsdPrecise}
          showLegend={false}
          yAxisWidth={80}
          noDataText="No prompt-version data for this selection"
        />
      </Card>
      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Version</TableHeaderCell>
              <TableHeaderCell>Model</TableHeaderCell>
              <TableHeaderCell className="text-right">Cost</TableHeaderCell>
              <TableHeaderCell className="text-right">Requests</TableHeaderCell>
              <TableHeaderCell className="text-right">Cost / req</TableHeaderCell>
              <TableHeaderCell className="text-right">Output tokens</TableHeaderCell>
              <TableHeaderCell className="text-right">Latency p95</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-tremor-content">
                  No prompt-version data for this selection.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => (
                <TableRow key={`${r.prompt_version}-${r.model}-${i}`}>
                  <TableCell className="font-medium">{r.prompt_version}</TableCell>
                  <TableCell>{r.model}</TableCell>
                  <TableCell className="text-right">{fmtUsd(r.cost_usd)}</TableCell>
                  <TableCell className="text-right">{fmtInt(r.requests)}</TableCell>
                  <TableCell className="text-right">{fmtUsdPrecise(r.cost_per_request)}</TableCell>
                  <TableCell className="text-right">{fmtInt(r.out_tokens)}</TableCell>
                  <TableCell className="text-right">{fmtInt(r.latency_p95)} ms</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
