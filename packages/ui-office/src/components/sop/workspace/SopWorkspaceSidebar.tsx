import { SopSyncService } from '@offisim/core/browser';
import { Download, Play, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useSopRuntimeState } from '../../../hooks/useSopRuntimeState';
import type { SopTemplate } from '../../../hooks/useSops';
import { pillClass } from '../../../lib/sop-utils';
import { useOffisimRuntime } from '../../../runtime/offisim-runtime-context';

interface SopSidebarCardProps {
  sop: SopTemplate;
  selected: boolean;
  onSelect: () => void;
  onRun: (name: string) => void;
  onDelete: (sopTemplateId: string) => void;
  onSync?: (sopTemplateId: string) => void;
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
      className={`relative rounded-lg border overflow-hidden transition-all ${
        selected
          ? 'border-cyan-400/30 bg-cyan-500/[0.06]'
          : isActive
            ? 'border-blue-400/20 bg-blue-500/[0.04]'
            : 'border-white/[0.06] bg-white/[0.02] hover:border-white/10'
      }`}
    >
      <div
        className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l transition-colors ${
          isActive ? 'bg-cyan-400' : selected ? 'bg-blue-400' : 'bg-transparent'
        }`}
      />

      <button
        type="button"
        className="w-full flex items-center gap-2.5 pl-4 pr-3 py-2.5 text-left min-w-0 hover:bg-white/[0.03] transition-colors"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-slate-200 truncate leading-snug flex items-center gap-1.5">
            {isActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shrink-0" />
            )}
            {sop.name}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-slate-600 tabular-nums">{sop.stepCount}s</span>
      </button>

      <div className="flex items-center gap-1 px-3 pb-2">
        <button
          type="button"
          onClick={() => onRun(sop.name)}
          title="Run"
          className="p-1 text-cyan-400/70 hover:text-cyan-300 hover:bg-cyan-500/10 rounded transition-colors"
        >
          <Play className="w-3 h-3" />
        </button>
        {sop.sourceUrl && onSync && (
          <button
            type="button"
            onClick={() => onSync(sop.sopTemplateId)}
            title="Sync"
            className="p-1 text-blue-400/70 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
        <div className="flex-1" />
        {confirming ? (
          <>
            <button
              type="button"
              className="text-[11px] text-slate-500 hover:text-slate-300 px-1"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="p-1 text-red-400 hover:bg-red-500/10 rounded transition-colors"
              onClick={handleDelete}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="p-1 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
            onClick={handleDelete}
            title="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

export interface SopWorkspaceSidebarProps {
  sops: SopTemplate[];
  loading: boolean;
  selectedSopId: string | null;
  search: string;
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
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-2">
        <button
          type="button"
          className={pillClass(leftPaneMode === 'library')}
          onClick={() => onLeftPaneModeChange('library')}
        >
          Library
        </button>
        <button
          type="button"
          className={pillClass(leftPaneMode === 'active-runs')}
          onClick={() => onLeftPaneModeChange('active-runs')}
        >
          Active Runs
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onImportClick}
          className="flex items-center gap-1 text-[13px] text-cyan-400 hover:text-cyan-300 p-1"
          title="Import SOP"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onCreateClick}
          className="flex items-center gap-1 text-[13px] text-blue-400 hover:text-blue-300 p-1"
          title="Create SOP"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-4 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search SOPs…"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-8 pr-3 py-2 text-[13px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400/30 transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <span className="text-xs text-slate-500 animate-pulse">Loading SOPs…</span>
          </div>
        ) : filteredSops.length === 0 ? (
          <div className="text-center py-4 px-2">
            {sops.length === 0 ? (
              <p className="text-xs text-slate-500">
                No SOPs yet. Create or import one to get started.
              </p>
            ) : (
              <p className="text-xs text-slate-500">
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
