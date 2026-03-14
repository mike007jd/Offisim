export const revalidate = 300;

import type { ListingDetail } from '@aics/registry-client';
import { CreatorBadge, InstallButton, KindIcon, PermissionsPanel, RatingStars, ReviewList, VersionTable } from '@aics/ui-market';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatInstallCount, kindLabel } from '@aics/ui-market';
import { getRegistryClient } from '../../../lib/registry';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const client = getRegistryClient();
    const listing = await client.getListingBySlug(slug);
    return {
      title: listing.title,
      description: listing.summary,
      openGraph: {
        title: `${listing.title} — AICS Talent Market`,
        description: listing.summary,
      },
    };
  } catch {
    return { title: 'Asset Not Found' };
  }
}

export default async function ListingPage({ params }: Props) {
  const { slug } = await params;
  const client = getRegistryClient();

  let listing: ListingDetail;
  try {
    listing = await client.getListingBySlug(slug);
  } catch {
    notFound();
  }

  const [versionsData, reviewsData] = await Promise.all([
    client
      .listListingVersions(listing.listing_id)
      .catch(() => ({ listing_id: listing.listing_id, versions: [] })),
    client
      .listListingReviews(listing.listing_id)
      .catch(() => ({ listing_id: listing.listing_id, reviews: [] })),
  ]);

  return (
    <div className="mx-auto max-w-content px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <KindIcon kind={listing.kind} size={24} />
          <h1 className="text-2xl font-bold text-gray-900">{listing.title}</h1>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {kindLabel(listing.kind)}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-4">
          <CreatorBadge
            handle={listing.creator.handle}
            display_name={listing.creator.display_name}
            verification_state={listing.creator.verification_state}
          />
          <RatingStars rating={listing.rating} count={listing.install_count} />
          <span className="text-sm text-gray-500">
            {formatInstallCount(listing.install_count)} installs
          </span>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-8 lg:col-span-2">
          {/* Install bar */}
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono text-xs text-gray-600">
                  v{listing.version?.version ?? listing.latest_version}
                </span>
                {listing.version && (
                  <>
                    <span className="text-gray-300">&middot;</span>
                    <span className="font-mono text-xs text-gray-600">
                      runtime {listing.version.runtime_range}
                    </span>
                    <span className="text-gray-300">&middot;</span>
                    {listing.version.environments.map((env) => (
                      <span
                        key={env}
                        className="rounded bg-white px-1.5 py-0.5 text-xs border border-gray-200"
                      >
                        {env}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>
            <InstallButton
              listingId={listing.listing_id}
              version={listing.version?.version ?? listing.latest_version}
              title={listing.title}
            />
          </div>

          {/* Description */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">Description</h2>
            <div className="prose prose-sm max-w-none text-gray-700">
              {listing.description || (
                <p className="text-gray-400 italic">No description provided.</p>
              )}
            </div>
          </section>

          {/* Requirements */}
          {listing.requirements && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-gray-900">Requirements</h2>
              <div className="space-y-2 text-sm">
                {listing.requirements.required_capabilities &&
                  listing.requirements.required_capabilities.length > 0 && (
                    <div>
                      <span className="font-medium text-gray-700">Capabilities: </span>
                      {listing.requirements.required_capabilities.join(', ')}
                    </div>
                  )}
                {listing.requirements.required_mcps &&
                  listing.requirements.required_mcps.length > 0 && (
                    <div>
                      <span className="font-medium text-gray-700">Required MCPs: </span>
                      {listing.requirements.required_mcps.join(', ')}
                    </div>
                  )}
                {listing.requirements.recommended_models &&
                  listing.requirements.recommended_models.length > 0 && (
                    <div>
                      <span className="font-medium text-gray-700">Recommended models: </span>
                      {listing.requirements.recommended_models.map((m) => m.profile).join(', ')}
                      <p className="mt-1 text-xs text-gray-400">
                        Model recommendations are suggestions only. Your local runtime determines
                        the actual model used.
                      </p>
                    </div>
                  )}
              </div>
            </section>
          )}

          {/* Lineage */}
          {listing.lineage &&
            (listing.lineage.origin_package_id || listing.lineage.forked_from_version) && (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-gray-900">Lineage</h2>
                <div className="text-sm text-gray-600">
                  {listing.lineage.origin_package_id && (
                    <p>
                      Derived from:{' '}
                      <span className="font-mono text-xs">{listing.lineage.origin_package_id}</span>
                    </p>
                  )}
                  {listing.lineage.forked_from_version && (
                    <p>
                      Forked from version:{' '}
                      <span className="font-mono text-xs">
                        {listing.lineage.forked_from_version}
                      </span>
                    </p>
                  )}
                </div>
              </section>
            )}

          {/* Versions */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">Versions</h2>
            <VersionTable versions={versionsData.versions} />
          </section>

          {/* Reviews */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">Reviews</h2>
            <ReviewList reviews={reviewsData.reviews} />
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <PermissionsPanel permissions={listing.permissions} />

          {listing.tags && listing.tags.length > 0 && (
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Tags</h3>
              <div className="flex flex-wrap gap-1">
                {listing.tags.map((tag) => (
                  <a
                    key={tag}
                    href={`/search?tag=${tag}`}
                    className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200"
                  >
                    {tag}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
