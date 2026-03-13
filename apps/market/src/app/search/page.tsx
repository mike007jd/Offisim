import type { Metadata } from 'next';
import { ListingCard, SearchFilters } from '@aics/ui-market';
import { Suspense } from 'react';
import { getRegistryClient } from '../../lib/registry';

interface Props {
  searchParams: Promise<Record<string, string | undefined>>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const q = params.q;
  return {
    title: q ? `"${q}" — Search` : 'Browse Assets',
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const client = getRegistryClient();

  let result;
  try {
    result = await client.searchListings({
      q: params.q,
      kind: params.kind as any,
      tag: params.tag,
      sort: (params.sort as any) ?? 'relevance',
      page: params.page ? Number.parseInt(params.page, 10) : 1,
      per_page: 20,
    });
  } catch {
    result = { items: [], page: 1, per_page: 20, total: 0 };
  }

  const totalPages = Math.ceil(result.total / result.per_page);

  return (
    <div className="mx-auto max-w-content px-6 py-8">
      {/* Search bar */}
      <form method="get" action="/search" className="mb-6">
        <div className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Search employees, skills, SOPs..."
            className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            aria-label="Search assets"
          />
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
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
        <span className="text-sm text-gray-500">
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
            <nav className="mt-8 flex justify-center gap-2" aria-label="Pagination">
              {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map((p) => {
                const qs = new URLSearchParams();
                if (params.q) qs.set('q', params.q);
                if (params.kind) qs.set('kind', params.kind);
                if (params.sort) qs.set('sort', params.sort);
                qs.set('page', String(p));
                return (
                  <a
                    key={p}
                    href={`/search?${qs}`}
                    className={`rounded px-3 py-1 text-sm ${
                      p === result.page
                        ? 'bg-blue-600 text-white'
                        : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {p}
                  </a>
                );
              })}
            </nav>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-gray-200 py-12 text-center">
          <p className="text-gray-500">No assets found matching your criteria.</p>
        </div>
      )}
    </div>
  );
}
