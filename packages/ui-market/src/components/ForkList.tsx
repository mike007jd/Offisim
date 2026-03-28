import type { ForkSummary } from '@offisim/registry-client';
import { formatDate } from '../lib/format.js';

export interface ForkListProps {
  forks: ForkSummary[];
}

export function ForkList({ forks }: ForkListProps) {
  if (forks.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">No forks yet.</p>;
  }

  return (
    <div className="space-y-3">
      {forks.map((fork) => (
        <a
          key={fork.listingId}
          href={`/listing/${fork.slug}`}
          className="block rounded-md border border-[var(--border)] p-3 hover:border-[var(--accent-indigo)] hover:bg-[rgba(99,102,241,0.1)]/30 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--text-primary)]">{fork.title}</span>
            <span className="font-mono text-xs text-[var(--text-muted)]">v{fork.version}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span>by @{fork.creatorHandle}</span>
            <span>&middot;</span>
            <span>{formatDate(fork.forkedAt)}</span>
          </div>
        </a>
      ))}
    </div>
  );
}
