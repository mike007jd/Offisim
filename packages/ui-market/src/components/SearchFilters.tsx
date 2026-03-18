'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { kindLabel } from '../lib/format.js';

const KINDS = ['employee', 'skill', 'sop', 'company_template', 'office_layout', 'bundle'] as const;
const SORTS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'newest', label: 'Newest' },
  { value: 'rating', label: 'Top Rated' },
  { value: 'installs', label: 'Most Installed' },
] as const;

export function SearchFilters() {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page'); // Reset pagination on filter change
    router.push(`/search?${next}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        className="rounded border border-[var(--border-bright)] px-3 py-1.5 text-sm"
        value={params.get('kind') ?? ''}
        onChange={(e) => update('kind', e.target.value)}
        aria-label="Filter by kind"
      >
        <option value="">All Types</option>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {kindLabel(k)}
          </option>
        ))}
      </select>

      <select
        className="rounded border border-[var(--border-bright)] px-3 py-1.5 text-sm"
        value={params.get('sort') ?? 'relevance'}
        onChange={(e) => update('sort', e.target.value)}
        aria-label="Sort by"
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
