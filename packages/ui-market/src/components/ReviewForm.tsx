'use client';

import { useState } from 'react';
import { PLATFORM_API_URL } from '../lib/config.js';
import { useAuthContext } from './AuthProvider.js';

export interface ReviewFormProps {
  listingId: string;
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
              : 'text-[var(--text-muted)]'
          }`}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
        >
          &#9733;
        </button>
      ))}
    </div>
  );
}

export function ReviewForm({ listingId }: ReviewFormProps) {
  const auth = useAuthContext();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!auth.user) {
    return (
      <p className="text-sm text-[var(--text-muted)] italic">
        Sign in to leave a review.
      </p>
    );
  }

  if (submitted) {
    return (
      <div className="rounded-md border border-[rgba(34,197,94,0.2)] bg-[rgba(34,197,94,0.1)] px-4 py-3">
        <p className="text-sm font-medium text-[var(--success)]">
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
      const res = await fetch(`${PLATFORM_API_URL}/v1/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">Your rating</label>
        <StarSelector value={rating} onChange={setRating} disabled={submitting} />
      </div>

      <div>
        <label htmlFor="review-comment" className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
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
          className="w-full rounded-md border border-[var(--border-bright)] px-3 py-2 text-sm placeholder-[var(--text-muted)] focus:border-[var(--accent-indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-indigo)] disabled:opacity-50"
        />
        <p className="mt-1 text-xs text-[var(--text-muted)]">{comment.length}/500</p>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-[rgba(244,63,94,0.1)] px-3 py-2 text-sm text-[var(--accent-rose)]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || rating === 0}
        className="rounded-md bg-[var(--accent-indigo)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Submitting...' : 'Submit Review'}
      </button>
    </form>
  );
}
