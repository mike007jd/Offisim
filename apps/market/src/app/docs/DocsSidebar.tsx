'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  label: string;
  href?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Getting Started',
    items: [
      { label: 'Quickstart', href: '/docs/quickstart' },
      { label: 'Core Concepts', href: '/docs/concepts' },
      { label: 'Employees', href: undefined },
      { label: 'Projects', href: undefined },
      { label: 'Studio', href: undefined },
    ],
  },
  {
    title: 'Guides',
    items: [
      { label: 'Model Configuration', href: '/docs/models' },
      { label: 'Marketplace', href: undefined },
    ],
  },
  {
    title: 'Publishing',
    items: [
      { label: 'Creating Packages', href: '/docs/creating-packages' },
      { label: 'Manifest', href: undefined },
      { label: 'Publishing', href: undefined },
    ],
  },
  {
    title: 'Community',
    items: [
      { label: 'Contributing', href: '/docs/contributing' },
      { label: 'Architecture', href: undefined },
    ],
  },
];

export function DocsSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:block w-[220px] shrink-0 sticky top-0 h-screen overflow-y-auto border-r border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-8">
      <Link
        href="/docs"
        className="block font-display text-sm font-semibold text-[var(--text-primary)] mb-6 hover:text-[var(--accent-indigo)] transition-colors"
      >
        Documentation
      </Link>

      <nav className="flex flex-col gap-6">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <h3 className="text-[10px] font-medium uppercase tracking-widest text-[var(--text-muted)] mb-2">
              {section.title}
            </h3>
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                if (!item.href) {
                  return (
                    <li key={item.label}>
                      <span className="block px-2 py-1 text-xs text-[var(--text-muted)] cursor-default">
                        {item.label}
                        <span className="ml-1.5 text-[10px] opacity-60">Soon</span>
                      </span>
                    </li>
                  );
                }

                const isActive = pathname === item.href;

                return (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className={`block rounded px-2 py-1 text-xs transition-colors ${
                        isActive
                          ? 'text-[var(--accent-indigo)] bg-[var(--accent-muted)] font-medium'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
