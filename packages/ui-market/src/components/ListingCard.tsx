import type { ListingSummary } from '@aics/registry-client';
import { formatInstallCount, kindLabel } from '../lib/format.js';
import { CreatorBadge } from './CreatorBadge.js';
import { KindIcon } from './KindIcon.js';
import { RatingStars } from './RatingStars.js';

export function ListingCard({ listing }: { listing: ListingSummary }) {
  return (
    <a
      href={`/listing/${listing.slug}`}
      className="block rounded-lg border border-[var(--border)] p-4 transition-shadow  focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <KindIcon kind={listing.kind} size={18} />
          <h3 className="font-semibold text-[var(--text-primary)] line-clamp-1">{listing.title}</h3>
        </div>
        <RatingStars rating={listing.rating} />
      </div>

      <div className="mt-1">
        <CreatorBadge
          handle={listing.creator.handle}
          display_name={listing.creator.display_name}
          verification_state={listing.creator.verification_state}
        />
        <span className="mx-1.5 text-[var(--text-muted)]">&middot;</span>
        <span className="text-xs text-[var(--text-muted)]">{kindLabel(listing.kind)}</span>
      </div>

      <p className="mt-2 text-sm text-[var(--text-secondary)] line-clamp-2">{listing.summary}</p>

      <div className="mt-3 flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <span>v{listing.latest_version}</span>
        <span className="text-[var(--text-muted)]">&middot;</span>
        <span>{formatInstallCount(listing.install_count)} installs</span>
        {listing.tags && listing.tags.length > 0 && (
          <>
            <span className="text-[var(--text-muted)]">&middot;</span>
            {listing.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5">
                {tag}
              </span>
            ))}
          </>
        )}
      </div>
    </a>
  );
}
