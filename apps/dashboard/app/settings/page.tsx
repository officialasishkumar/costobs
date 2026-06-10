import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@tremor/react';
import { currentOrgSlug } from '@/lib/tenant';
import { listApiKeys, listAlertRules } from '@/lib/postgres';
import { PageHeader } from '@/components/PageHeader';
import { QueryError } from '@/components/DataState';

// Reads org metadata from Postgres (api_keys, alert_rules). Secrets (key_hash)
// are never selected or shown — only the prefix/name/timestamps.
export const dynamic = 'force-dynamic';

function fmtTs(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function StatePill({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded-tremor-small border px-2 py-0.5 font-mono text-[11px] ' +
        (on
          ? 'border-emerald-900 bg-emerald-950/60 text-emerald-400'
          : 'border-carbon-600 bg-carbon-800 text-dark-tremor-content-subtle')
      }
    >
      <span className={'h-1.5 w-1.5 rounded-full ' + (on ? 'bg-emerald-400' : 'bg-carbon-600')} />
      {on ? onLabel : offLabel}
    </span>
  );
}

export default async function SettingsPage() {
  const org = await currentOrgSlug();

  let keysBody: React.ReactNode;
  let rulesBody: React.ReactNode;
  try {
    const [keys, rules] = await Promise.all([listApiKeys(org), listAlertRules(org)]);

    keysBody = (
      <Table>
        <TableHead>
          <TableRow className="border-b border-carbon-600">
            <TableHeaderCell className="label-mono">Name</TableHeaderCell>
            <TableHeaderCell className="label-mono">Prefix</TableHeaderCell>
            <TableHeaderCell className="label-mono">Status</TableHeaderCell>
            <TableHeaderCell className="label-mono">Last used</TableHeaderCell>
            <TableHeaderCell className="label-mono">Created</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {keys.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-dark-tremor-content">
                No API keys for this org.
              </TableCell>
            </TableRow>
          ) : (
            keys.map((k) => (
              <TableRow
                key={k.id}
                className="border-b border-carbon-700/50 transition-colors hover:bg-carbon-800/50"
              >
                <TableCell className="font-medium text-dark-tremor-content-strong">
                  {k.name}
                </TableCell>
                <TableCell className="font-mono text-xs">{k.key_prefix}…</TableCell>
                <TableCell>
                  <StatePill on={!k.revoked_at} onLabel="active" offLabel="revoked" />
                </TableCell>
                <TableCell className="font-mono text-xs">{fmtTs(k.last_used_at)}</TableCell>
                <TableCell className="font-mono text-xs">{fmtTs(k.created_at)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    );

    rulesBody = (
      <Table>
        <TableHead>
          <TableRow className="border-b border-carbon-600">
            <TableHeaderCell className="label-mono">Name</TableHeaderCell>
            <TableHeaderCell className="label-mono">Kind</TableHeaderCell>
            <TableHeaderCell className="label-mono">Enabled</TableHeaderCell>
            <TableHeaderCell className="label-mono">Cooldown</TableHeaderCell>
            <TableHeaderCell className="label-mono">Last fired</TableHeaderCell>
            <TableHeaderCell className="label-mono">Config</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rules.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-dark-tremor-content">
                No alert rules for this org.
              </TableCell>
            </TableRow>
          ) : (
            rules.map((r) => (
              <TableRow
                key={r.id}
                className="border-b border-carbon-700/50 transition-colors hover:bg-carbon-800/50"
              >
                <TableCell className="font-medium text-dark-tremor-content-strong">
                  {r.name}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.kind}</TableCell>
                <TableCell>
                  <StatePill on={r.enabled} onLabel="on" offLabel="off" />
                </TableCell>
                <TableCell className="font-mono text-xs">{r.cooldown_seconds}s</TableCell>
                <TableCell className="font-mono text-xs">{fmtTs(r.last_fired_at)}</TableCell>
                <TableCell className="max-w-xs truncate font-mono text-xs text-dark-tremor-content">
                  {JSON.stringify(r.config)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    );
  } catch (err) {
    keysBody = <QueryError error={err} />;
    rulesBody = null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="06 / settings"
        title="Org configuration"
        description={
          <>
            Org <span className="font-mono text-dark-tremor-content-emphasis">{org}</span>.
            Secrets are never displayed; only key prefixes are shown.
          </>
        }
      />
      <section className="panel panel--ticked reveal reveal-2 overflow-x-auto">
        <div className="border-b border-carbon-600 px-5 py-3">
          <h2 className="label-mono">API keys</h2>
        </div>
        {keysBody}
      </section>
      {rulesBody && (
        <section className="panel reveal reveal-3 overflow-x-auto">
          <div className="border-b border-carbon-600 px-5 py-3">
            <h2 className="label-mono">Alert rules</h2>
          </div>
          {rulesBody}
        </section>
      )}
    </div>
  );
}
