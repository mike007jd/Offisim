import { Badge, Button, Toolbar, ToolbarGroup, ToolbarSeparator } from '@offisim/ui-core';
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
    <Toolbar className="h-12 shrink-0 justify-between border-b border-line-soft px-sp-4">
      <div className="flex items-center gap-sp-3">
        <Button
          type="button"
          onClick={onClose}
          variant="ghost"
          size="sm"
          className="gap-sp-1 px-sp-2 text-ink-3 hover:text-ink-1"
          aria-label="Close editor"
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <ToolbarSeparator className="h-4" />
        <h1 className="font-mono text-fs-micro font-black uppercase tracking-ls-caps text-ink-1">
          OFFICE STUDIO
        </h1>
        <Badge variant="secondary" className="font-mono text-fs-micro">
          Zone edit mode
        </Badge>
        {selectedZoneLabel && (
          <Badge variant="info" className="font-mono text-fs-micro">
            Focus: {selectedZoneLabel}
          </Badge>
        )}
        {dirty && (
          <Badge variant="warning" className="ml-sp-2 font-mono text-fs-micro">
            Unsaved
          </Badge>
        )}
      </div>
      <ToolbarGroup className="gap-sp-2">
        <ToolbarGroup className="mr-sp-2 gap-sp-1">
          <Button
            type="button"
            onClick={onZoomOut}
            variant="ghost"
            size="icon"
            className="size-7 text-ink-3 hover:text-ink-1"
            aria-label="Zoom out"
          >
            <ZoomOut className="size-3.5" />
          </Button>
          <span className="w-8 text-center font-mono text-fs-micro text-ink-3">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            type="button"
            onClick={onZoomIn}
            variant="ghost"
            size="icon"
            className="size-7 text-ink-3 hover:text-ink-1"
            aria-label="Zoom in"
          >
            <ZoomIn className="size-3.5" />
          </Button>
          <Button
            type="button"
            onClick={onZoomFit}
            variant="ghost"
            size="icon"
            className="size-7 text-ink-3 hover:text-ink-1"
            aria-label="Fit zoom"
          >
            <Maximize2 className="size-3.5" />
          </Button>
        </ToolbarGroup>
        <Button
          type="button"
          onClick={onResetAll}
          variant="outline"
          size="sm"
          className="gap-sp-1 px-sp-3 font-mono text-fs-micro text-ink-2"
        >
          <RotateCcw className="size-3" />
          Reset
        </Button>
        <Button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          size="sm"
          className="gap-sp-1 px-sp-4 font-mono text-fs-micro font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Save className="size-3" />
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </ToolbarGroup>
    </Toolbar>
  );
}
