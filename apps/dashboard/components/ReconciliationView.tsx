'use client';

import { AreaChart } from '@tremor/react';
import { fmtUsd } from '@/lib/format';
import type { ProviderReconRow, ReconDailyPoint } from '@/lib/queries';

function DriftChip({ pct }: { pct: number | null }) {
  if (pct === null) {
    return (
      <span className="inline-flex items-center rounded-tremor-small border border-carbon-600 bg-carbon-800 px-2 py-0.5 font-mono text-[11px] text-dark-tremor-content-subtle">
        no billing data
      </span>
    );
  }
  const abs = Math.abs(pct);
  const tone =
    abs < 2
      ? 'border-emerald-900 bg-emerald-950/60 text-emerald-400'
      : abs < 10
        ? 'border-ember-dim/70 bg-ember-faint text-ember'
        : 'border-red-900 bg-red-950/60 text-red-400';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-tremor-small border px-2 py-0.5 font-mono text-[11px] ${tone}`}
    >
      {pct >= 0 ? '+' : ''}
      {pct.toFixed(1)}%
    </span>
  );
}

export function ReconciliationView({
  rows,
  daily,
}: {
  rows: ProviderReconRow[];
  daily: ReconDailyPoint[];
}) {
  const withBilling = rows.filter((r) => r.billed_usd > 0);
  const trackedTotal = withBilling.reduce((s, r) => s + r.tracked_usd, 0);
  const billedTotal = withBilling.reduce((s, r) => s + r.billed_usd, 0);
  const untracked = billedTotal - trackedTotal;

  const chartData = daily.map((d) => ({
    date: d.date,
    'Tracked (SDK)': d.tracked_usd,
    'Billed (provider)': d.billed_usd,
  }));

  return (
    <div className="space-y-6">
      {/* Summary tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="panel reveal reveal-1 p-5">
          <p className="label-mono">Tracked · SDK estimate</p>
          <p className="readout mt-2 text-[1.7rem] font-medium leading-9">
            {fmtUsd(trackedTotal)}
          </p>
        </div>
        <div className="panel reveal reveal-2 p-5">
          <p className="label-mono">Billed · provider APIs</p>
          <p className="readout mt-2 text-[1.7rem] font-medium leading-9">
            {fmtUsd(billedTotal)}
          </p>
        </div>
        <div className={`panel reveal reveal-3 p-5 ${untracked > 0 ? 'panel--ticked' : ''}`}>
          <p className="label-mono">Untracked spend</p>
          <p
            className={`readout mt-2 text-[1.7rem] font-medium leading-9 ${
              untracked > 0 ? 'text-ember-bright' : ''
            }`}
          >
            {fmtUsd(Math.max(0, untracked))}
          </p>
          <p className="mt-1 font-mono text-xs text-dark-tremor-content">
            billed but not observed by the SDK
          </p>
        </div>
      </div>

      {/* Daily chart */}
      <section className="panel panel--ticked reveal reveal-3 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="label-mono">Tracked vs billed — daily</h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dark-tremor-content-subtle">
            providers with billing sync only
          </span>
        </div>
        <AreaChart
          className="mt-4 h-72"
          data={chartData}
          index="date"
          categories={['Tracked (SDK)', 'Billed (provider)']}
          colors={['amber', 'cyan']}
          valueFormatter={fmtUsd}
          yAxisWidth={72}
          noDataText="No billed data yet — configure billsyncd provider keys"
        />
      </section>

      {/* Per-provider table */}
      <section className="panel reveal reveal-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-carbon-600">
              <th className="label-mono px-4 py-3">Provider</th>
              <th className="label-mono px-4 py-3 text-right">Tracked</th>
              <th className="label-mono px-4 py-3 text-right">Billed</th>
              <th className="label-mono px-4 py-3 text-right">Drift</th>
              <th className="label-mono px-4 py-3 text-right">Drift %</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-dark-tremor-content">
                  No spend in this range.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const hasBilling = r.billed_usd > 0;
                const drift = hasBilling ? r.billed_usd - r.tracked_usd : null;
                const driftPct =
                  hasBilling && r.tracked_usd > 0
                    ? ((r.billed_usd - r.tracked_usd) / r.tracked_usd) * 100
                    : null;
                return (
                  <tr
                    key={r.provider}
                    className="border-b border-carbon-700/50 transition-colors hover:bg-carbon-800/50"
                  >
                    <td className="px-4 py-3 text-dark-tremor-content-emphasis">{r.provider}</td>
                    <td className="readout px-4 py-3 text-right text-xs">
                      {fmtUsd(r.tracked_usd)}
                    </td>
                    <td className="readout px-4 py-3 text-right text-xs">
                      {hasBilling ? fmtUsd(r.billed_usd) : '—'}
                    </td>
                    <td className="readout px-4 py-3 text-right text-xs">
                      {drift === null ? '—' : fmtUsd(drift)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DriftChip pct={driftPct} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
