import type { Review } from '@aics/registry-client';
import { RatingStars } from './RatingStars';
import { formatDate } from '../lib/format';

export function ReviewList({ reviews }: { reviews: Review[] }) {
  if (reviews.length === 0) {
    return <p className="text-sm text-gray-500">No reviews yet.</p>;
  }

  return (
    <div className="space-y-4">
      {reviews.map((r) => (
        <div key={r.review_id} className="border-b border-gray-100 pb-4">
          <div className="flex items-center gap-2">
            <RatingStars rating={r.rating} />
            {r.title && <span className="font-medium text-gray-900">{r.title}</span>}
          </div>
          {r.body && <p className="mt-1 text-sm text-gray-600">{r.body}</p>}
          <p className="mt-1 text-xs text-gray-400">{formatDate(r.created_at)}</p>
        </div>
      ))}
    </div>
  );
}
