import {
  Badge,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Title,
} from '@tremor/react';
import { currentOrgSlug } from '@/lib/tenant';
import { listApiKeys, listAlertRules } from '@/lib/postgres';
import { QueryError } from '@/components/DataState';

// Reads org metadata from Postgres (api_keys, alert_rules). Secrets (key_hash)
// are never selected or shown — only the prefix/name/timestamps.
export const dynamic = 'force-dynamic';

function fmtTs(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
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
          <TableRow>
            <TableHeaderCell>Name</TableHeaderCell>
            <TableHeaderCell>Prefix</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell>Last used</TableHeaderCell>
            <TableHeaderCell>Created</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {keys.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-tremor-content">
                No API keys for this org.
              </TableCell>
            </TableRow>
          ) : (
            keys.map((k) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">{k.name}</TableCell>
                <TableCell className="font-mono">{k.key_prefix}…</TableCell>
                <TableCell>
                  <Badge color={k.revoked_at ? 'gray' : 'emerald'} size="xs">
                    {k.revoked_at ? 'revoked' : 'active'}
                  </Badge>
                </TableCell>
                <TableCell>{fmtTs(k.last_used_at)}</TableCell>
                <TableCell>{fmtTs(k.created_at)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    );

    rulesBody = (
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Name</TableHeaderCell>
            <TableHeaderCell>Kind</TableHeaderCell>
            <TableHeaderCell>Enabled</TableHeaderCell>
            <TableHeaderCell>Cooldown</TableHeaderCell>
            <TableHeaderCell>Last fired</TableHeaderCell>
            <TableHeaderCell>Config</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rules.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-tremor-content">
                No alert rules for this org.
              </TableCell>
            </TableRow>
          ) : (
            rules.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.kind}</TableCell>
                <TableCell>
                  <Badge color={r.enabled ? 'emerald' : 'gray'} size="xs">
                    {r.enabled ? 'on' : 'off'}
                  </Badge>
                </TableCell>
                <TableCell>{r.cooldown_seconds}s</TableCell>
                <TableCell>{fmtTs(r.last_fired_at)}</TableCell>
                <TableCell className="max-w-xs truncate font-mono text-tremor-label">
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
      <Card>
        <Title>API keys</Title>
        <p className="mt-1 text-tremor-label text-tremor-content">
          Org <span className="font-medium">{org}</span>. Secrets are never displayed; only
          the key prefix is shown.
        </p>
        <div className="mt-4">{keysBody}</div>
      </Card>
      {rulesBody && (
        <Card>
          <Title>Alert rules</Title>
          <div className="mt-4">{rulesBody}</div>
        </Card>
      )}
    </div>
  );
}
