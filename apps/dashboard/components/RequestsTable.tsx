import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@tremor/react';
import { fmtInt, fmtUsdPrecise } from '@/lib/format';
import type { EventRow } from '@/lib/queries';

function StatusPill({ status, errorType }: { status: string; errorType: string }) {
  const ok = status === 'ok';
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded-tremor-small border px-2 py-0.5 font-mono text-[11px] ' +
        (ok
          ? 'border-emerald-900 bg-emerald-950/60 text-emerald-400'
          : 'border-red-900 bg-red-950/60 text-red-400')
      }
    >
      <span
        className={
          'h-1.5 w-1.5 rounded-full ' +
          (ok ? 'bg-emerald-400 shadow-[0_0_5px_#34d399]' : 'bg-red-400 shadow-[0_0_5px_#f87171]')
        }
      />
      {status}
      {errorType ? `: ${errorType}` : ''}
    </span>
  );
}

export function RequestsTable({ rows }: { rows: EventRow[] }) {
  return (
    <div className="panel panel--ticked reveal reveal-2 overflow-x-auto">
      <Table>
        <TableHead>
          <TableRow className="border-b border-carbon-600">
            <TableHeaderCell className="label-mono">Time (UTC)</TableHeaderCell>
            <TableHeaderCell className="label-mono">Provider</TableHeaderCell>
            <TableHeaderCell className="label-mono">Model</TableHeaderCell>
            <TableHeaderCell className="label-mono">Op</TableHeaderCell>
            <TableHeaderCell className="label-mono">Status</TableHeaderCell>
            <TableHeaderCell className="label-mono">Feature</TableHeaderCell>
            <TableHeaderCell className="label-mono">Customer</TableHeaderCell>
            <TableHeaderCell className="label-mono">Trace</TableHeaderCell>
            <TableHeaderCell className="label-mono text-right">In</TableHeaderCell>
            <TableHeaderCell className="label-mono text-right">Out</TableHeaderCell>
            <TableHeaderCell className="label-mono text-right">Total tok</TableHeaderCell>
            <TableHeaderCell className="label-mono text-right">Cost</TableHeaderCell>
            <TableHeaderCell className="label-mono text-right">Latency</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={13} className="py-10 text-center text-dark-tremor-content">
                No requests match these filters.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow
                key={r.request_id}
                className="border-b border-carbon-700/50 transition-colors hover:bg-carbon-800/50"
              >
                <TableCell className="whitespace-nowrap font-mono text-xs text-dark-tremor-content">
                  {r.ts}
                </TableCell>
                <TableCell className="text-dark-tremor-content-emphasis">{r.provider}</TableCell>
                <TableCell className="font-mono text-xs text-dark-tremor-content-emphasis">
                  {r.model}
                </TableCell>
                <TableCell>{r.operation}</TableCell>
                <TableCell>
                  <StatusPill status={r.status} errorType={r.error_type} />
                </TableCell>
                <TableCell>{r.feature || '—'}</TableCell>
                <TableCell className="font-mono text-xs">{r.customer_id || '—'}</TableCell>
                <TableCell className="font-mono text-xs">
                  {r.trace_id ? r.trace_id.slice(0, 12) : '—'}
                </TableCell>
                <TableCell className="readout text-right text-xs">{fmtInt(r.input_tokens)}</TableCell>
                <TableCell className="readout text-right text-xs">{fmtInt(r.output_tokens)}</TableCell>
                <TableCell className="readout text-right text-xs">{fmtInt(r.total_tokens)}</TableCell>
                <TableCell className="readout text-right text-xs text-ember-bright">
                  {fmtUsdPrecise(r.cost_usd)}
                </TableCell>
                <TableCell className="readout text-right text-xs">
                  {fmtInt(r.latency_ms)} ms
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
