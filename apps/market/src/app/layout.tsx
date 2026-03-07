import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AICS Talent Market',
  description: 'Discover and install AI company assets',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui' }}>{children}</body>
    </html>
  );
}
