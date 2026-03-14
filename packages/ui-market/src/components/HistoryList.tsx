import type { LibraryItem } from '@aics/registry-client';
import { formatDate } from '../lib/format.js';

export interface HistoryListProps {
  items: LibraryItem[];
}

export function HistoryList({ items }: HistoryListProps) {
  if (items.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-gray-500">No installations yet.</p>
        <a
          href="/search"
          className="mt-2 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
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
          <tr className="border-b border-gray-200">
            <th className="pb-3 pr-4 font-medium text-gray-700">Asset</th>
            <th className="pb-3 pr-4 font-medium text-gray-700">Kind</th>
            <th className="pb-3 pr-4 font-medium text-gray-700">Version</th>
            <th className="pb-3 pr-4 font-medium text-gray-700">Installed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => (
            <tr key={`${item.listing.listing_id}-${item.version.version}`} className="hover:bg-gray-50">
              <td className="py-3 pr-4">
                <a
                  href={`/listing/${item.listing.slug}`}
                  className="font-medium text-gray-900 hover:text-blue-600 transition-colors"
                >
                  {item.listing.title}
                </a>
                {item.listing.creator && (
                  <p className="text-xs text-gray-500">by @{item.listing.creator.handle}</p>
                )}
              </td>
              <td className="py-3 pr-4">
                <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {item.listing.kind}
                </span>
              </td>
              <td className="py-3 pr-4">
                <span className="font-mono text-xs text-gray-600">v{item.version.version}</span>
              </td>
              <td className="py-3 pr-4 text-xs text-gray-500">
                {formatDate(item.saved_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
