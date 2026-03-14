export const revalidate = 60;

import type { ListingSummary } from '@aics/registry-client';
import { ListingCard } from '@aics/ui-market';
import { getRegistryClient } from '../lib/registry';

export default async function Home() {
  let listings: ListingSummary[];
  try {
    const client = getRegistryClient();
    const result = await client.searchListings({ sort: 'installs', per_page: 12 });
    listings = result.items;
  } catch {
    listings = [];
  }

  return (
    <div className="mx-auto max-w-content px-6 py-8">
      <section className="mb-12">
        <h1 className="text-2xl font-bold text-gray-900">Discover AI Company Assets</h1>
        <p className="mt-2 text-gray-600">
          Browse employees, skills, SOPs, and templates for your AI company.
        </p>
      </section>

      {listings.length > 0 ? (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Popular</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <ListingCard key={listing.listing_id} listing={listing} />
            ))}
          </div>
          <div className="mt-6 text-center">
            <a
              href="/search"
              className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Browse all assets
            </a>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-gray-200 py-12 text-center">
          <p className="text-gray-500">No listings available yet. Check back soon.</p>
        </section>
      )}
    </div>
  );
}
