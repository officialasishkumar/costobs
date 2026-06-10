import { currentOrgSlug } from '@/lib/tenant';
import { resolveRange } from '@/lib/range';
import { getBreakdown, getTagBreakdown, type BreakdownDim } from '@/lib/queries';
import { BreakdownControls } from '@/components/BreakdownControls';
import { BreakdownView } from '@/components/BreakdownView';
import { PageHeader } from '@/components/PageHeader';
import { QueryError } from '@/components/DataState';

// Reads pre-aggregated rollups (cost_attr_hourly for customer/feature/team,
// cost_daily for provider/model); mixed combinations drill into raw events.
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

/** Tag keys are user-defined but must stay sane as a URL param. */
function parseTagKey(v: string | undefined): string {
  if (!v) return '';
  const cleaned = v.trim().slice(0, 64);
  return /^[\w.:-]+$/.test(cleaned) ? cleaned : '';
}

export default async function BreakdownPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; primary?: string; secondary?: string; tag?: string }>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp.range);
  const primary = parseDim(sp.primary, 'feature')!;
  const secondary = parseDim(sp.secondary, null);
  const tagKey = parseTagKey(sp.tag);
  const org = await currentOrgSlug();

  let body: React.ReactNode;
  try {
    // A tag key overrides the dimension picker: slice by tags[<key>] instead
    // (the engineering-ROI path, e.g. tag=pr for cost per merged PR).
    const rows = tagKey
      ? await getTagBreakdown(org, range.from, range.to, tagKey)
      : await getBreakdown(org, range.from, range.to, primary, secondary);
    body = (
      <BreakdownView
        rows={rows}
        primaryLabel={tagKey ? `tag:${tagKey}` : LABELS[primary]}
        secondaryLabel={tagKey ? null : secondary ? LABELS[secondary] : null}
      />
    );
  } catch (err) {
    body = <QueryError error={err} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="02 / breakdown"
        title="Cost attribution"
        description="Slice spend by customer, feature, team, model, provider — or any custom tag (pr, engineer, experiment)."
      />
      <BreakdownControls
        primary={primary}
        secondary={secondary ?? ''}
        range={range.key}
        tagKey={tagKey}
      />
      {body}
    </div>
  );
}
