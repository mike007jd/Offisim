import { SopSyncService } from '@offisim/core/browser';
import type { PlanCreatedPayload, RuntimeEvent } from '@offisim/shared-types';
import { Button } from '@offisim/ui-core';
import {
  ClipboardList,
  Download,
  ExternalLink,
  Link2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSopRuntimeState } from '../../hooks/useSopRuntimeState';
import { useSops } from '../../hooks/useSops';
import { formatSopDate } from '../../lib/sop-utils';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { SopDrawer } from './SopDrawer';
import { SopEditorDialog } from './SopEditorDialog';
import { SopImportDialog } from './SopImportDialog';

// ---------------------------------------------------------------------------
// SopCompactCard — sidebar-width card, click opens drawer
// ---------------------------------------------------------------------------

interface SopCompactCardProps {
  sop: {
    sopTemplateId: string;
    name: string;
    description: string;
    stepCount: number;
    createdAt: string;
    definitionJson: string;
    sourceUrl: string | null;
    lastSyncedAt: string | null;
  };
  onOpen: () => void;
  onRun: (name: string) => void;
  onDelete: (sopTemplateId: string) => void;
  onSync?: (sopTemplateId: string) => void;
}

function SopCompactCard({ sop, onOpen, onRun, onDelete, onSync }: SopCompactCardProps) {
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
      className={`rounded-lg border overflow-hidden transition-colors ${isActive ? 'border-blue-500/30 bg-blue-500/[0.04]' : 'border-white/5 bg-white/[0.03]'}`}
    >
      {/* Header — click to open drawer */}
      <button
        type="button"
        className="w-full flex items-center gap-1.5 px-2 pt-2 pb-1 text-left min-w-0 hover:bg-white/[0.03] transition-colors"
        onClick={onOpen}
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
          {sop.stepCount}s · {formatSopDate(sop.createdAt)}
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
// SopPanel
// ---------------------------------------------------------------------------

export function SopPanel() {
  const { sops, loading, deleteSop, refreshSops } = useSops();
  const { sendMessage, repos, eventBus } = useOffisimRuntime();
  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [drawerSopId, setDrawerSopId] = useState<string | null>(null);

  const drawerSop = drawerSopId ? sops.find((s) => s.sopTemplateId === drawerSopId) : null;

  // Auto-open drawer when a SOP-based plan starts executing
  useEffect(() => {
    return eventBus.on('plan.created', (e: RuntimeEvent<PlanCreatedPayload>) => {
      if (e.payload.sopTemplateId) {
        setDrawerSopId(e.payload.sopTemplateId);
      }
    });
  }, [eventBus]);

  const handleRun = useCallback(
    (name: string) => {
      void sendMessage(`Run the SOP: ${name}`);
    },
    [sendMessage],
  );

  const handleSync = useCallback(
    async (sopTemplateId: string) => {
      if (!repos?.sopTemplates || syncingId) return;
      setSyncingId(sopTemplateId);
      try {
        const svc = new SopSyncService(repos.sopTemplates);
        await svc.syncFromUrl(sopTemplateId);
        await refreshSops();
      } finally {
        setSyncingId(null);
      }
    },
    [repos, refreshSops, syncingId],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <span className="text-[10px] text-slate-500 animate-pulse">Loading SOPs…</span>
      </div>
    );
  }

  if (sops.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center gap-2 py-5 px-3 text-center">
          <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
            <ClipboardList className="w-4 h-4 text-slate-500" />
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Create your first SOP or complete a task to generate one automatically.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-[10px] gap-1"
              onClick={() => setEditorOpen(true)}
            >
              <Plus className="w-3 h-3" /> Create
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-[10px] gap-1"
              onClick={() => setImportOpen(true)}
            >
              <Download className="w-3 h-3" /> Import
            </Button>
          </div>
        </div>
        <SopEditorDialog open={editorOpen} onOpenChange={setEditorOpen} onCreated={refreshSops} />
        <SopImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={refreshSops} />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1.5 px-2 pb-2">
        <div className="flex items-center justify-end gap-2 mb-0.5">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-0.5 text-[10px] text-cyan-400 hover:text-cyan-300"
          >
            <Download className="w-3 h-3" /> Import
          </button>
          <button
            type="button"
            onClick={() => setEditorOpen(true)}
            className="flex items-center gap-0.5 text-[10px] text-blue-400 hover:text-blue-300"
          >
            <Plus className="w-3 h-3" /> New
          </button>
        </div>
        {sops.map((sop) => (
          <SopCompactCard
            key={sop.sopTemplateId}
            sop={sop}
            onOpen={() => setDrawerSopId(sop.sopTemplateId)}
            onRun={handleRun}
            onDelete={deleteSop}
            onSync={handleSync}
          />
        ))}
      </div>
      <SopEditorDialog open={editorOpen} onOpenChange={setEditorOpen} onCreated={refreshSops} />
      <SopImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={refreshSops} />
      {drawerSop && (
        <SopDrawer
          open
          onClose={() => setDrawerSopId(null)}
          sopTemplateId={drawerSop.sopTemplateId}
          sopName={drawerSop.name}
          definitionJson={drawerSop.definitionJson}
        />
      )}
    </>
  );
}
