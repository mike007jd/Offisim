'use client';

import { useState } from 'react';
import { PLATFORM_API_URL } from '../lib/config.js';
import { useAuthContext } from './AuthProvider.js';

const REPORT_REASONS = [
  { value: 'spam', label: 'Spam' },
  { value: 'malicious_code', label: 'Malicious Code' },
  { value: 'copyright', label: 'Copyright Violation' },
  { value: 'misleading', label: 'Misleading Content' },
  { value: 'other', label: 'Other' },
] as const;

export interface ReportDialogProps {
  listingId: string;
}

export function ReportDialog({ listingId }: ReportDialogProps) {
  const auth = useAuthContext();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!auth.user) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(
        `${PLATFORM_API_URL}/v1/market/listings/${listingId}/reports`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ reason, details: details.trim() || undefined }),
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: { message: 'Report failed' } }));
        const msg =
          (body as { error?: { message?: string } }).error?.message ??
          (body as { message?: string }).message ??
          'Report failed';
        throw new Error(msg);
      }

      setSubmitted(true);
      setTimeout(() => setOpen(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Report failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-rose)] transition-colors"
      >
        Report
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-[var(--bg-secondary)] p-6 shadow-none border border-[var(--border-bright)]">
            <h3 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">Report Listing</h3>

            {submitted ? (
              <div className="py-6 text-center">
                <p className="text-sm text-[var(--success)] font-medium">
                  Report submitted. Thank you for helping keep the marketplace safe.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <fieldset className="mb-4">
                  <legend className="mb-2 text-sm font-medium text-[var(--text-secondary)]">Reason</legend>
                  <div className="space-y-2">
                    {REPORT_REASONS.map((r) => (
                      <label key={r.value} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                        <input
                          type="radio"
                          name="report-reason"
                          value={r.value}
                          checked={reason === r.value}
                          onChange={() => setReason(r.value)}
                          className="accent-blue-600"
                        />
                        {r.label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="mb-4">
                  <label htmlFor="report-details" className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
                    Additional details (optional)
                  </label>
                  <textarea
                    id="report-details"
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    maxLength={1000}
                    rows={3}
                    disabled={submitting}
                    placeholder="Provide any additional context..."
                    className="w-full rounded-md border border-[var(--border-bright)] px-3 py-2 text-sm placeholder-[var(--text-muted)] focus:border-[var(--accent-indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-indigo)] disabled:opacity-50"
                  />
                </div>

                {error && (
                  <p role="alert" className="mb-3 rounded-md bg-[var(--accent-rose)]/10 px-3 py-2 text-sm text-[var(--accent-rose)]">
                    {error}
                  </p>
                )}

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={submitting}
                    className="rounded-md px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !reason}
                    className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? 'Submitting...' : 'Submit Report'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
