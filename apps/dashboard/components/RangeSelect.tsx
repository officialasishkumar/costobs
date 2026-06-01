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
    <div className="inline-flex rounded-tremor-default bg-tremor-background p-1 shadow-tremor-card">
      {RANGE_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={
            'rounded-tremor-small px-3 py-1 text-tremor-default font-medium transition-colors ' +
            (o.value === value
              ? 'bg-tremor-brand text-tremor-brand-inverted'
              : 'text-tremor-content hover:bg-tremor-background-subtle')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
