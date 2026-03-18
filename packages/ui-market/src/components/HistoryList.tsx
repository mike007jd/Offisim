import type { LibraryItem } from '@aics/registry-client';
import { formatDate } from '../lib/format.js';

export interface HistoryListProps {
  items: LibraryItem[];
}

export function HistoryList({ items }: HistoryListProps) {
  if (items.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-[var(--text-muted)]">No installations yet.</p>
        <a
          href="/search"
          className="mt-2 inline-block text-sm font-medium text-[var(--accent-indigo)] hover:text-blue-700"
        >
          Browse the marketplace
        </a>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="pb-3 pr-4 font-medium text-[var(--text-secondary)]">Asset</th>
            <th className="pb-3 pr-4 font-medium text-[var(--text-secondary)]">Kind</th>
            <th className="pb-3 pr-4 font-medium text-[var(--text-secondary)]">Version</th>
            <th className="pb-3 pr-4 font-medium text-[var(--text-secondary)]">Installed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => (
            <tr key={`${item.listing.listing_id}-${item.version.version}`} className="hover:bg-[var(--bg-tertiary)]">
              <td className="py-3 pr-4">
                <a
                  href={`/listing/${item.listing.slug}`}
                  className="font-medium text-[var(--text-primary)] hover:text-[var(--accent-indigo)] transition-colors"
                >
                  {item.listing.title}
                </a>
                {item.listing.creator && (
                  <p className="text-xs text-[var(--text-muted)]">by @{item.listing.creator.handle}</p>
                )}
              </td>
              <td className="py-3 pr-4">
                <span className="rounded-md bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
                  {item.listing.kind}
                </span>
              </td>
              <td className="py-3 pr-4">
                <span className="font-mono text-xs text-[var(--text-secondary)]">v{item.version.version}</span>
              </td>
              <td className="py-3 pr-4 text-xs text-[var(--text-muted)]">
                {formatDate(item.saved_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
