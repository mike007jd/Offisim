import type { Review } from '@aics/registry-client';
import { formatDate } from '../lib/format.js';
import { RatingStars } from './RatingStars.js';

export function ReviewList({ reviews }: { reviews: Review[] }) {
  if (reviews.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">No reviews yet.</p>;
  }

  return (
    <div className="space-y-4">
      {reviews.map((r) => (
        <div key={r.review_id} className="border-b border-[var(--border)] pb-4">
          <div className="flex items-center gap-2">
            <RatingStars rating={r.rating} />
            {r.title && <span className="font-medium text-[var(--text-primary)]">{r.title}</span>}
          </div>
          {r.body && <p className="mt-1 text-sm text-[var(--text-secondary)]">{r.body}</p>}
          <p className="mt-1 text-xs text-[var(--text-muted)]">{formatDate(r.created_at)}</p>
        </div>
      ))}
    </div>
  );
}
