'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Button } from '@tremor/react';

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
    <Button variant={showExponential ? 'primary' : 'secondary'} onClick={toggle}>
      {showExponential ? 'Hide' : 'Show'} exponential trend
    </Button>
  );
}
