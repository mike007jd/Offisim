import type { Metadata } from 'next';
import Link from 'next/link';
import { Syne } from 'next/font/google';
import { AuthProvider } from '@aics/ui-market';
import { SITE_URL } from '../lib/url';
import { siteJsonLd } from '../lib/jsonld';
import { MarketNav } from './MarketNav';
import './globals.css';

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

const description =
  'Browse, discover, and install AI company employees, skills, SOPs, and templates for Offisim.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: '%s — Offisim Market',
    default: 'Offisim Market — Discover AI Company Assets',
  },
  description,
  openGraph: {
    type: 'website',
    siteName: 'Offisim Market',
    locale: 'en_US',
    description,
  },
  twitter: {
    card: 'summary',
    title: 'Offisim Market',
    description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  alternates: { canonical: '/' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={syne.variable}>
      <body className="min-h-screen antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd()) }}
        />
        <AuthProvider>
          <MarketNav />
          <main>{children}</main>
          <footer className="border-t border-[var(--border)]">
            <div className="mx-auto max-w-content px-6 py-12">
              <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-between">
                <div>
                  <span className="font-display text-lg font-bold tracking-tight text-[var(--text-primary)]">
                    Offisim
                  </span>
                  <span className="ml-1 text-sm text-[var(--text-muted)]">Market</span>
                </div>
                <div className="flex items-center gap-6 text-sm text-[var(--text-muted)]">
                  <Link href="/search" className="hover:text-[var(--text-secondary)] transition-colors">
                    Browse
                  </Link>
                  <Link href="/dashboard" className="hover:text-[var(--text-secondary)] transition-colors">
                    Creators
                  </Link>
                  <span className="text-[var(--border-bright)]">·</span>
                  <span>Open Source Runtime + Talent Market</span>
                </div>
              </div>
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
