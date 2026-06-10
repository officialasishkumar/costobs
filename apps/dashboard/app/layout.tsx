import type { Metadata } from 'next';
import { Chakra_Petch, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { auth, authMode } from '@/lib/auth';

const sans = IBM_Plex_Sans({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const display = Chakra_Petch({
  weight: ['500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'CostObs — AI cost console',
  description: 'Self-hosted AI/LLM cost observability with per-request attribution',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="en" className="dark">
      <body
        className={`${sans.variable} ${mono.variable} ${display.variable} min-h-screen font-sans antialiased`}
      >
        <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
          <Sidebar
            orgSlug={session.orgSlug}
            userName={session.user.name}
            mode={authMode()}
          />
          <div className="min-w-0 flex-1">
            <main className="mx-auto w-full max-w-[1480px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
