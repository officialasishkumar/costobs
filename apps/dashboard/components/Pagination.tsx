'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

export function Pagination({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  function go(p: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(p));
    router.push(`${pathname}?${params.toString()}`);
  }

  const btn =
    'rounded-tremor-small border border-carbon-600 bg-carbon-850 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-dark-tremor-content transition-colors hover:border-ember-dim hover:text-dark-tremor-content-strong disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-carbon-600 disabled:hover:text-dark-tremor-content';

  return (
    <div className="reveal reveal-3 flex items-center justify-between">
      <p className="font-mono text-xs text-dark-tremor-content">
        <span className="text-dark-tremor-content-emphasis">
          {from}–{to}
        </span>{' '}
        of {total.toLocaleString()} · page {page}/{totalPages}
      </p>
      <div className="flex gap-2">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => go(page - 1)}>
          ← Prev
        </button>
        <button
          type="button"
          className={btn}
          disabled={page >= totalPages}
          onClick={() => go(page + 1)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
