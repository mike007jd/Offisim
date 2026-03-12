import type { ListingSummary } from '@aics/registry-client';
import { KindIcon } from './KindIcon';
import { RatingStars } from './RatingStars';
import { CreatorBadge } from './CreatorBadge';
import { formatInstallCount, kindLabel } from '../lib/format';

export function ListingCard({ listing }: { listing: ListingSummary }) {
  return (
    <a
      href={`/listing/${listing.slug}`}
      className="block rounded-lg border border-gray-200 p-4 transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <KindIcon kind={listing.kind} size={18} />
          <h3 className="font-semibold text-gray-900 line-clamp-1">{listing.title}</h3>
        </div>
        <RatingStars rating={listing.rating} />
      </div>

      <div className="mt-1">
        <CreatorBadge
          handle={listing.creator.handle}
          display_name={listing.creator.display_name}
          verification_state={listing.creator.verification_state}
        />
        <span className="mx-1.5 text-gray-300">&middot;</span>
        <span className="text-xs text-gray-500">{kindLabel(listing.kind)}</span>
      </div>

      <p className="mt-2 text-sm text-gray-600 line-clamp-2">{listing.summary}</p>

      <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
        <span>v{listing.latest_version}</span>
        <span className="text-gray-300">&middot;</span>
        <span>{formatInstallCount(listing.install_count)} installs</span>
        {listing.tags && listing.tags.length > 0 && (
          <>
            <span className="text-gray-300">&middot;</span>
            {listing.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5">
                {tag}
              </span>
            ))}
          </>
        )}
      </div>
    </a>
  );
}
