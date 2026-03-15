'use client';

import { useState } from 'react';
import { PLATFORM_API_URL } from '../lib/config.js';
import { useAuthContext } from './AuthProvider.js';

export interface ReviewFormProps {
  listingId: string;
  authToken?: string | null;
}

function StarSelector({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  const [hovered, setHovered] = useState(0);

  return (
    <div className="flex gap-1" onMouseLeave={() => setHovered(0)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={disabled}
          onMouseEnter={() => setHovered(star)}
          onClick={() => onChange(star)}
          className={`text-2xl transition-colors disabled:cursor-not-allowed ${
            star <= (hovered || value)
              ? 'text-yellow-400'
              : 'text-gray-300'
          }`}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
        >
          &#9733;
        </button>
      ))}
    </div>
  );
}

export function ReviewForm({ listingId, authToken }: ReviewFormProps) {
  const auth = useAuthContext();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!auth.user && !authToken) {
    return (
      <p className="text-sm text-gray-400 italic">
        Sign in to leave a review.
      </p>
    );
  }

  if (submitted) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3">
        <p className="text-sm font-medium text-green-700">
          Review submitted successfully. Thank you!
        </p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating === 0) return;
    setSubmitting(true);
    setError(null);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${PLATFORM_API_URL}/v1/reviews`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          listing_id: listingId,
          rating,
          body: comment.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: { message: 'Review failed' } }));
        const msg =
          (body as { error?: { message?: string } }).error?.message ??
          (body as { message?: string }).message ??
          'Review failed';
        throw new Error(msg);
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Your rating</label>
        <StarSelector value={rating} onChange={setRating} disabled={submitting} />
      </div>

      <div>
        <label htmlFor="review-comment" className="mb-1 block text-sm font-medium text-gray-700">
          Comment (optional, max 500 chars)
        </label>
        <textarea
          id="review-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
          rows={3}
          disabled={submitting}
          placeholder="Share your experience with this asset..."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        />
        <p className="mt-1 text-xs text-gray-400">{comment.length}/500</p>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || rating === 0}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Submitting...' : 'Submit Review'}
      </button>
    </form>
  );
}
