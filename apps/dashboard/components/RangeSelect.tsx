'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { RANGE_OPTIONS, type RangeKey } from '@/lib/range';

export function RangeSelect({ value }: { value: RangeKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('range', next);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="inline-flex rounded-tremor-small border border-carbon-600 bg-carbon-850 p-0.5">
      {RANGE_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          title={o.label}
          className={
            'rounded-[3px] px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider transition-colors duration-150 ' +
            (o.value === value
              ? 'bg-ember text-carbon-900'
              : 'text-dark-tremor-content hover:bg-carbon-800 hover:text-dark-tremor-content-emphasis')
          }
        >
          {o.value}d
        </button>
      ))}
    </div>
  );
}
