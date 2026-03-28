export const revalidate = 300;

import type { ListingDetail } from '@offisim/registry-client';
import {
  CreatorBadge,
  ForkButton,
  ForkList,
  InstallButton,
  KindIcon,
  PermissionsPanel,
  RatingStars,
  ReportDialog,
  ReviewForm,
  ReviewList,
  VersionTable,
} from '@offisim/ui-market';
import { formatInstallCount, kindLabel } from '@offisim/ui-market';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listingJsonLd, stringifyJsonLd } from '../../../lib/jsonld';
import { getRegistryClient } from '../../../lib/registry';
import { SITE_URL } from '../../../lib/url';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const client = getRegistryClient();
    const listing = await client.getListingBySlug(slug);
    const title = `${listing.title} — Offisim Market`;
    return {
      title: listing.title,
      description: listing.summary,
      alternates: { canonical: `/listing/${slug}` },
      openGraph: {
        type: 'article',
        title,
        description: listing.summary,
        url: `${SITE_URL}/listing/${slug}`,
      },
      twitter: { card: 'summary', title, description: listing.summary },
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

  const [versionsData, reviewsData, forksData] = await Promise.all([
    client
      .listListingVersions(listing.listing_id)
      .catch(() => ({ listing_id: listing.listing_id, versions: [] })),
    client
      .listListingReviews(listing.listing_id)
      .catch(() => ({ listing_id: listing.listing_id, reviews: [] })),
    client.getListingForks(listing.listing_id).catch(() => ({ forks: [] })),
  ]);

  return (
    <div className="mx-auto max-w-content px-6 py-10">
      <script type="application/ld+json">{stringifyJsonLd(listingJsonLd(listing))}</script>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <KindIcon kind={listing.kind} size={24} />
          <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            {listing.title}
          </h1>
          <span className={`badge-${listing.kind} rounded-md px-2.5 py-0.5 text-xs font-semibold`}>
            {kindLabel(listing.kind)}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-4">
          <CreatorBadge
            handle={listing.creator.handle}
            display_name={listing.creator.display_name}
            verification_state={listing.creator.verification_state}
          />
          <RatingStars rating={listing.rating} count={listing.install_count} />
          <span className="text-sm text-[var(--text-muted)]">
            {formatInstallCount(listing.install_count)} installs
          </span>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-8 lg:col-span-2">
          {/* Install bar + Fork */}
          <div className="card flex flex-wrap items-center gap-4 p-5">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono text-xs text-[var(--text-muted)]">
                  v{listing.version?.version ?? listing.latest_version}
                </span>
                {listing.version && (
                  <>
                    <span className="text-[var(--border-bright)]">&middot;</span>
                    <span className="font-mono text-xs text-[var(--text-muted)]">
                      runtime {listing.version.runtime_range}
                    </span>
                    <span className="text-[var(--border-bright)]">&middot;</span>
                    {listing.version.environments.map((env) => (
                      <span
                        key={env}
                        className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-xs text-[var(--text-muted)]"
                      >
                        {env}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>
            <ForkButton
              listingId={listing.listing_id}
              version={listing.version?.version ?? listing.latest_version}
              forkCount={forksData.forks.length}
            />
            <InstallButton
              listingId={listing.listing_id}
              version={listing.version?.version ?? listing.latest_version}
              packageVersionId={listing.version?.package_version_id}
              title={listing.title}
            />
          </div>

          {/* Description */}
          <section>
            <h2 className="mb-3 font-display text-lg font-bold text-[var(--text-primary)]">
              Description
            </h2>
            <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
              {listing.description || (
                <p className="italic text-[var(--text-muted)]">No description provided.</p>
              )}
            </div>
          </section>

          {/* Requirements */}
          {listing.requirements && (
            <section>
              <h2 className="mb-3 font-display text-lg font-bold text-[var(--text-primary)]">
                Requirements
              </h2>
              <div className="space-y-2 text-sm">
                {listing.requirements.required_capabilities &&
                  listing.requirements.required_capabilities.length > 0 && (
                    <div>
                      <span className="font-medium text-[var(--text-secondary)]">
                        Capabilities:{' '}
                      </span>
                      <span className="text-[var(--text-muted)]">
                        {listing.requirements.required_capabilities.join(', ')}
                      </span>
                    </div>
                  )}
                {listing.requirements.required_mcps &&
                  listing.requirements.required_mcps.length > 0 && (
                    <div>
                      <span className="font-medium text-[var(--text-secondary)]">
                        Required MCPs:{' '}
                      </span>
                      <span className="text-[var(--text-muted)]">
                        {listing.requirements.required_mcps.join(', ')}
                      </span>
                    </div>
                  )}
                {listing.requirements.recommended_models &&
                  listing.requirements.recommended_models.length > 0 && (
                    <div>
                      <span className="font-medium text-[var(--text-secondary)]">
                        Recommended models:{' '}
                      </span>
                      <span className="text-[var(--text-muted)]">
                        {listing.requirements.recommended_models.map((m) => m.profile).join(', ')}
                      </span>
                      <p className="mt-1 text-xs text-[var(--text-muted)] opacity-60">
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
                <h2 className="mb-3 font-display text-lg font-bold text-[var(--text-primary)]">
                  Lineage
                </h2>
                <div className="text-sm text-[var(--text-muted)]">
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

          {/* Forks */}
          <section>
            <h2 className="mb-3 font-display text-lg font-bold text-[var(--text-primary)]">
              Forks
            </h2>
            <ForkList forks={forksData.forks} />
          </section>

          {/* Versions */}
          <section>
            <h2 className="mb-3 font-display text-lg font-bold text-[var(--text-primary)]">
              Versions
            </h2>
            <VersionTable versions={versionsData.versions} />
          </section>

          {/* Reviews */}
          <section>
            <h2 className="mb-3 font-display text-lg font-bold text-[var(--text-primary)]">
              Reviews
            </h2>
            <ReviewList reviews={reviewsData.reviews} />
          </section>

          {/* Write a Review */}
          <section>
            <h2 className="mb-3 font-display text-lg font-bold text-[var(--text-primary)]">
              Write a Review
            </h2>
            <ReviewForm listingId={listing.listing_id} />
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <PermissionsPanel permissions={listing.permissions} />

          {listing.tags && listing.tags.length > 0 && (
            <div className="card p-5">
              <h3 className="mb-3 text-sm font-bold text-[var(--text-primary)]">Tags</h3>
              <div className="flex flex-wrap gap-1.5">
                {listing.tags.map((tag) => (
                  <Link
                    key={tag}
                    href={`/search?tag=${tag}`}
                    className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-0.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--border-bright)] transition-colors"
                  >
                    {tag}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Report */}
          <div className="card p-5">
            <ReportDialog listingId={listing.listing_id} />
          </div>
        </div>
      </div>
    </div>
  );
}
