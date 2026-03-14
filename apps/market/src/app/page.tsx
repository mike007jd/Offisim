export const revalidate = 60;

import type { ListingSummary } from '@aics/registry-client';
import { Users, Zap, GitBranch, Building2, LayoutGrid, Package, Star, Download, ArrowRight, Search, Monitor } from 'lucide-react';
import { getRegistryClient } from '../lib/registry';
import { SHOWCASE_LISTINGS, SHOWCASE_STATS, CATEGORIES, type ShowcaseListing } from '../lib/showcase';

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  user: <Users size={22} />,
  zap: <Zap size={22} />,
  workflow: <GitBranch size={22} />,
  building: <Building2 size={22} />,
  layout: <LayoutGrid size={22} />,
  package: <Package size={22} />,
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

export default async function Home() {
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
    <div>
      {/* ============================================================ */}
      {/* HERO                                                         */}
      {/* ============================================================ */}
      <section className="hero-gradient relative">
        <div className="relative mx-auto max-w-content px-6 pb-20 pt-24 sm:pb-28 sm:pt-32">
          {/* Overline */}
          <div className="animate-fade-up mb-6 flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-[pulse-glow_3s_ease-in-out_infinite]" />
            <span className="text-sm font-medium tracking-wide text-emerald-400/80 uppercase">
              Open Source AI Workforce
            </span>
          </div>

          {/* Headline */}
          <h1 className="animate-fade-up delay-100 font-display text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
            <span className="text-[var(--text-primary)]">Hire AI Talent</span>
            <br />
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-blue-400 bg-clip-text text-transparent">
              for Your Virtual Company
            </span>
          </h1>

          {/* Subtitle */}
          <p className="animate-fade-up delay-200 mt-6 max-w-xl text-lg leading-relaxed text-[var(--text-secondary)]">
            Browse AI employees, skills, SOPs, and company templates.
            Install into your local runtime with one click. Build the team you need.
          </p>

          {/* Search bar */}
          <div className="animate-fade-up delay-300 mt-10 flex max-w-lg gap-3">
            <form method="get" action="/search" className="flex flex-1 gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="search"
                  name="q"
                  placeholder="Search employees, skills, SOPs..."
                  className="w-full rounded-xl border border-[var(--border-bright)] bg-[var(--bg-input)] py-3 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-indigo)]/50 transition-colors"
                  aria-label="Search assets"
                />
              </div>
              <button
                type="submit"
                className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
              >
                Search
              </button>
            </form>
          </div>

          {/* Stats row */}
          <div className="animate-fade-up delay-400 mt-14 flex flex-wrap gap-8 sm:gap-12">
            <StatItem value={`${formatCount(SHOWCASE_STATS.totalAssets)}+`} label="Assets" />
            <StatItem value={`${SHOWCASE_STATS.totalCreators}+`} label="Creators" />
            <StatItem value={`${formatCount(SHOWCASE_STATS.totalInstalls)}+`} label="Installs" />
            <StatItem value={String(SHOWCASE_STATS.categories)} label="Categories" />
          </div>
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[var(--bg-base)] to-transparent" />
      </section>

      {/* ============================================================ */}
      {/* CATEGORIES                                                    */}
      {/* ============================================================ */}
      <section className="relative mx-auto max-w-content px-6 py-20">
        <SectionHeader
          overline="Categories"
          title="Browse by Type"
          subtitle="Find exactly what your AI company needs."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((cat, i) => (
            <a
              key={cat.kind}
              href={`/search?kind=${cat.kind}`}
              className={`card card-glow group relative overflow-hidden p-5 animate-fade-up delay-${(i + 1) * 100}`}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${cat.gradient} opacity-0 group-hover:opacity-100 transition-opacity`} />
              <div className="relative flex items-start gap-4">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg border ${cat.border} bg-[var(--bg-surface)] ${cat.accent}`}>
                  {CATEGORY_ICONS[cat.icon]}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-sm font-bold text-[var(--text-primary)]">
                      {cat.title}
                    </h3>
                    <span className="text-xs text-[var(--text-muted)]">{cat.count}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                    {cat.description}
                  </p>
                </div>
              </div>
            </a>
          ))}
        </div>
      </section>

      <div className="section-divider mx-auto max-w-content" />

      {/* ============================================================ */}
      {/* FEATURED / SHOWCASE                                           */}
      {/* ============================================================ */}
      <section className="relative mx-auto max-w-content px-6 py-20">
        <SectionHeader
          overline="Featured"
          title={hasRealData ? 'Popular Assets' : 'Showcase'}
          subtitle={
            hasRealData
              ? 'Top-installed assets from our community.'
              : 'Preview what the marketplace has to offer.'
          }
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {hasRealData
            ? apiListings.map((listing, i) => (
                <RealListingCard key={listing.listing_id} listing={listing} index={i} />
              ))
            : SHOWCASE_LISTINGS.map((listing, i) => (
                <ShowcaseCard key={listing.listing_id} listing={listing} index={i} />
              ))}
        </div>
        <div className="mt-8 text-center">
          <a
            href="/search"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-bright)] px-6 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-indigo)]/50 transition-colors"
          >
            Browse all assets
            <ArrowRight size={14} />
          </a>
        </div>
      </section>

      <div className="section-divider mx-auto max-w-content" />

      {/* ============================================================ */}
      {/* HOW IT WORKS                                                  */}
      {/* ============================================================ */}
      <section className="relative mx-auto max-w-content px-6 py-20">
        <SectionHeader
          overline="How It Works"
          title="Three Steps to Your AI Team"
          subtitle="From discovery to running your company in minutes."
        />
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          <StepCard
            number="01"
            title="Browse & Discover"
            description="Search the marketplace for AI employees, skills, SOPs, and company templates that fit your needs."
            icon={<Search size={24} />}
          />
          <StepCard
            number="02"
            title="One-Click Install"
            description="Install assets directly into your AICS Desktop runtime. Permissions are reviewed before install — no hidden surprises."
            icon={<Download size={24} />}
          />
          <StepCard
            number="03"
            title="Run Your Company"
            description="Watch your AI team collaborate in the office scene. Assign tasks, run SOPs, and observe the results in real-time."
            icon={<Monitor size={24} />}
          />
        </div>
      </section>

      {/* ============================================================ */}
      {/* CTA                                                           */}
      {/* ============================================================ */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 hero-gradient" />
        <div className="relative mx-auto max-w-content px-6 py-24 text-center">
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            <span className="text-[var(--text-primary)]">Ready to Build Your </span>
            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              AI Company?
            </span>
          </h2>
          <p className="mx-auto mt-4 max-w-md text-[var(--text-secondary)]">
            Download AICS Desktop, browse the marketplace, and assemble your team.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <a
              href="/search"
              className="rounded-xl bg-indigo-600 px-8 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
            >
              Browse Assets
            </a>
            <a
              href="https://github.com/anthropics/aics"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-[var(--border-bright)] px-8 py-3 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-indigo)]/50 transition-colors"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components (server, co-located)                                 */
