'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Select, SelectItem, TextInput } from '@tremor/react';
import { useEffect, useState } from 'react';
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
  tagKey = '',
}: {
  primary: string;
  secondary: string;
  range: string;
  tagKey?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tag, setTag] = useState(tagKey);

  useEffect(() => {
    setTag(tagKey);
  }, [tagKey]);

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === '') params.delete(key);
    else params.set(key, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  const tagActive = tagKey !== '';

  return (
    <div className="panel reveal reveal-1 flex flex-wrap items-end gap-4 p-4">
      <div className={`w-44 ${tagActive ? 'opacity-40' : ''}`}>
        <label className="label-mono mb-1.5 block">Group by</label>
        <Select value={primary} onValueChange={(v) => setParam('primary', v)} enableClear={false}>
          {DIMS.map((d) => (
            <SelectItem key={d.value} value={d.value}>
              {d.label}
            </SelectItem>
          ))}
        </Select>
      </div>
      <div className={`w-44 ${tagActive ? 'opacity-40' : ''}`}>
        <label className="label-mono mb-1.5 block">Secondary · optional</label>
        <Select value={secondary} onValueChange={(v) => setParam('secondary', v)}>
          {DIMS.map((d) => (
            <SelectItem key={d.value} value={d.value}>
              {d.label}
            </SelectItem>
          ))}
        </Select>
      </div>
      <div className="w-44">
        <label className="label-mono mb-1.5 flex items-center gap-1.5">
          Tag key · overrides
          <span className="rounded-tremor-small border border-ember-dim/60 bg-ember-faint px-1.5 py-0.5 font-mono text-[9px] font-medium normal-case tracking-normal text-ember">
            eng roi
          </span>
        </label>
        <TextInput
          value={tag}
          onValueChange={setTag}
          placeholder="pr, engineer, …"
          onKeyDown={(e) => {
            if (e.key === 'Enter') setParam('tag', tag.trim());
          }}
        />
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
      {tagActive ? (
        <button
          type="button"
          onClick={() => setParam('tag', '')}
          className="rounded-tremor-small border border-carbon-600 bg-carbon-850 px-3 py-2 font-mono text-xs uppercase tracking-wider text-dark-tremor-content transition-colors hover:border-ember-dim hover:text-dark-tremor-content-strong"
        >
          clear tag
        </button>
      ) : null}
    </div>
  );
}
