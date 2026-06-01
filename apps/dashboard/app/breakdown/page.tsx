import { currentOrgSlug } from '@/lib/tenant';
import { resolveRange } from '@/lib/range';
import { getBreakdown, type BreakdownDim } from '@/lib/queries';
import { BreakdownControls } from '@/components/BreakdownControls';
import { BreakdownView } from '@/components/BreakdownView';
import { QueryError } from '@/components/DataState';

// Reads pre-aggregated rollups (cost_attr_hourly for customer/feature/team,
// cost_daily for provider/model) — sub-second, never touches raw events.
export const dynamic = 'force-dynamic';

const VALID: BreakdownDim[] = ['customer', 'feature', 'team', 'model', 'provider'];

function parseDim(v: string | undefined, fallback: BreakdownDim | null): BreakdownDim | null {
  if (v && (VALID as string[]).includes(v)) return v as BreakdownDim;
  return fallback;
}

const LABELS: Record<BreakdownDim, string> = {
  customer: 'Customer',
  feature: 'Feature',
  team: 'Team',
  model: 'Model',
  provider: 'Provider',
};

export default async function BreakdownPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; primary?: string; secondary?: string }>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp.range);
  const primary = parseDim(sp.primary, 'feature')!;
  const secondary = parseDim(sp.secondary, null);
  const org = await currentOrgSlug();

  let body: React.ReactNode;
  try {
    const rows = await getBreakdown(org, range.from, range.to, primary, secondary);
    body = (
      <BreakdownView
        rows={rows}
        primaryLabel={LABELS[primary]}
        secondaryLabel={secondary ? LABELS[secondary] : null}
      />
    );
  } catch (err) {
    body = <QueryError error={err} />;
  }

  return (
    <div className="space-y-6">
      <BreakdownControls
        primary={primary}
        secondary={secondary ?? ''}
        range={range.key}
      />
      {body}
    </div>
  );
}
