import { fmtUsd, fmtCompact } from '@/lib/format';
import type { DimensionSlice } from '@/lib/queries';

/** Ranked horizontal bars: spend per model, scaled to the top entry. */
export function TopModels({ data }: { data: DimensionSlice[] }) {
  const max = data.length > 0 ? Math.max(...data.map((d) => d.cost_usd)) : 0;
  return (
    <section className="panel reveal reveal-5 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="label-mono">Top models by spend</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dark-tremor-content-subtle">
          top {data.length || 0}
        </span>
      </div>
      {data.length === 0 ? (
        <p className="mt-6 text-center text-sm text-dark-tremor-content">
          No spend in this range
        </p>
      ) : (
        <ol className="mt-5 space-y-3">
          {data.map((d, i) => (
            <li key={d.name}>
              <div className="flex items-baseline justify-between gap-3 font-mono text-xs">
                <span className="truncate text-dark-tremor-content-emphasis">
                  <span className="mr-2 text-dark-tremor-content-subtle">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {d.name}
                </span>
                <span className="readout shrink-0">
                  {fmtUsd(d.cost_usd)}
                  <span className="ml-2 text-dark-tremor-content-subtle">
                    {fmtCompact(d.requests)} req
                  </span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-carbon-700">
                <div
                  className={
                    'h-full rounded-full ' + (i === 0 ? 'bg-ember' : 'bg-ember-dim')
                  }
                  style={{ width: `${max > 0 ? Math.max(2, (d.cost_usd / max) * 100) : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
