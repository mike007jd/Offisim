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
      <div className="sop-sidebar sop-sidebar-collapsed">
        <Button
          type="button"
          onClick={onToggleCollapse}
          variant="outline"
          size="icon"
          className="sop-sidebar-collapse-button"
          aria-label="Expand SOP sidebar"
          title="Expand SOP sidebar"
        >
          <ChevronRight data-icon="sidebar-expand" />
        </Button>
        <div className="sop-sidebar-divider" />
        {filtered.map((sop) => (
          <Button
            key={sop.sopTemplateId}
            type="button"
            onClick={() => onSelectSop(sop.sopTemplateId)}
            variant="ghost"
            size="icon"
            className={cn(
              'sop-sidebar-initial',
              selectedSopId === sop.sopTemplateId
                ? 'sop-sidebar-initial-active'
                : 'sop-sidebar-initial-idle',
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
    <div className="sop-sidebar">
      <div className="sop-sidebar-header">
        <div className="sop-sidebar-top">
          <span className="sop-sidebar-caption">SOPs</span>
          <div className="sop-sidebar-actions">
            {onToggleCollapse && (
              <Button
                type="button"
                onClick={onToggleCollapse}
                variant="outline"
                size="icon"
                className="sop-mini-button"
                title="Collapse SOP sidebar"
                aria-label="Collapse SOP sidebar"
              >
                <ChevronLeft data-icon="mini-action" />
              </Button>
            )}
            <Button
              type="button"
              onClick={onImportClick}
              variant="outline"
              size="icon"
              className="sop-mini-button"
              title="Import SOP"
              aria-label="Import SOP"
            >
              <Download data-icon="mini-action" />
            </Button>
            <Button
              type="button"
              onClick={onCreateClick}
              variant="outline"
              size="icon"
              className="sop-mini-button"
              title="Create SOP"
              aria-label="Create SOP"
            >
              <Plus data-icon="mini-action" />
            </Button>
          </div>
        </div>

        <div className="sop-search">
          <Search data-icon="search" />
          <Input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search..."
            className="sop-search-input"
          />
        </div>
      </div>

      <div className="sop-list">
        {loading && <WorkspaceListSkeleton rows={6} className="sop-list-skeleton" />}
        {!loading && filtered.length === 0 && (
          <div className="sop-empty-list">
            <ClipboardList data-icon="empty-list" />
            <p>{sops.length === 0 ? 'No SOPs yet' : 'No matches'}</p>
          </div>
        )}
        {filtered.map((sop) => (
          <Button
            key={sop.sopTemplateId}
            type="button"
            onClick={() => onSelectSop(sop.sopTemplateId)}
            variant="ghost"
            className={cn(
              'sop-list-row',
              selectedSopId === sop.sopTemplateId ? 'sop-list-row-active' : 'sop-list-row-idle',
            )}
          >
            <div className="sop-list-row-title">{sop.name}</div>
            <div className="sop-list-row-meta">
              {sop.stepCount} step{sop.stepCount !== 1 ? 's' : ''}
              {sop.sourceUrl ? ' \u00B7 synced' : ''}
            </div>
          </Button>
        ))}
      </div>
    </div>
  );
}
