import {
  Badge,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@tremor/react';
import { fmtInt, fmtUsdPrecise } from '@/lib/format';
import type { EventRow } from '@/lib/queries';

export function RequestsTable({ rows }: { rows: EventRow[] }) {
  return (
    <Card className="overflow-x-auto p-0">
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Time (UTC)</TableHeaderCell>
            <TableHeaderCell>Provider</TableHeaderCell>
            <TableHeaderCell>Model</TableHeaderCell>
            <TableHeaderCell>Op</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell>Feature</TableHeaderCell>
            <TableHeaderCell>Customer</TableHeaderCell>
            <TableHeaderCell>Trace</TableHeaderCell>
            <TableHeaderCell className="text-right">In</TableHeaderCell>
            <TableHeaderCell className="text-right">Out</TableHeaderCell>
            <TableHeaderCell className="text-right">Total tok</TableHeaderCell>
            <TableHeaderCell className="text-right">Cost</TableHeaderCell>
            <TableHeaderCell className="text-right">Latency</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={13} className="text-center text-tremor-content">
                No requests match these filters.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.request_id}>
                <TableCell className="whitespace-nowrap font-mono text-tremor-label">
                  {r.ts}
                </TableCell>
                <TableCell>{r.provider}</TableCell>
                <TableCell>{r.model}</TableCell>
                <TableCell>{r.operation}</TableCell>
                <TableCell>
                  <Badge color={r.status === 'ok' ? 'emerald' : 'red'} size="xs">
                    {r.status}
                    {r.error_type ? `: ${r.error_type}` : ''}
                  </Badge>
                </TableCell>
                <TableCell>{r.feature || '—'}</TableCell>
                <TableCell className="font-mono text-tremor-label">
                  {r.customer_id || '—'}
                </TableCell>
                <TableCell className="font-mono text-tremor-label">
                  {r.trace_id ? r.trace_id.slice(0, 12) : '—'}
                </TableCell>
                <TableCell className="text-right">{fmtInt(r.input_tokens)}</TableCell>
                <TableCell className="text-right">{fmtInt(r.output_tokens)}</TableCell>
                <TableCell className="text-right">{fmtInt(r.total_tokens)}</TableCell>
                <TableCell className="text-right">{fmtUsdPrecise(r.cost_usd)}</TableCell>
                <TableCell className="text-right">{fmtInt(r.latency_ms)} ms</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
