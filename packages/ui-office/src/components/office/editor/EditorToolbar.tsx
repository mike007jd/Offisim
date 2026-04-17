import { ArrowLeft, Maximize2, RotateCcw, Save, ZoomIn, ZoomOut } from 'lucide-react';

export interface EditorToolbarProps {
  selectedZoneLabel: string | null;
  dirty: boolean;
  saving: boolean;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  onResetAll: () => void;
  onSave: () => void;
  onClose: () => void;
}

export function EditorToolbar({
  selectedZoneLabel,
  dirty,
  saving,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onResetAll,
  onSave,
  onClose,
}: EditorToolbarProps) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-white/50 hover:bg-white/[0.05] hover:text-white/80 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <div className="h-4 w-px bg-white/10" />
        <h1 className="font-mono text-xs font-black uppercase tracking-[0.25em] text-white/90">
          OFFICE STUDIO
        </h1>
        <span className="rounded bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-zinc-500">
          ZONE EDIT MODE
        </span>
        {selectedZoneLabel && (
          <span className="rounded border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] text-cyan-200">
            Focus: {selectedZoneLabel}
          </span>
        )}
        {dirty && (
          <span className="ml-2 rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] text-amber-400">
            UNSAVED
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 mr-2">
          <button
            type="button"
            onClick={onZoomOut}
            className="rounded p-1 text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-400"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="font-mono text-[10px] text-zinc-500 w-8 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={onZoomIn}
            className="rounded p-1 text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-400"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onZoomFit}
            className="rounded p-1 text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-400"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={onResetAll}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 font-mono text-[10px] text-white/50 hover:bg-white/[0.05] hover:text-white/70 transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          className="flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-600/20 px-4 py-1.5 font-mono text-[10px] font-semibold text-blue-300 hover:bg-blue-600/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Save className="h-3 w-3" />
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
