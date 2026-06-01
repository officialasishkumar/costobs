'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Button, Select, SelectItem, TextInput } from '@tremor/react';
import { useState } from 'react';
import { RANGE_OPTIONS } from '@/lib/range';

export interface RequestsFilterValues {
  provider: string;
  model: string;
  feature: string;
  customer_id: string;
  trace_id: string;
  status: string;
  range: string;
}

export function RequestsFilters({ initial }: { initial: RequestsFilterValues }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [v, setV] = useState<RequestsFilterValues>(initial);

  function apply() {
    const params = new URLSearchParams(searchParams.toString());
    const entries: [keyof RequestsFilterValues, string][] = [
      ['provider', v.provider],
      ['model', v.model],
      ['feature', v.feature],
      ['customer_id', v.customer_id],
      ['trace_id', v.trace_id],
      ['status', v.status],
      ['range', v.range],
    ];
    for (const [k, val] of entries) {
      if (val) params.set(k, val);
      else params.delete(k);
    }
    params.set('page', '1'); // reset paging on new filter
    router.push(`${pathname}?${params.toString()}`);
  }

  function reset() {
    router.push(pathname);
    setV({
      provider: '',
      model: '',
      feature: '',
      customer_id: '',
      trace_id: '',
      status: '',
      range: '30',
    });
  }

  const field = (
    key: keyof RequestsFilterValues,
    label: string,
    badge?: string,
  ) => (
    <div className="w-44">
      <label className="mb-1 flex items-center gap-1 text-tremor-label text-tremor-content">
        {label}
        {badge && (
          <span className="rounded-tremor-full bg-tremor-brand-faint px-1.5 py-0.5 text-[10px] font-medium text-tremor-brand-emphasis">
            {badge}
          </span>
        )}
      </label>
      <TextInput
        value={v[key]}
        onValueChange={(val) => setV((s) => ({ ...s, [key]: val }))}
        placeholder={label}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply();
        }}
      />
    </div>
  );

  return (
    <div className="space-y-4 rounded-tremor-default bg-tremor-background p-4 shadow-tremor-card">
      <div className="flex flex-wrap items-end gap-4">
        {field('provider', 'Provider')}
        {field('model', 'Model')}
        {field('feature', 'Feature', 'bloom idx')}
        {field('customer_id', 'Customer ID', 'bloom idx')}
        {field('trace_id', 'Trace ID', 'bloom idx')}
        <div className="w-40">
          <label className="mb-1 block text-tremor-label text-tremor-content">Status</label>
          <Select
            value={v.status}
            onValueChange={(val) => setV((s) => ({ ...s, status: val }))}
          >
            <SelectItem value="ok">ok</SelectItem>
            <SelectItem value="error">error</SelectItem>
          </Select>
        </div>
        <div className="w-40">
          <label className="mb-1 block text-tremor-label text-tremor-content">Range</label>
          <Select
            value={v.range}
            onValueChange={(val) => setV((s) => ({ ...s, range: val }))}
            enableClear={false}
          >
            {RANGE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={apply}>Apply filters</Button>
        <Button variant="secondary" onClick={reset}>
          Reset
        </Button>
      </div>
    </div>
  );
}
