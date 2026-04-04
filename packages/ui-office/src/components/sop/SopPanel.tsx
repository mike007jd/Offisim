import { SopSyncService } from '@offisim/core/browser';
import { Button } from '@offisim/ui-core';
import { ChevronDown, ChevronRight, ClipboardList, Download, Link2, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useSops } from '../../hooks/useSops';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { SopEditorDialog } from './SopEditorDialog';
import { SopImportDialog } from './SopImportDialog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// SopStepList — expanded step view
// ---------------------------------------------------------------------------

interface SopStepListProps {
  definitionJson: string;
}

function SopStepList({ definitionJson }: SopStepListProps) {
  let steps: Array<{ step_id: string; label: string; role_slug: string; dependencies: string[] }> =
    [];
  try {
    const def = JSON.parse(definitionJson) as {
      steps?: Array<{ step_id: string; label: string; role_slug: string; dependencies: string[] }>;
    };
    steps = Array.isArray(def.steps) ? def.steps : [];
  } catch {
    // ignore parse error
  }

  if (steps.length === 0) {
    return <p className="text-[10px] text-slate-500 italic px-2 pb-1">No steps defined.</p>;
  }

  return (
    <ul className="flex flex-col gap-0.5 px-2 pb-1">
      {steps.map((step, i) => (
        <li key={step.step_id} className="flex items-start gap-1.5">
          <span className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[8px] text-slate-400 font-semibold">
            {i + 1}
          </span>
          <div className="min-w-0">
            <span className="text-[10px] text-slate-300 leading-tight">{step.label}</span>
            <span className="text-[9px] text-slate-500 ml-1">({step.role_slug})</span>
            {step.dependencies.length > 0 && (
              <div className="text-[9px] text-slate-600">after: {step.dependencies.join(', ')}</div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// SopCard
// ---------------------------------------------------------------------------

interface SopCardProps {
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
  onRun: (name: string) => void;
  onDelete: (sopTemplateId: string) => void;
  onSync?: (sopTemplateId: string) => void;
}

function SopCard({ sop, onRun, onDelete, onSync }: SopCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleDelete = useCallback(() => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    onDelete(sop.sopTemplateId);
    setConfirming(false);
  }, [confirming, onDelete, sop.sopTemplateId]);

  const handleCancelDelete = useCallback(() => {
    setConfirming(false);
  }, []);

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-1">
        <button
          type="button"
          className="flex-1 flex items-start gap-1.5 text-left min-w-0"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className="mt-0.5 shrink-0 text-slate-500">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-200 truncate leading-tight flex items-center gap-1">
              {sop.sourceUrl && <Link2 className="w-2.5 h-2.5 text-blue-400/60 shrink-0" />}
              {sop.name}
            </p>
            {sop.description && (
              <p className="text-[10px] text-slate-500 truncate leading-tight mt-0.5">
                {sop.description}
              </p>
            )}
          </div>
        </button>
        <span className="shrink-0 text-[9px] text-slate-600 ml-1">
          {sop.stepCount}s · {formatDate(sop.createdAt)}
        </span>
      </div>

      {/* Expanded steps */}
      {expanded && <SopStepList definitionJson={sop.definitionJson} />}

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
              onClick={handleCancelDelete}
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
  const { sendMessage, repos } = useOffisimRuntime();
  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const handleRun = useCallback(
    (name: string) => {
      void sendMessage(`Run the SOP: ${name}`);
    },
    [sendMessage],
  );

  const handleSync = useCallback(
    async (sopTemplateId: string) => {
      if (!repos?.sopTemplates) return;
      const svc = new SopSyncService(repos.sopTemplates);
      await svc.syncFromUrl(sopTemplateId);
      await refreshSops();
    },
    [repos, refreshSops],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <span className="text-[10px] text-slate-600 animate-pulse">Loading SOPs…</span>
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
          <SopCard key={sop.sopTemplateId} sop={sop} onRun={handleRun} onDelete={deleteSop} onSync={handleSync} />
        ))}
      </div>
      <SopEditorDialog open={editorOpen} onOpenChange={setEditorOpen} onCreated={refreshSops} />
      <SopImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={refreshSops} />
    </>
  );
}
