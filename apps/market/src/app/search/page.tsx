export const dynamic = 'force-dynamic';

import type { SearchParams, SearchResponse } from '@offisim/registry-client';
import { ListingCard, SearchFilters } from '@offisim/ui-market';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { getRegistryClient } from '../../lib/registry';

interface Props {
  searchParams: Promise<Record<string, string | undefined>>;
}

const SEARCH_KINDS: Array<NonNullable<SearchParams['kind']>> = [
  'employee',
  'skill',
  'sop',
  'company_template',
  'office_layout',
  'bundle',
  'prefab',
];

const SEARCH_SORTS: Array<NonNullable<SearchParams['sort']>> = [
  'relevance',
  'newest',
  'updated',
  'rating',
  'installs',
];

function pickSearchParam<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value && allowed.includes(value as T) ? (value as T) : undefined;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const q = params.q;
  const title = q ? `"${q}" — Search` : 'Browse Assets';
  const description = q
    ? `Search results for "${q}" on Offisim Market.`
    : 'Browse AI company employees, skills, SOPs, and templates.';
  return {
    title,
    description,
    alternates: { canonical: '/search' },
    openGraph: { title: `${title} — Offisim Market`, description },
    twitter: { card: 'summary', title, description },
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const client = getRegistryClient();

  let result: SearchResponse;
  try {
    result = await client.searchListings({
      q: params.q,
      kind: pickSearchParam(params.kind, SEARCH_KINDS),
      tag: params.tag,
      sort: pickSearchParam(params.sort, SEARCH_SORTS) ?? 'relevance',
      page: params.page ? Number.parseInt(params.page, 10) : 1,
      per_page: 20,
    });
  } catch {
    result = { items: [], page: 1, per_page: 20, total: 0 };
  }

  const totalPages = Math.ceil(result.total / result.per_page);

  return (
    <div className="mx-auto max-w-content px-6 py-10">
      {/* Search bar */}
      <form method="get" action="/search" className="mb-8">
        <div className="flex gap-3">
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Search employees, skills, SOPs..."
            className="flex-1 rounded-lg border border-[var(--border-bright)] bg-[var(--bg-input)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-indigo)]/50 transition-colors"
            aria-label="Search assets"
          />
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
          >
            Search
          </button>
        </div>
      </form>

      {/* Filters */}
      <div className="mb-6 flex items-center justify-between">
        <Suspense fallback={null}>
          <SearchFilters />
        </Suspense>
        <span className="text-sm text-[var(--text-muted)]">
          {result.total} {result.total === 1 ? 'result' : 'results'}
        </span>
      </div>

      {/* Results */}
      {result.items.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.items.map((listing) => (
              <ListingCard key={listing.listing_id} listing={listing} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav className="mt-10 flex justify-center gap-2" aria-label="Pagination">
              {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map((p) => {
                const qs = new URLSearchParams();
                if (params.q) qs.set('q', params.q);
                if (params.kind) qs.set('kind', params.kind);
                if (params.sort) qs.set('sort', params.sort);
                qs.set('page', String(p));
                return (
                  <Link
                    key={p}
                    href={`/search?${qs}`}
                    className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      p === result.page
                        ? 'bg-indigo-600 text-white'
                        : 'border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-bright)]'
                    }`}
                  >
                    {p}
                  </Link>
                );
              })}
            </nav>
          )}
        </>
      ) : (
        <div className="card rounded-lg py-16 text-center">
          <p className="text-[var(--text-muted)]">No assets found matching your criteria.</p>
          <Link
            href="/search"
            className="mt-4 inline-block text-sm text-[var(--accent-indigo)] hover:underline"
          >
            Clear filters
          </Link>
        </div>
      )}
    </div>
  );
}
