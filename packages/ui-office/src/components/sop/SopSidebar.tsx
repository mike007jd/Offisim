import { Button, Input, WorkspaceListSkeleton, cn } from '@offisim/ui-core';
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
      <div className="flex w-office-rail-collapsed shrink-0 flex-col items-center gap-2 border-r border-line bg-surface-0 py-3">
        <Button
          type="button"
          onClick={onToggleCollapse}
          variant="outline"
          size="icon"
          className="size-8 rounded-r-sm border-line-soft text-ink-4 hover:bg-surface-sunken hover:text-ink-1"
          aria-label="Expand SOP sidebar"
          title="Expand SOP sidebar"
        >
          <ChevronRight className="size-4" />
        </Button>
        <div className="h-px w-6 bg-line-soft" />
        {filtered.map((sop) => (
          <Button
            key={sop.sopTemplateId}
            type="button"
            onClick={() => onSelectSop(sop.sopTemplateId)}
            variant="ghost"
            size="icon"
            className={cn(
              'size-8 rounded-r-sm border text-fs-meta font-semibold uppercase transition',
              selectedSopId === sop.sopTemplateId
                ? 'border-accent-ring bg-accent-surface text-accent'
                : 'border-transparent text-ink-4 hover:bg-surface-sunken hover:text-ink-1',
            )}
            aria-label={sop.name}
            title={sop.name}
          >
            {sop.name.slice(0, 1)}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div className="w-sop-sidebar flex shrink-0 flex-col border-r border-line bg-surface-1">
      {/* Sidebar header */}
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-2 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-fs-micro font-bold uppercase tracking-wide text-ink-3">SOPs</span>
          <div className="flex items-center gap-1">
            {onToggleCollapse && (
              <Button
                type="button"
                onClick={onToggleCollapse}
                variant="outline"
                size="icon"
                className="size-6 rounded-r-xs border-line-soft text-ink-4 hover:bg-surface-sunken hover:text-ink-1"
                title="Collapse SOP sidebar"
                aria-label="Collapse SOP sidebar"
              >
                <ChevronLeft className="size-3" />
              </Button>
            )}
            <Button
              type="button"
              onClick={onImportClick}
              variant="outline"
              size="icon"
              className="size-6 rounded-r-xs border-line-soft text-ink-4 hover:bg-surface-sunken hover:text-ink-1"
              title="Import SOP"
              aria-label="Import SOP"
            >
              <Download className="size-3" />
            </Button>
            <Button
              type="button"
              onClick={onCreateClick}
              variant="outline"
              size="icon"
              className="size-6 rounded-r-xs border-line-soft text-ink-4 hover:bg-surface-sunken hover:text-ink-1"
              title="Create SOP"
              aria-label="Create SOP"
            >
              <Plus className="size-3" />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-ink-4" />
          <Input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search..."
            className="h-8 w-full rounded-r-sm border-line bg-surface-sunken pl-6 pr-2 text-fs-sm text-ink-1 placeholder:text-ink-4 focus:border-accent"
          />
        </div>
      </div>

      {/* SOP list */}
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {loading && <WorkspaceListSkeleton rows={6} className="px-0 py-2" />}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
            <ClipboardList className="size-5 text-ink-4" />
            <p className="text-fs-sm text-ink-4">
              {sops.length === 0 ? 'No SOPs yet' : 'No matches'}
            </p>
          </div>
        )}
        {filtered.map((sop) => (
          <Button
            key={sop.sopTemplateId}
            type="button"
            onClick={() => onSelectSop(sop.sopTemplateId)}
            variant="ghost"
            className={cn(
              'h-auto w-full flex-col items-start justify-start rounded-r-sm px-2.5 py-2 text-left transition-colors',
              selectedSopId === sop.sopTemplateId
                ? 'border border-accent-ring bg-accent-surface text-accent'
                : 'border border-transparent text-ink-3 hover:bg-surface-sunken hover:text-ink-1',
            )}
          >
            <div className="truncate text-fs-sm font-semibold">{sop.name}</div>
            <div className="mt-0.5 text-fs-meta text-ink-4">
              {sop.stepCount} step{sop.stepCount !== 1 ? 's' : ''}
              {sop.sourceUrl ? ' \u00B7 synced' : ''}
            </div>
          </Button>
        ))}
      </div>
    </div>
  );
}
