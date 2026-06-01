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
      <Card>
        <Title>Cost by {colName} (top 20)</Title>
        <BarChart
          className="mt-4 h-80"
          data={chartData}
          index="name"
          categories={['Cost (USD)']}
          colors={['blue']}
          valueFormatter={fmtUsd}
          showLegend={false}
          yAxisWidth={72}
          noDataText="No data for this selection"
        />
      </Card>
      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell
                className="cursor-pointer select-none"
                onClick={() => toggleSort('label')}
              >
                {colName}
                {arrow('label')}
              </TableHeaderCell>
              <TableHeaderCell
                className="cursor-pointer select-none text-right"
                onClick={() => toggleSort('cost_usd')}
              >
                Cost{arrow('cost_usd')}
              </TableHeaderCell>
              <TableHeaderCell
                className="cursor-pointer select-none text-right"
                onClick={() => toggleSort('requests')}
              >
                Requests{arrow('requests')}
              </TableHeaderCell>
              <TableHeaderCell className="text-right">Cost / req</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-tremor-content">
                  No data for this selection
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((r, i) => (
                <TableRow key={`${r.label}-${i}`}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell className="text-right">{fmtUsd(r.cost_usd)}</TableCell>
                  <TableCell className="text-right">{fmtInt(r.requests)}</TableCell>
                  <TableCell className="text-right">
                    {fmtUsdPrecise(r.requests > 0 ? r.cost_usd / r.requests : 0)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
