'use client';

import { useAuthContext } from './AuthProvider.js';

export interface ForkButtonProps {
  listingId: string;
  version: string;
  forkCount: number;
}

export function ForkButton({ listingId, version, forkCount }: ForkButtonProps) {
  const auth = useAuthContext();

  function handleClick() {
    if (!auth.user) {
      // Trigger login prompt by scrolling up or showing message
      alert('Please sign in to fork this asset.');
      return;
    }
    // Navigate to publish wizard with fork_from params
    window.location.href = `/dashboard/publish?fork_from=${listingId}&fork_version=${version}`;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <circle cx="18" cy="6" r="3" />
        <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
        <path d="M12 12v3" />
      </svg>
      Fork
      {forkCount > 0 && (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
          {forkCount}
        </span>
      )}
    </button>
  );
}
