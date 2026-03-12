'use client';

import { Copy, Download, ExternalLink, X } from 'lucide-react';
import { useCallback, useState } from 'react';

interface Props {
  listingId: string;
  version: string;
  title: string;
  /** Called when the user closes the modal */
  onClose: () => void;
}

/**
 * InstallModal — web fallback modal for non-desktop users.
 *
 * Shown on the marketplace website when a user clicks "Install in AICS"
 * but the desktop app did not open (or is not installed). Provides:
 * 1. A "Try Again" button to re-attempt the deep link
 * 2. A "Copy Install Link" button so the user can paste into the desktop app
 * 3. A download prompt to get the AICS Desktop app
 */
export function InstallModal({ listingId, version, title, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const deepLink = `aics://install?listing_id=${encodeURIComponent(listingId)}&version=${encodeURIComponent(version)}`;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(deepLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select from hidden input (handled by browser)
      console.warn('[InstallModal] Clipboard API unavailable');
    }
  }, [deepLink]);

  const handleRetry = useCallback(() => {
    window.location.href = deepLink;
  }, [deepLink]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      {/* Backdrop click to close */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Install &ldquo;{title}&rdquo;
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            This asset requires the AICS Desktop app to install.
          </p>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          {/* Retry deep link */}
          <button
            onClick={handleRetry}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            <Download size={16} />
            Open in AICS Desktop
          </button>

          {/* Copy link */}
          <button
            onClick={handleCopy}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-400"
          >
            <Copy size={16} />
            {copied ? 'Copied!' : 'Copy install link'}
          </button>
        </div>

        {/* Divider */}
        <div className="my-4 border-t border-gray-200" />

        {/* Download section */}
        <div className="rounded-md bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-900">
            Don&apos;t have the AICS Desktop app?
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Download the free desktop runtime to install and run AI company assets locally.
          </p>
          <a
            href="https://github.com/AICraftsman/AICS/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            <ExternalLink size={14} />
            Download AICS Desktop
          </a>
        </div>

        {/* Install link display for manual use */}
        <div className="mt-3">
          <p className="text-xs text-gray-400">Install link:</p>
          <code className="mt-1 block break-all rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">
            {deepLink}
          </code>
        </div>
      </div>
    </div>
  );
}