/* ------------------------------------------------------------------ */

function StatItem({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="stat-value font-display text-2xl font-extrabold sm:text-3xl">{value}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </div>
    </div>
  );
}

function SectionHeader({
  overline,
  title,
  subtitle,
}: {
  overline: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <span className="text-xs font-semibold uppercase tracking-widest text-[var(--accent-indigo)]">
        {overline}
      </span>
      <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
        {title}
      </h2>
      <p className="mt-2 text-[var(--text-secondary)]">{subtitle}</p>
    </div>
  );
}

function ShowcaseCard({ listing, index }: { listing: ShowcaseListing; index: number }) {
  return (
    <div
      className={`card card-glow flex flex-col p-5 animate-fade-up`}
      style={{ animationDelay: `${(index + 1) * 80}ms` }}
    >
      <div className="flex items-center justify-between">
        <span className={`badge-${listing.kind} rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide`}>
          {KIND_LABELS[listing.kind]}
        </span>
        <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <Star size={12} className="text-amber-400 fill-amber-400" />
          <span>{listing.rating}</span>
        </div>
      </div>
      <h3 className="mt-3 font-display text-base font-bold text-[var(--text-primary)]">
        {listing.title}
      </h3>
      <p className="mt-1.5 flex-1 text-xs leading-relaxed text-[var(--text-muted)]">
        {listing.summary.length > 120 ? `${listing.summary.slice(0, 120)}…` : listing.summary}
      </p>
      <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3">
        <span className="text-xs text-[var(--text-muted)]">
          by <span className="text-[var(--text-secondary)]">{listing.creator_name}</span>
        </span>
        <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
          <span className="flex items-center gap-1">
            <Download size={11} />
            {formatCount(listing.install_count)}
          </span>
          <span className="font-mono text-[10px]">v{listing.latest_version}</span>
        </div>
      </div>
    </div>
  );
}

function RealListingCard({ listing, index }: { listing: ListingSummary; index: number }) {
  return (
    <a
      href={`/listing/${listing.slug}`}
      className={`card card-glow flex flex-col p-5 animate-fade-up`}
      style={{ animationDelay: `${(index + 1) * 80}ms` }}
    >
      <div className="flex items-center justify-between">
        <span className={`badge-${listing.kind} rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide`}>
          {KIND_LABELS[listing.kind] ?? listing.kind}
        </span>
        {listing.rating > 0 && (
          <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
            <Star size={12} className="text-amber-400 fill-amber-400" />
            <span>{listing.rating.toFixed(1)}</span>
          </div>
        )}
      </div>
      <h3 className="mt-3 font-display text-base font-bold text-[var(--text-primary)]">
        {listing.title}
      </h3>
      <p className="mt-1.5 flex-1 text-xs leading-relaxed text-[var(--text-muted)]">
        {listing.summary && listing.summary.length > 120
          ? `${listing.summary.slice(0, 120)}…`
          : listing.summary}
      </p>
      <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3">
        <span className="text-xs text-[var(--text-muted)]">
          by{' '}
          <span className="text-[var(--text-secondary)]">
            {listing.creator?.display_name ?? listing.creator?.handle}
          </span>
        </span>
        <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <Download size={11} />
          {formatCount(listing.install_count)}
        </span>
      </div>
    </a>
  );
}

function StepCard({
  number,
  title,
  description,
  icon,
}: {
  number: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="card relative overflow-hidden p-6">
      <span className="absolute -top-3 -right-2 font-display text-6xl font-extrabold text-[var(--border)] select-none">
        {number}
      </span>
      <div className="relative">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-bright)] bg-[var(--bg-surface)] text-[var(--accent-indigo)]">
          {icon}
        </div>
        <h3 className="mt-4 font-display text-lg font-bold text-[var(--text-primary)]">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{description}</p>
      </div>
    </div>
  );
}
