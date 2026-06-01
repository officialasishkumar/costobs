'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/breakdown', label: 'Breakdown' },
  { href: '/requests', label: 'Requests' },
  { href: '/prompts', label: 'Prompts' },
  { href: '/forecast', label: 'Forecast' },
  { href: '/settings', label: 'Settings' },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 rounded-tremor-default bg-tremor-background p-1 shadow-tremor-card">
      {LINKS.map((l) => {
        const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={
              'rounded-tremor-small px-3 py-1.5 text-tremor-default font-medium transition-colors ' +
              (active
                ? 'bg-tremor-brand text-tremor-brand-inverted'
                : 'text-tremor-content hover:bg-tremor-background-subtle')
            }
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
