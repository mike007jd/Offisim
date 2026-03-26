import { AuthProvider } from '@aics/ui-market';
import type { Metadata } from 'next';
import { Syne } from 'next/font/google';
import Link from 'next/link';
import { siteJsonLd, stringifyJsonLd } from '../lib/jsonld';
import { SITE_URL } from '../lib/url';
import { MarketNav } from './MarketNav';
import './globals.css';

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

const description =
  'Offisim is the spatial interface for AI — a local-first, open-source runtime where AI agents become visible colleagues in a 3D office.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: '%s — Offisim',
    default: 'Offisim — The Spatial Interface for AI',
  },
  description,
  openGraph: {
    type: 'website',
    siteName: 'Offisim',
    locale: 'en_US',
    description,
  },
  twitter: {
    card: 'summary',
    title: 'Offisim',
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
        <script type="application/ld+json">{stringifyJsonLd(siteJsonLd())}</script>
        <AuthProvider>
          <MarketNav />
          <main>{children}</main>
          <footer className="border-t border-[var(--border)]">
            <div className="mx-auto max-w-content px-6 py-12">
              <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
                <div>
                  <Link href="/" className="group">
                    <span className="font-display text-lg font-bold tracking-tight text-[var(--text-primary)] group-hover:text-[var(--accent-indigo)] transition-colors">
                      Offisim
                    </span>
                  </Link>
                  <p className="mt-2 max-w-xs text-xs text-[var(--text-muted)] leading-relaxed">
                    The spatial interface for AI. Open-source runtime where agent workflows become
                    visible, tangible, and human-understandable.
                  </p>
                </div>
                <div className="flex gap-16 text-sm">
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium uppercase tracking-widest text-[var(--text-muted)]">
                      Product
                    </span>
                    <Link
                      href="/how-it-works"
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      How It Works
                    </Link>
                    <Link
                      href="/browse"
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      Marketplace
                    </Link>
                    <Link
                      href="/docs"
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      Documentation
                    </Link>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium uppercase tracking-widest text-[var(--text-muted)]">
                      Community
                    </span>
                    <a
                      href="https://github.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      GitHub
                    </a>
                    <Link
                      href="/docs/contributing"
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      Contributing
                    </Link>
                  </div>
                </div>
              </div>
              <div className="mt-8 border-t border-[var(--border)] pt-6 text-xs text-[var(--text-muted)]">
                Free. Open source. Yours forever.
              </div>
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
