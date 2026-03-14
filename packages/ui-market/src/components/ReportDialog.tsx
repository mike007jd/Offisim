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
  authToken?: string | null;
}

export function ReportDialog({ listingId, authToken }: ReportDialogProps) {
  const auth = useAuthContext();
  const token = authToken ?? auth.token;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) return null;

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
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
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
        className="text-xs text-gray-400 hover:text-red-500 transition-colors"
      >
        Report
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-gray-900">Report Listing</h3>

            {submitted ? (
              <div className="py-6 text-center">
                <p className="text-sm text-green-600 font-medium">
                  Report submitted. Thank you for helping keep the marketplace safe.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <fieldset className="mb-4">
                  <legend className="mb-2 text-sm font-medium text-gray-700">Reason</legend>
                  <div className="space-y-2">
                    {REPORT_REASONS.map((r) => (
                      <label key={r.value} className="flex items-center gap-2 text-sm text-gray-700">
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
                  <label htmlFor="report-details" className="mb-1 block text-sm font-medium text-gray-700">
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
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                  />
                </div>

                {error && (
                  <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                    {error}
                  </p>
                )}

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={submitting}
                    className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
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
