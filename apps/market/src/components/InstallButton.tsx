'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';

interface Props {
  listingId: string;
  version: string;
}

export function InstallButton({ listingId, version }: Props) {
  const [showFallback, setShowFallback] = useState(false);

  function handleInstall() {
    const deepLink = `aics://install?listing_id=${listingId}&version=${encodeURIComponent(version)}`;
    // Try deep link
    window.location.href = deepLink;
    // Show fallback after a timeout if app didn't open
    setTimeout(() => setShowFallback(true), 2000);
  }

  return (
    <div>
      <button
        onClick={handleInstall}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
      >
        <Download size={16} />
        Install in AICS
      </button>

      {showFallback && (
        <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm">
          <p className="font-medium text-gray-900">Desktop app not detected</p>
          <p className="mt-1 text-gray-600">
            To install assets, you need the AICS Desktop app.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  `aics://install?listing_id=${listingId}&version=${encodeURIComponent(version)}`,
                );
              }}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs hover:bg-white"
            >
              Copy install link
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
