'use client';

import {
  BarChart,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
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
      <section className="panel panel--ticked reveal reveal-2 p-5">
        <h2 className="label-mono">Cost per request by version</h2>
        <BarChart
          className="mt-4 h-72"
          data={chartData}
          index="name"
          categories={['Cost / request']}
          colors={['cyan']}
          valueFormatter={fmtUsdPrecise}
          showLegend={false}
          yAxisWidth={80}
          noDataText="No prompt-version data for this selection"
        />
      </section>
      <section className="panel reveal reveal-3 overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="border-b border-carbon-600">
              <TableHeaderCell className="label-mono">Version</TableHeaderCell>
              <TableHeaderCell className="label-mono">Model</TableHeaderCell>
              <TableHeaderCell className="label-mono text-right">Cost</TableHeaderCell>
              <TableHeaderCell className="label-mono text-right">Requests</TableHeaderCell>
              <TableHeaderCell className="label-mono text-right">Cost / req</TableHeaderCell>
              <TableHeaderCell className="label-mono text-right">Output tokens</TableHeaderCell>
              <TableHeaderCell className="label-mono text-right">Latency p95</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-dark-tremor-content">
                  No prompt-version data for this selection.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => (
                <TableRow
                  key={`${r.prompt_version}-${r.model}-${i}`}
                  className="border-b border-carbon-700/50 transition-colors hover:bg-carbon-800/50"
                >
                  <TableCell className="font-mono text-xs font-medium text-dark-tremor-content-strong">
                    {r.prompt_version}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.model}</TableCell>
                  <TableCell className="readout text-right text-xs text-ember-bright">
                    {fmtUsd(r.cost_usd)}
                  </TableCell>
                  <TableCell className="readout text-right text-xs">{fmtInt(r.requests)}</TableCell>
                  <TableCell className="readout text-right text-xs">
                    {fmtUsdPrecise(r.cost_per_request)}
                  </TableCell>
                  <TableCell className="readout text-right text-xs">{fmtInt(r.out_tokens)}</TableCell>
                  <TableCell className="readout text-right text-xs">
                    {fmtInt(r.latency_p95)} ms
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
