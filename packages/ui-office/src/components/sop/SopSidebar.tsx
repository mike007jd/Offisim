import { ClipboardList, Download, Plus, Search } from 'lucide-react';
import { useMemo } from 'react';
import type { SopTemplate } from '../../hooks/useSops';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SopSidebarProps {
  sops: SopTemplate[];
  selectedSopId: string | null;
  search: string;
  loading: boolean;
  onSelectSop: (sopId: string) => void;
  onSearchChange: (search: string) => void;
  onCreateClick: () => void;
  onImportClick: () => void;
}

// ---------------------------------------------------------------------------
// SopSidebar
// ---------------------------------------------------------------------------

export function SopSidebar({
  sops,
  selectedSopId,
  search,
  loading,
  onSelectSop,
  onSearchChange,
  onCreateClick,
  onImportClick,
}: SopSidebarProps) {
  const filtered = useMemo(() => {
    if (!search.trim()) return sops;
    const q = search.toLowerCase();
    return sops.filter((s) => s.name.toLowerCase().includes(q));
  }, [sops, search]);

  return (
    <div className="w-[280px] shrink-0 flex flex-col border-r border-white/5 bg-slate-900/40">
      {/* Sidebar header */}
      <div className="shrink-0 px-3 pt-3 pb-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            SOPs
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onImportClick}
              className="flex h-6 w-6 items-center justify-center rounded border border-white/8 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
              title="Import SOP"
              aria-label="Import SOP"
            >
              <Download className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onCreateClick}
              className="flex h-6 w-6 items-center justify-center rounded border border-white/8 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
              title="Create SOP"
              aria-label="Create SOP"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-600" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search..."
            className="w-full bg-white/5 border border-white/8 rounded pl-6 pr-2 py-1 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/40"
          />
        </div>
      </div>

      {/* SOP list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {loading && <div className="px-2 py-6 text-center text-xs text-slate-600">Loading...</div>}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
            <ClipboardList className="w-5 h-5 text-slate-600" />
            <p className="text-xs text-slate-500">
              {sops.length === 0 ? 'No SOPs yet' : 'No matches'}
            </p>
          </div>
        )}
        {filtered.map((sop) => (
          <button
            key={sop.sopTemplateId}
            type="button"
            onClick={() => onSelectSop(sop.sopTemplateId)}
            className={`w-full text-left rounded-md px-2.5 py-2 transition-colors ${
              selectedSopId === sop.sopTemplateId
                ? 'bg-cyan-500/12 border border-cyan-400/25 text-cyan-50'
                : 'border border-transparent text-slate-300 hover:bg-white/5 hover:text-slate-100'
            }`}
          >
            <div className="text-xs font-medium truncate">{sop.name}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">
              {sop.stepCount} step{sop.stepCount !== 1 ? 's' : ''}
              {sop.sourceUrl ? ' \u00B7 synced' : ''}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
