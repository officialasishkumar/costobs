'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  code: string;
  icon: React.ReactNode;
}

const ICON_PROPS = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const LINKS: NavItem[] = [
  {
    href: '/',
    label: 'Overview',
    code: '01',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 20h18M5 20V9m5 11V4m5 16v-8m5 8V12" />
      </svg>
    ),
  },
  {
    href: '/breakdown',
    label: 'Breakdown',
    code: '02',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M21 12A9 9 0 1 1 12 3v9z" />
        <path d="M21 8.5A9 9 0 0 0 15.5 3L12 12z" />
      </svg>
    ),
  },
  {
    href: '/requests',
    label: 'Requests',
    code: '03',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
  {
    href: '/prompts',
    label: 'Prompts',
    code: '04',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="m5 7 4 5-4 5M12 17h7" />
      </svg>
    ),
  },
  {
    href: '/forecast',
    label: 'Forecast',
    code: '05',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 17.5 9 11l4 4 7.5-8.5" />
        <path d="M16 6.5h4.5V11" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    code: '06',
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.3 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.3 1 2-3.5-2-1.5c.2-.4.2-.8.2-1.2Z" />
      </svg>
    ),
  },
];

export function Sidebar({
  orgSlug,
  userName,
  mode,
}: {
  orgSlug: string;
  userName: string;
  mode: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="z-20 flex shrink-0 flex-col border-b border-carbon-600 bg-carbon-900/85 backdrop-blur lg:sticky lg:top-0 lg:h-screen lg:w-[228px] lg:border-b-0 lg:border-r">
      {/* Wordmark */}
      <div className="flex items-center justify-between px-5 pb-4 pt-5 lg:block">
        <Link href="/" className="group inline-flex items-baseline gap-0.5">
          <span className="cursor-blink font-display text-xl font-semibold tracking-tight text-dark-tremor-content-strong">
            costobs
          </span>
        </Link>
        <p className="hidden pt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-dark-tremor-content-subtle lg:block">
          ai cost console
        </p>
      </div>

      {/* Nav */}
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:mt-2 lg:flex-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {LINKS.map((l) => {
          const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? 'page' : undefined}
              className={
                'group relative flex shrink-0 items-center gap-3 rounded-tremor-small px-3 py-2 text-sm transition-colors duration-150 ' +
                (active
                  ? 'bg-carbon-800 text-dark-tremor-content-strong'
                  : 'text-dark-tremor-content hover:bg-carbon-800/60 hover:text-dark-tremor-content-emphasis')
              }
            >
              {/* Active indicator bar */}
              <span
                aria-hidden
                className={
                  'absolute left-0 top-1/2 hidden h-4 w-[2px] -translate-y-1/2 rounded-full bg-ember transition-opacity lg:block ' +
                  (active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40')
                }
              />
              <span className={active ? 'text-ember' : 'text-dark-tremor-content-subtle group-hover:text-dark-tremor-content'}>
                {l.icon}
              </span>
              <span className="font-medium">{l.label}</span>
              <span className="ml-auto hidden font-mono text-[10px] text-dark-tremor-content-subtle lg:inline">
                {l.code}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Session footer */}
      <div className="hidden border-t border-carbon-600 px-5 py-4 lg:block">
        <dl className="space-y-1.5 font-mono text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <dt className="uppercase tracking-[0.14em] text-dark-tremor-content-subtle">org</dt>
            <dd className="truncate text-dark-tremor-content-emphasis">{orgSlug}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="uppercase tracking-[0.14em] text-dark-tremor-content-subtle">user</dt>
            <dd className="truncate text-dark-tremor-content-emphasis">{userName}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="uppercase tracking-[0.14em] text-dark-tremor-content-subtle">auth</dt>
            <dd className="flex items-center gap-1.5 text-dark-tremor-content-emphasis">
              <span className="h-1.5 w-1.5 rounded-full bg-[--ok] shadow-[0_0_6px_var(--ok)]" />
              {mode}
            </dd>
          </div>
        </dl>
        <p className="mt-4 font-mono text-[10px] leading-relaxed text-dark-tremor-content-subtle">
          self-hosted · offline by design
        </p>
      </div>
    </aside>
  );
}
