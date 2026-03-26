export const revalidate = 60;

import type { ListingSummary } from '@aics/registry-client';
import { ArrowRight, Download, Search, Star } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getRegistryClient } from '../../lib/registry';
import {
  CATEGORIES,
  SHOWCASE_LISTINGS,
  SHOWCASE_STATS,
  type ShowcaseListing,
} from '../../lib/showcase';

export const metadata: Metadata = {
  title: 'Browse Assets',
  description:
    'Browse, discover, and install AI company employees, skills, SOPs, and templates for Offisim.',
};

const KIND_LABELS: Record<string, string> = {
  employee: 'Employee',
  skill: 'Skill',
  sop: 'SOP',
  company_template: 'Template',
  office_layout: 'Layout',
  bundle: 'Bundle',
};

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default async function BrowsePage() {
  let apiListings: ListingSummary[] = [];
  try {
    const client = getRegistryClient();
    const result = await client.searchListings({ sort: 'installs', per_page: 6 });
    apiListings = result.items;
  } catch {
    /* platform API unavailable — use showcase data */
  }

  const hasRealData = apiListings.length > 0;

  return (
    <div className="mx-auto max-w-5xl px-6">
      {/* ── Hero ── */}
      <section className="pb-16 pt-20 sm:pt-28">
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          AI Company Assets
        </h1>
        <p className="mt-4 max-w-lg text-lg text-[var(--text-secondary)]">
          Employees, skills, SOPs, and templates for your AI company runtime. Browse, install, run.
        </p>

        {/* Search */}
        <form method="get" action="/search" className="mt-8 flex max-w-md gap-2">
          <div className="relative flex-1">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              type="search"
              name="q"
              placeholder="Search assets..."
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] py-2.5 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-indigo)] focus:outline-none transition-colors"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent-indigo)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
          >
            Search
          </button>
        </form>

        {/* Stats */}
        <div className="mt-12 flex gap-10">
          <Stat value={formatCount(SHOWCASE_STATS.totalAssets)} label="Assets" />
          <Stat value={String(SHOWCASE_STATS.totalCreators)} label="Creators" />
          <Stat value={formatCount(SHOWCASE_STATS.totalInstalls)} label="Installs" />
        </div>
      </section>

      {/* ── Categories ── */}
      <section className="border-t border-[var(--border)] py-14">
        <h2 className="text-xs font-medium uppercase tracking-widest text-[var(--text-muted)]">
          Categories
        </h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <Link
              key={cat.kind}
              href={`/search?kind=${cat.kind}`}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-bright)] hover:text-[var(--text-primary)] transition-colors"
            >
              {cat.title}
              <span className="ml-1.5 text-[var(--text-muted)]">{cat.count}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Featured ── */}
      <section className="border-t border-[var(--border)] py-14">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg font-semibold">
            {hasRealData ? 'Popular' : 'Showcase'}
          </h2>
          <Link
            href="/search"
            className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            View all <ArrowRight size={12} />
          </Link>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {hasRealData
            ? apiListings.map((listing) => <RealCard key={listing.listing_id} listing={listing} />)
            : SHOWCASE_LISTINGS.map((listing) => (
                <ShowcaseCard key={listing.listing_id} listing={listing} />
              ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="border-t border-[var(--border)] py-20 text-center">
        <h2 className="font-display text-2xl font-bold">Build your AI company</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Download Offisim Desktop and start assembling your team.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/search"
            className="rounded-lg bg-[var(--accent-indigo)] px-6 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
          >
            Browse Assets
          </Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-[var(--border)] px-6 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-bright)] transition-colors"
          >
            GitHub
          </a>
        </div>
      </section>
    </div>
  );
}

/* ── Sub-components ── */

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-mono text-2xl font-bold text-[var(--text-primary)]">{value}</div>
      <div className="mt-0.5 text-xs text-[var(--text-muted)]">{label}</div>
    </div>
  );
}

function ShowcaseCard({ listing }: { listing: ShowcaseListing }) {
  return (
    <div className="card flex flex-col p-4">
      <div className="flex items-center justify-between">
        <span
          className={`badge-${listing.kind} rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase`}
        >
          {KIND_LABELS[listing.kind]}
        </span>
        <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <Star size={11} className="text-amber-400 fill-amber-400" />
          {listing.rating}
        </span>
      </div>
      <h3 className="mt-2.5 text-sm font-semibold text-[var(--text-primary)]">{listing.title}</h3>
      <p className="mt-1 flex-1 text-xs text-[var(--text-muted)] leading-relaxed">
        {listing.summary.length > 100 ? `${listing.summary.slice(0, 100)}…` : listing.summary}
      </p>
      <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-2.5 text-xs text-[var(--text-muted)]">
        <span>
          by <span className="text-[var(--text-secondary)]">{listing.creator_name}</span>
        </span>
        <span className="font-mono text-[10px]">{formatCount(listing.install_count)} installs</span>
      </div>
    </div>
  );
}

function RealCard({ listing }: { listing: ListingSummary }) {
  return (
    <Link href={`/listing/${listing.slug}`} className="card flex flex-col p-4">
      <div className="flex items-center justify-between">
        <span
          className={`badge-${listing.kind} rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase`}
        >
          {KIND_LABELS[listing.kind] ?? listing.kind}
        </span>
        {listing.rating > 0 && (
          <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
            <Star size={11} className="text-amber-400 fill-amber-400" />
            {listing.rating.toFixed(1)}
          </span>
        )}
      </div>
      <h3 className="mt-2.5 text-sm font-semibold text-[var(--text-primary)]">{listing.title}</h3>
      <p className="mt-1 flex-1 text-xs text-[var(--text-muted)] leading-relaxed">
        {listing.summary && listing.summary.length > 100
          ? `${listing.summary.slice(0, 100)}…`
          : listing.summary}
      </p>
      <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-2.5 text-xs text-[var(--text-muted)]">
        <span>
          by{' '}
          <span className="text-[var(--text-secondary)]">
            {listing.creator?.display_name ?? listing.creator?.handle}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <Download size={11} />
          {formatCount(listing.install_count)}
        </span>
      </div>
    </Link>
  );
}
