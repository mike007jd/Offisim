import type { Metadata } from 'next';
import { AuthProvider } from '@aics/ui-market';
import './globals.css';

export const metadata: Metadata = {
  title: {
    template: '%s — AICS Talent Market',
    default: 'AICS Talent Market — Discover AI Company Assets',
  },
  description:
    'Browse, discover, and install AI company employees, skills, SOPs, and templates for AI Company Simulator.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white antialiased">
        <AuthProvider>
        <header className="border-b border-gray-200">
          <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-4">
            <a href="/" className="text-lg font-semibold text-gray-900">
              AICS Talent Market
            </a>
            <div className="flex items-center gap-6">
              <a href="/search" className="text-sm text-gray-600 hover:text-gray-900">
                Browse
              </a>
              <a href="/about" className="text-sm text-gray-600 hover:text-gray-900">
                About
              </a>
            </div>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="mt-16 border-t border-gray-200 py-8">
          <div className="mx-auto max-w-content px-6 text-center text-sm text-gray-500">
            AI Company Simulator — Open Source Runtime + Talent Market
          </div>
        </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
