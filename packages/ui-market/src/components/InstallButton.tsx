'use client';

import { Download, MonitorDown, Package } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { InstallModal } from './InstallModal.js';
import { downloadArtifact } from '../lib/download-artifact.js';

type InstallState = 'idle' | 'opening' | 'downloading' | 'error';

interface Props {
  listingId: string;
  version: string;
  /** package_version_id used for direct artifact download */
  packageVersionId?: string;
  /** Display title for the asset (shown in the fallback modal) */
  title?: string;
}

/**
 * InstallButton — Two-path install bridge for the marketplace.
 *
 * Path A (primary): Deep link to Offisim Desktop via `offisim://install` protocol.
 *   If the desktop app is installed, it opens and starts the install flow.
 *   If not, a fallback modal appears after 3s with download instructions.
 *
 * Path B (secondary): Direct .aicspkg download via platform API.
 *   Available when packageVersionId is provided. Downloads the artifact
 *   file that users can import manually via desktop File Import.
 */
export function InstallButton({ listingId, version, packageVersionId, title }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [state, setState] = useState<InstallState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deepLink = `offisim://install?listing_id=${encodeURIComponent(listingId)}&version=${encodeURIComponent(version)}`;

  const handleDeepLink = useCallback(() => {
    setState('opening');
    window.location.href = deepLink;

    // If the app doesn't open within 3s, show the fallback modal
    timerRef.current = setTimeout(() => {
      setState('idle');
      setShowModal(true);
      timerRef.current = null;
    }, 3000);
  }, [deepLink]);

  const handleDownload = useCallback(async () => {
    if (!packageVersionId) return;

    setState('downloading');
    try {
      await downloadArtifact(packageVersionId);
      setState('idle');
    } catch (err) {
      console.error('[InstallButton] Download error:', err);
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  }, [packageVersionId]);

  const handleCloseModal = useCallback(() => {
    setShowModal(false);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Primary: Open in Desktop */}
        <button
          type="button"
          onClick={handleDeepLink}
          disabled={state === 'opening'}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--accent-indigo)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-60 disabled:cursor-wait transition-opacity"
        >
          {state === 'opening' ? (
            <>
              <MonitorDown size={16} className="animate-pulse" />
              Opening Offisim Desktop...
            </>
          ) : (
            <>
              <Download size={16} />
              Install in Offisim
            </>
          )}
        </button>

        {/* Secondary: Download Package */}
        {packageVersionId && (
          <button
            type="button"
            onClick={handleDownload}
            disabled={state === 'downloading'}
            title="Download .aicspkg file for manual import"
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover,theme(colors.gray.100))] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-60 disabled:cursor-wait transition-colors"
          >
            {state === 'downloading' ? (
              <>
                <Package size={16} className="animate-spin" />
                Downloading...
              </>
            ) : state === 'error' ? (
              <>
                <Package size={16} />
                Failed
              </>
            ) : (
              <>
                <Package size={16} />
                <span className="hidden sm:inline">Download</span>
              </>
            )}
          </button>
        )}
      </div>

      {showModal && (
        <InstallModal
          listingId={listingId}
          version={version}
          packageVersionId={packageVersionId}
          title={title ?? 'this asset'}
          onClose={handleCloseModal}
        />
      )}
    </>
  );
}
