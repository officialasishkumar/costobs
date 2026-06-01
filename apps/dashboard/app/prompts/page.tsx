import { currentOrgSlug } from '@/lib/tenant';
import { resolveRange } from '@/lib/range';
import { listPromptKeys, getPromptComparison } from '@/lib/queries';
import { PromptControls } from '@/components/PromptControls';
import { PromptComparison } from '@/components/PromptComparison';
import { EmptyState, QueryError } from '@/components/DataState';

// Reads prompt_version_daily (AggregatingMergeTree) via *Merge functions —
// sub-second, reads the rollup not raw events.
export const dynamic = 'force-dynamic';

export default async function PromptsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; prompt_key?: string }>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp.range);
  const org = await currentOrgSlug();

  try {
    const promptKeys = await listPromptKeys(org);
    const selected = sp.prompt_key && promptKeys.includes(sp.prompt_key)
      ? sp.prompt_key
      : promptKeys[0] ?? '';

    let body: React.ReactNode;
    if (!selected) {
      body = <EmptyState message="No prompt versions recorded yet for this org." />;
    } else {
      const rows = await getPromptComparison(org, selected, range.from, range.to);
      body = <PromptComparison rows={rows} />;
    }

    return (
      <div className="space-y-6">
        <PromptControls promptKeys={promptKeys} selected={selected} range={range.key} />
        {body}
      </div>
    );
  } catch (err) {
    return (
      <div className="space-y-6">
        <QueryError error={err} />
      </div>
    );
  }
}
