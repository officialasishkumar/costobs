'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

export function ForecastToggle({ showExponential }: { showExponential: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function toggle() {
    const params = new URLSearchParams(searchParams.toString());
    if (showExponential) params.delete('exp');
    else params.set('exp', '1');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={showExponential}
      className={
        'rounded-tremor-small border px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider transition-colors duration-150 ' +
        (showExponential
          ? 'border-ember bg-ember text-carbon-900'
          : 'border-carbon-600 bg-carbon-850 text-dark-tremor-content hover:border-ember-dim hover:text-dark-tremor-content-strong')
      }
    >
      exp trend {showExponential ? 'on' : 'off'}
    </button>
  );
}
