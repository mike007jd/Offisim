'use client';

import { Download } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { InstallModal } from './InstallModal.js';

interface Props {
  listingId: string;
  version: string;
  /** Display title for the asset (shown in the fallback modal) */
  title?: string;
}

export function InstallButton({ listingId, version, title }: Props) {
  const [showModal, setShowModal] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInstall = useCallback(() => {
    const deepLink = `aics://install?listing_id=${encodeURIComponent(listingId)}&version=${encodeURIComponent(version)}`;
    // Try deep link
    window.location.href = deepLink;
    // Show fallback modal after a timeout if app didn't open
    timerRef.current = setTimeout(() => {
      setShowModal(true);
      timerRef.current = null;
    }, 2000);
  }, [listingId, version]);

  const handleCloseModal = useCallback(() => {
    setShowModal(false);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={handleInstall}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
      >
        <Download size={16} />
        Install in AICS
      </button>

      {showModal && (
        <InstallModal
          listingId={listingId}
          version={version}
          title={title ?? 'this asset'}
          onClose={handleCloseModal}
        />
      )}
    </>
  );
}
