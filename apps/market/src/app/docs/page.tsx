import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Documentation' };

interface DocCard {
  href: string;
  icon: string;
  title: string;
  description: string;
}

const GETTING_STARTED: DocCard[] = [
  {
    href: '/docs/quickstart',
    icon: '\u26A1',
    title: 'Quickstart',
    description: 'Download, launch, and run your first AI task in under 5 minutes.',
  },
  {
    href: '/docs/concepts',
    icon: '\uD83E\uDDE9',
    title: 'Core Concepts',
    description: 'Employees, projects, zones, SOPs, and the runtime model.',
  },
];

const GUIDES: DocCard[] = [
  {
    href: '/docs/models',
    icon: '\uD83E\uDD16',
    title: 'Model Configuration',
    description: 'Set up providers, assign models per employee, run local with Ollama.',
  },
];

const PUBLISHING: DocCard[] = [
  {
    href: '/docs/creating-packages',
    icon: '\uD83D\uDCE6',
    title: 'Creating Packages',
    description: 'Build and publish employees, skills, SOPs, and templates.',
  },
];

const COMMUNITY: DocCard[] = [
  {
    href: '/docs/contributing',
    icon: '\uD83E\uDD1D',
    title: 'Contributing',
    description: 'Clone the repo, run the dev stack, and submit your first PR.',
  },
];

const SECTIONS = [
  { title: 'Getting Started', cards: GETTING_STARTED },
  { title: 'Guides', cards: GUIDES },
  { title: 'Publishing', cards: PUBLISHING },
  { title: 'Community', cards: COMMUNITY },
];

export default function DocsIndex() {
  return (
    <>
      <h1 className="font-display text-3xl font-bold tracking-tight">Documentation</h1>
      <p className="mt-3 text-sm text-[var(--text-secondary)] leading-relaxed max-w-lg">
        Everything you need to build, run, and extend your AI company with Offisim.
        Start with the quickstart guide or dive into a specific topic.
      </p>

      {SECTIONS.map((section) => (
        <section key={section.title} className="mt-10">
          <h2 className="text-xs font-medium uppercase tracking-widest text-[var(--text-muted)] mb-4">
            {section.title}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {section.cards.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="card flex items-start gap-3 p-4 hover:border-[var(--accent-indigo)] transition-colors"
              >
                <span className="text-lg leading-none mt-0.5">{card.icon}</span>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{card.title}</h3>
                  <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
                    {card.description}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
