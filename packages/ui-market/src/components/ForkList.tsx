import type { ForkSummary } from '@aics/registry-client';
import { formatDate } from '../lib/format.js';

export interface ForkListProps {
  forks: ForkSummary[];
}

export function ForkList({ forks }: ForkListProps) {
  if (forks.length === 0) {
    return <p className="text-sm text-gray-500">No forks yet.</p>;
  }

  return (
    <div className="space-y-3">
      {forks.map((fork) => (
        <a
          key={fork.listingId}
          href={`/listing/${fork.slug}`}
          className="block rounded-md border border-gray-200 p-3 hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900">{fork.title}</span>
            <span className="font-mono text-xs text-gray-400">v{fork.version}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
            <span>by @{fork.creatorHandle}</span>
            <span>&middot;</span>
            <span>{formatDate(fork.forkedAt)}</span>
          </div>
        </a>
      ))}
    </div>
  );
}
