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
import { useMemo, useState } from 'react';
import { fmtUsd, fmtInt, fmtUsdPrecise } from '@/lib/format';
import type { BreakdownRow } from '@/lib/queries';

type SortKey = 'label' | 'cost_usd' | 'requests';

export function BreakdownView({
  rows,
  primaryLabel,
  secondaryLabel,
}: {
  rows: BreakdownRow[];
  primaryLabel: string;
  secondaryLabel: string | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('cost_usd');
  const [asc, setAsc] = useState(false);

  const labeled = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        label: r.secondary !== null ? `${r.primary} · ${r.secondary}` : r.primary,
      })),
    [rows],
  );

  const sorted = useMemo(() => {
    const copy = [...labeled];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'label') cmp = a.label.localeCompare(b.label);
      else cmp = a[sortKey] - b[sortKey];
      return asc ? cmp : -cmp;
    });
    return copy;
  }, [labeled, sortKey, asc]);

  const chartData = sorted.slice(0, 20).map((r) => ({
    name: r.label,
    'Cost (USD)': r.cost_usd,
  }));

  function toggleSort(k: SortKey) {
    if (k === sortKey) setAsc((v) => !v);
    else {
      setSortKey(k);
      setAsc(k === 'label');
    }
  }

  const arrow = (k: SortKey) => (k === sortKey ? (asc ? ' ▲' : ' ▼') : '');
  const colName = secondaryLabel ? `${primaryLabel} · ${secondaryLabel}` : primaryLabel;

  return (
    <div className="space-y-6">
      <section className="panel panel--ticked reveal reveal-2 p-5">
        <h2 className="label-mono">Cost by {colName} — top 20</h2>
        <BarChart
          className="mt-4 h-80"
          data={chartData}
          index="name"
          categories={['Cost (USD)']}
          colors={['amber']}
          valueFormatter={fmtUsd}
          showLegend={false}
          yAxisWidth={72}
          noDataText="No data for this selection"
        />
      </section>
      <section className="panel reveal reveal-3 overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="border-b border-carbon-600">
              <TableHeaderCell
                className="label-mono cursor-pointer select-none"
                onClick={() => toggleSort('label')}
              >
                {colName}
                {arrow('label')}
              </TableHeaderCell>
              <TableHeaderCell
                className="label-mono cursor-pointer select-none text-right"
                onClick={() => toggleSort('cost_usd')}
              >
                Cost{arrow('cost_usd')}
              </TableHeaderCell>
              <TableHeaderCell
                className="label-mono cursor-pointer select-none text-right"
                onClick={() => toggleSort('requests')}
              >
                Requests{arrow('requests')}
              </TableHeaderCell>
              <TableHeaderCell className="label-mono text-right">Cost / req</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-dark-tremor-content">
                  No data for this selection
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((r, i) => (
                <TableRow
                  key={`${r.label}-${i}`}
                  className="border-b border-carbon-700/50 transition-colors hover:bg-carbon-800/50"
                >
                  <TableCell className="text-dark-tremor-content-emphasis">{r.label}</TableCell>
                  <TableCell className="readout text-right text-xs text-ember-bright">
                    {fmtUsd(r.cost_usd)}
                  </TableCell>
                  <TableCell className="readout text-right text-xs">{fmtInt(r.requests)}</TableCell>
                  <TableCell className="readout text-right text-xs">
                    {fmtUsdPrecise(r.requests > 0 ? r.cost_usd / r.requests : 0)}
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
