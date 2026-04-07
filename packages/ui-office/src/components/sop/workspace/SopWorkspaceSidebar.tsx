import { SopSyncService } from '@offisim/core/browser';
import type { SopTemplate } from '../../../hooks/useSops';
import { useSopRuntimeState } from '../../../hooks/useSopRuntimeState';
import { Button } from '@offisim/ui-core';
import {
  Download,
  ExternalLink,
  Link2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useOffisimRuntime } from '../../../runtime/offisim-runtime-context';

// ---------------------------------------------------------------------------
// SopSidebarCard — compact card for the sidebar list
// ---------------------------------------------------------------------------

interface SopSidebarCardProps {
  sop: SopTemplate;
  selected: boolean;
  onSelect: () => void;
  onRun: (name: string) => void;
  onDelete: (sopTemplateId: string) => void;
  onSync?: (sopTemplateId: string) => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function SopSidebarCard({ sop, selected, onSelect, onRun, onDelete, onSync }: SopSidebarCardProps) {
  const runtimeState = useSopRuntimeState(sop.sopTemplateId);
  const [confirming, setConfirming] = useState(false);
  const isActive = runtimeState?.some((s) => s.status === 'active') ?? false;

  const handleDelete = useCallback(() => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    onDelete(sop.sopTemplateId);
    setConfirming(false);
  }, [confirming, onDelete, sop.sopTemplateId]);

  return (
    <div
      className={`rounded-lg border overflow-hidden transition-colors ${
        selected
          ? 'border-blue-500/40 bg-blue-500/[0.08]'
          : isActive
            ? 'border-blue-500/30 bg-blue-500/[0.04]'
            : 'border-white/5 bg-white/[0.03]'
      }`}
    >
      {/* Header — click to select */}
      <button
        type="button"
        className="w-full flex items-center gap-1.5 px-2 pt-2 pb-1 text-left min-w-0 hover:bg-white/[0.03] transition-colors"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-slate-200 truncate leading-tight flex items-center gap-1">
            {isActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
            )}
            {sop.sourceUrl && <Link2 className="w-2.5 h-2.5 text-blue-400/60 shrink-0" />}
            {sop.name}
          </p>
          {sop.description && (
            <p className="text-[10px] text-slate-500 truncate leading-tight mt-0.5">
              {sop.description}
            </p>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-slate-500 ml-1">
          {sop.stepCount}s · {formatDate(sop.createdAt)}
        </span>
        <ExternalLink className="w-3 h-3 text-slate-600 shrink-0" />
      </button>

      {/* Actions */}
      <div className="flex items-center gap-1 px-2 pb-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px] text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 gap-0.5"
          onClick={() => onRun(sop.name)}
          title="Run this SOP"
        >
          <Play className="w-2.5 h-2.5" />
          Run
        </Button>
        {sop.sourceUrl && onSync && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 gap-0.5"
            onClick={() => onSync(sop.sopTemplateId)}
            title="Sync from remote"
          >
            <RefreshCw className="w-2.5 h-2.5" />
            Sync
          </Button>
        )}
        <div className="flex-1" />
        {confirming ? (
          <>
            <button
              type="button"
              className="text-[10px] text-slate-400 hover:text-slate-300 px-1"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10"
              onClick={handleDelete}
            >
              Confirm
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1 text-[10px] text-slate-600 hover:text-red-400 hover:bg-red-500/10"
            onClick={handleDelete}
            title="Delete SOP"
          >
            <Trash2 className="w-2.5 h-2.5" />
          </Button>
        )}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// SopWorkspaceSidebar — Task 5.2
// ---------------------------------------------------------------------------

export interface SopWorkspaceSidebarProps {
  sops: SopTemplate[];
  loading: boolean;
  selectedSopId: string | null;
  search: string;
  filters: string[];
  leftPaneMode: 'library' | 'active-runs';
  onSelectSop: (sopId: string) => void;
  onSearchChange: (search: string) => void;
  onRunSop: (name: string) => void;
  onDeleteSop: (sopTemplateId: string) => void;
  onCreateClick: () => void;
  onImportClick: () => void;
  onLeftPaneModeChange: (mode: 'library' | 'active-runs') => void;
}

export function SopWorkspaceSidebar({
  sops,
  loading,
  selectedSopId,
  search,
  leftPaneMode,
  onSelectSop,
  onSearchChange,
  onRunSop,
  onDeleteSop,
  onCreateClick,
  onImportClick,
  onLeftPaneModeChange,
}: SopWorkspaceSidebarProps) {
  const { repos } = useOffisimRuntime();
  const [syncingId, setSyncingId] = useState<string | null>(null);

  // Filter SOPs by search term
  const filteredSops = useMemo(() => {
    if (!search.trim()) return sops;
    const q = search.toLowerCase();
    return sops.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [sops, search]);

  const handleSync = useCallback(
    async (sopTemplateId: string) => {
      if (!repos?.sopTemplates || syncingId) return;
      setSyncingId(sopTemplateId);
      try {
        const svc = new SopSyncService(repos.sopTemplates);
        await svc.syncFromUrl(sopTemplateId);
      } finally {
        setSyncingId(null);
      }
    },
    [repos, syncingId],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Mode pivot: Library / Active Runs */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-1">
        <button
          type="button"
          className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
            leftPaneMode === 'library'
              ? 'bg-white/10 text-slate-200'
              : 'text-slate-500 hover:text-slate-300'
          }`}
          onClick={() => onLeftPaneModeChange('library')}
        >
          Library
        </button>
        <button
          type="button"
          className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
            leftPaneMode === 'active-runs'
              ? 'bg-white/10 text-slate-200'
              : 'text-slate-500 hover:text-slate-300'
          }`}
          onClick={() => onLeftPaneModeChange('active-runs')}
        >
          Active Runs
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onImportClick}
          className="flex items-center gap-0.5 text-[10px] text-cyan-400 hover:text-cyan-300"
          title="Import SOP"
        >
          <Download className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={onCreateClick}
          className="flex items-center gap-0.5 text-[10px] text-blue-400 hover:text-blue-300"
          title="Create SOP"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search SOPs…"
            className="w-full bg-white/5 border border-white/10 rounded-md pl-6 pr-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/40"
          />
        </div>
      </div>

      {/* SOP list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <span className="text-[10px] text-slate-500 animate-pulse">Loading SOPs…</span>
          </div>
        ) : filteredSops.length === 0 ? (
          <div className="text-center py-4 px-2">
            {sops.length === 0 ? (
              <p className="text-[10px] text-slate-500">
                No SOPs yet. Create or import one to get started.
              </p>
            ) : (
              <p className="text-[10px] text-slate-500">
                No SOPs match your search. Try a different term.
              </p>
            )}
          </div>
        ) : (
          filteredSops.map((sop) => (
            <SopSidebarCard
              key={sop.sopTemplateId}
              sop={sop}
              selected={sop.sopTemplateId === selectedSopId}
              onSelect={() => onSelectSop(sop.sopTemplateId)}
              onRun={onRunSop}
              onDelete={onDeleteSop}
              onSync={handleSync}
            />
          ))
        )}
      </div>
    </div>
  );
}
