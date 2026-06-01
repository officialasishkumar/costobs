'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Select, SelectItem } from '@tremor/react';
import { RANGE_OPTIONS } from '@/lib/range';

const DIMS = [
  { value: 'customer', label: 'Customer' },
  { value: 'feature', label: 'Feature' },
  { value: 'team', label: 'Team' },
  { value: 'model', label: 'Model' },
  { value: 'provider', label: 'Provider' },
];

export function BreakdownControls({
  primary,
  secondary,
  range,
}: {
  primary: string;
  secondary: string;
  range: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === '') params.delete(key);
    else params.set(key, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="w-44">
        <label className="mb-1 block text-tremor-label text-tremor-content">Group by</label>
        <Select value={primary} onValueChange={(v) => setParam('primary', v)} enableClear={false}>
          {DIMS.map((d) => (
            <SelectItem key={d.value} value={d.value}>
              {d.label}
            </SelectItem>
          ))}
        </Select>
      </div>
      <div className="w-44">
        <label className="mb-1 block text-tremor-label text-tremor-content">
          Secondary (optional)
        </label>
        <Select value={secondary} onValueChange={(v) => setParam('secondary', v)}>
          {DIMS.map((d) => (
            <SelectItem key={d.value} value={d.value}>
              {d.label}
            </SelectItem>
          ))}
        </Select>
      </div>
      <div className="w-44">
        <label className="mb-1 block text-tremor-label text-tremor-content">Range</label>
        <Select value={range} onValueChange={(v) => setParam('range', v)} enableClear={false}>
          {RANGE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </Select>
      </div>
    </div>
  );
}
