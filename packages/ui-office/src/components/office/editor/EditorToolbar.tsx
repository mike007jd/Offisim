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
    <Toolbar className="h-12 shrink-0 justify-between border-b border-border-subtle px-4">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={onClose}
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2.5 text-text-muted hover:text-text-primary"
          aria-label="Close editor"
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <ToolbarSeparator className="h-4" />
        <h1 className="font-mono text-xs font-black uppercase tracking-wider text-text-primary">
          OFFICE STUDIO
        </h1>
        <Badge variant="secondary" className="font-mono text-caption">
          Zone edit mode
        </Badge>
        {selectedZoneLabel && (
          <Badge variant="info" className="font-mono text-caption">
            Focus: {selectedZoneLabel}
          </Badge>
        )}
        {dirty && (
          <Badge variant="warning" className="ml-2 font-mono text-caption">
            Unsaved
          </Badge>
        )}
      </div>
      <ToolbarGroup className="gap-2">
        <ToolbarGroup className="mr-2 gap-1">
          <Button
            type="button"
            onClick={onZoomOut}
            variant="ghost"
            size="icon"
            className="size-7 text-text-muted hover:text-text-primary"
            aria-label="Zoom out"
          >
            <ZoomOut className="size-3.5" />
          </Button>
          <span className="w-8 text-center font-mono text-caption text-text-muted">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            type="button"
            onClick={onZoomIn}
            variant="ghost"
            size="icon"
            className="size-7 text-text-muted hover:text-text-primary"
            aria-label="Zoom in"
          >
            <ZoomIn className="size-3.5" />
          </Button>
          <Button
            type="button"
            onClick={onZoomFit}
            variant="ghost"
            size="icon"
            className="size-7 text-text-muted hover:text-text-primary"
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
          className="gap-1.5 px-3 font-mono text-caption text-text-secondary"
        >
          <RotateCcw className="size-3" />
          Reset
        </Button>
        <Button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          size="sm"
          className="gap-1.5 px-4 font-mono text-caption font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Save className="size-3" />
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </ToolbarGroup>
    </Toolbar>
  );
}
