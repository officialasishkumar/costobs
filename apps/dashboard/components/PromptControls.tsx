'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Select, SelectItem } from '@tremor/react';
import { RANGE_OPTIONS } from '@/lib/range';

export function PromptControls({
  promptKeys,
  selected,
  range,
}: {
  promptKeys: string[];
  selected: string;
  range: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="panel reveal reveal-1 flex flex-wrap items-end gap-4 p-4">
      <div className="w-72">
        <label className="label-mono mb-1.5 block">Prompt key</label>
        <Select
          value={selected}
          onValueChange={(v) => setParam('prompt_key', v)}
          placeholder="Select a prompt key"
        >
          {promptKeys.map((k) => (
            <SelectItem key={k} value={k}>
              {k}
            </SelectItem>
          ))}
        </Select>
      </div>
      <div className="w-44">
        <label className="label-mono mb-1.5 block">Range</label>
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
