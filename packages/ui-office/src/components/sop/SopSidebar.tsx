import { WorkspaceListSkeleton } from '@offisim/ui-core';
import { ChevronLeft, ChevronRight, ClipboardList, Download, Plus, Search } from 'lucide-react';
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
  collapsed?: boolean;
  onToggleCollapse?: () => void;
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
  collapsed = false,
  onToggleCollapse,
}: SopSidebarProps) {
  const filtered = useMemo(() => {
    if (!search.trim()) return sops;
    const q = search.toLowerCase();
    return sops.filter((s) => s.name.toLowerCase().includes(q));
  }, [sops, search]);

  if (collapsed) {
    return (
      <div className="flex w-11 shrink-0 flex-col items-center gap-2 border-r border-border-subtle bg-surface-elevated/70 py-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border-subtle text-text-muted transition hover:bg-surface-muted hover:text-text-primary"
          aria-label="Expand SOP sidebar"
          title="Expand SOP sidebar"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="h-px w-6 bg-border-subtle" />
        {filtered.map((sop) => (
          <button
            key={sop.sopTemplateId}
            type="button"
            onClick={() => onSelectSop(sop.sopTemplateId)}
            className={`flex h-8 w-8 items-center justify-center rounded-md border text-[10px] font-semibold uppercase transition ${
              selectedSopId === sop.sopTemplateId
                ? 'border-border-focus bg-accent-muted text-accent-text'
                : 'border-transparent text-text-muted hover:bg-surface-muted hover:text-text-primary'
            }`}
            aria-label={sop.name}
            title={sop.name}
          >
            {sop.name.slice(0, 1)}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex w-[280px] shrink-0 flex-col border-r border-border-default bg-surface-elevated">
      {/* Sidebar header */}
      <div className="shrink-0 px-3 pt-3 pb-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            SOPs
          </span>
          <div className="flex items-center gap-1">
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="flex h-6 w-6 items-center justify-center rounded border border-border-subtle text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
                title="Collapse SOP sidebar"
                aria-label="Collapse SOP sidebar"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              onClick={onImportClick}
              className="flex h-6 w-6 items-center justify-center rounded border border-border-subtle text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
              title="Import SOP"
              aria-label="Import SOP"
            >
              <Download className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onCreateClick}
              className="flex h-6 w-6 items-center justify-center rounded border border-border-subtle text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
              title="Create SOP"
              aria-label="Create SOP"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search..."
            className="w-full rounded border border-border-default bg-surface py-1 pl-6 pr-2 text-xs text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none"
          />
        </div>
      </div>

      {/* SOP list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {loading && <WorkspaceListSkeleton rows={6} className="px-0 py-2" />}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
            <ClipboardList className="h-5 w-5 text-text-muted" />
            <p className="text-xs text-text-muted">
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
                ? 'border border-border-focus bg-accent-muted text-accent-text'
                : 'border border-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <div className="text-xs font-medium truncate">{sop.name}</div>
            <div className="mt-0.5 text-[10px] text-text-muted">
              {sop.stepCount} step{sop.stepCount !== 1 ? 's' : ''}
              {sop.sourceUrl ? ' \u00B7 synced' : ''}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
