'use client';

import { Copy, Download, ExternalLink, Package, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { downloadArtifact } from '../lib/download-artifact.js';

interface Props {
  listingId: string;
  version: string;
  packageVersionId?: string;
  title: string;
  /** Called when the user closes the modal */
  onClose: () => void;
}

/**
 * InstallModal — web fallback modal for non-desktop users.
 *
 * Shown on the marketplace website when a user clicks "Install in Offisim"
 * but the desktop app did not open (or is not installed). Provides:
 * 1. A "Try Again" button to re-attempt the deep link
 * 2. A "Download Package" button for manual .offisimpkg import
 * 3. A "Copy Install Link" button so the user can paste into the desktop app
 * 4. A download prompt to get the Offisim Desktop app
 */
export function InstallModal({ listingId, version, packageVersionId, title, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const deepLink = `offisim://install?listing_id=${encodeURIComponent(listingId)}&version=${encodeURIComponent(version)}`;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(deepLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.warn('[InstallModal] Clipboard API unavailable');
    }
  }, [deepLink]);

  const handleRetry = useCallback(() => {
    window.location.href = deepLink;
  }, [deepLink]);

  const handleDownload = useCallback(async () => {
    if (!packageVersionId) return;
    setDownloading(true);
    try {
      await downloadArtifact(packageVersionId);
    } catch (err) {
      console.error('[InstallModal] Download error:', err);
    } finally {
      setDownloading(false);
    }
  }, [packageVersionId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      {/* Backdrop click to close */}
      <div
        className="absolute inset-0"
        onClick={onClose}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        role="presentation"
      />

      <div className="relative w-full max-w-md rounded-lg bg-[var(--bg-surface,theme(colors.white))] p-6 shadow-none border border-[var(--border-bright)]">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover,theme(colors.gray.100))] hover:text-[var(--text-secondary)]"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Install &ldquo;{title}&rdquo;
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            It looks like the Offisim Desktop app didn&apos;t open. Choose an option below:
          </p>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          {/* Retry deep link */}
          <button
            type="button"
            onClick={handleRetry}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--accent-indigo)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            <Download size={16} />
            Try Opening in Offisim Desktop Again
          </button>

          {/* Download package file */}
          {packageVersionId && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface,theme(colors.white))] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover,theme(colors.gray.50))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-60"
            >
              <Package size={16} />
              {downloading ? 'Downloading...' : 'Download .offisimpkg File'}
            </button>
          )}

          {/* Copy link */}
          <button
            type="button"
            onClick={handleCopy}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface,theme(colors.white))] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover,theme(colors.gray.50))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            <Copy size={16} />
            {copied ? 'Copied!' : 'Copy Install Link'}
          </button>
        </div>

        {/* Divider */}
        <div className="my-4 border-t border-[var(--border)]" />

        {/* Download desktop app section */}
        <div className="rounded-md bg-[var(--bg-hover,theme(colors.gray.50))] p-4">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            Don&apos;t have the Offisim Desktop app?
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Download the free desktop runtime to install and run AI company assets locally.
          </p>
          <a
            href="https://github.com/AICraftsman/Offisim/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent-indigo)] hover:text-[var(--accent-indigo)]"
          >
            <ExternalLink size={14} />
            Download Offisim Desktop
          </a>
        </div>

        {/* Install link display for manual use */}
        <div className="mt-3">
          <p className="text-xs text-[var(--text-muted)]">Install link:</p>
          <code className="mt-1 block break-all rounded bg-[var(--bg-hover,theme(colors.gray.100))] px-2 py-1 text-xs text-[var(--text-secondary)]">
            {deepLink}
          </code>
        </div>
      </div>
    </div>
  );
}
