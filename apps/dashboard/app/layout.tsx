import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/Nav';
import { auth, authMode } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'CostObs',
  description: 'AI/LLM cost observability dashboard',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
          <header className="mb-6 flex flex-col gap-4 border-b border-tremor-border pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-tremor-title font-semibold text-tremor-content-strong">
                CostObs
              </h1>
              <p className="text-tremor-default text-tremor-content">
                AI/LLM cost observability
              </p>
            </div>
            <div className="text-tremor-label text-tremor-content">
              org <span className="font-medium text-tremor-content-emphasis">{session.orgSlug}</span>
              {' · '}
              {session.user.name}
              {' · auth: '}
              <span className="font-medium text-tremor-content-emphasis">{authMode()}</span>
            </div>
          </header>
          <Nav />
          <main className="mt-6 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
