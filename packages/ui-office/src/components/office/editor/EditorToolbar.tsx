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
    <Toolbar className="editor-toolbar">
      <div className="editor-toolbar-start">
        <Button
          type="button"
          onClick={onClose}
          variant="ghost"
          size="sm"
          className="editor-toolbar-back"
          aria-label="Close editor"
        >
          <ArrowLeft data-icon="button" aria-hidden="true" />
        </Button>
        <ToolbarSeparator className="editor-toolbar-separator" />
        <h1>OFFICE STUDIO</h1>
        <Badge variant="secondary" className="editor-toolbar-badge">
          Zone edit mode
        </Badge>
        {selectedZoneLabel && (
          <Badge variant="info" className="editor-toolbar-badge">
            Focus: {selectedZoneLabel}
          </Badge>
        )}
        {dirty && (
          <Badge variant="warning" className="editor-toolbar-badge" data-offset="true">
            Unsaved
          </Badge>
        )}
      </div>
      <ToolbarGroup className="editor-toolbar-actions">
        <ToolbarGroup className="editor-toolbar-zoom">
          <Button
            type="button"
            onClick={onZoomOut}
            variant="ghost"
            size="icon"
            className="editor-toolbar-icon"
            aria-label="Zoom out"
          >
            <ZoomOut data-icon="button" aria-hidden="true" />
          </Button>
          <span className="editor-toolbar-zoom-value">{Math.round(zoom * 100)}%</span>
          <Button
            type="button"
            onClick={onZoomIn}
            variant="ghost"
            size="icon"
            className="editor-toolbar-icon"
            aria-label="Zoom in"
          >
            <ZoomIn data-icon="button" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            onClick={onZoomFit}
            variant="ghost"
            size="icon"
            className="editor-toolbar-icon"
            aria-label="Fit zoom"
          >
            <Maximize2 data-icon="button" aria-hidden="true" />
          </Button>
        </ToolbarGroup>
        <Button
          type="button"
          onClick={onResetAll}
          variant="outline"
          size="sm"
          className="editor-toolbar-action"
        >
          <RotateCcw data-icon="inline-start" aria-hidden="true" />
          Reset
        </Button>
        <Button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          size="sm"
          className="editor-toolbar-save"
        >
          <Save data-icon="inline-start" aria-hidden="true" />
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </ToolbarGroup>
    </Toolbar>
  );
}
