/**
 * StudioToolbar -- Top toolbar with tool buttons, grid toggle, item count, save, and back.
 *
 * Positioned at the top of the studio viewport, overlaying the R3F Canvas.
 * Keyboard shortcuts: 1=Select, 2=Move, 3=Rotate, 4=Place, G=Grid snap.
 */

import { Button } from '@offisim/ui-core';
import {
  ArrowLeft,
  BoxSelect,
  Grid3x3,
  type LucideIcon,
  MousePointer2,
  Move,
  Plus,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { type StudioTool, useStudioStore } from './StudioState.js';

// -- Types --------------------------------------------------------------------

interface StudioToolbarProps {
  onSave: () => void;
  onBack: () => void;
  saving?: boolean;
  saveFlash?: boolean;
}

// -- Tool definitions ---------------------------------------------------------

interface ToolDef {
  id: StudioTool;
  label: string;
  shortcut: string;
  Icon: LucideIcon;
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', shortcut: 'Q', Icon: MousePointer2 },
  { id: 'move', label: 'Move', shortcut: 'W', Icon: Move },
  { id: 'rotate', label: 'Rotate', shortcut: 'E', Icon: RotateCcw },
  { id: 'place', label: 'Place', shortcut: 'P', Icon: Plus },
];

// -- Component ----------------------------------------------------------------

export function StudioToolbar({ onSave, onBack, saving, saveFlash }: StudioToolbarProps) {
  const tool = useStudioStore((s) => s.tool);
  const setTool = useStudioStore((s) => s.setTool);
  const gridSnap = useStudioStore((s) => s.gridSnap);
  const toggleGridSnap = useStudioStore((s) => s.toggleGridSnap);
  const dirty = useStudioStore((s) => s.dirty);
  const instanceCount = useStudioStore((s) => s.instances.length);
  const selectedZoneId = useStudioStore((s) => s.selectedZoneId);
  const isEditingZone = useStudioStore((s) => s.isEditingZone);
  const enterEditZone = useStudioStore((s) => s.enterEditZone);
  const exitEditZone = useStudioStore((s) => s.exitEditZone);
  const editingZoneLabel = useStudioStore((s) =>
    s.isEditingZone && s.focusedZoneId
      ? (s.zones.find((z) => z.zoneId === s.focusedZoneId)?.label ?? 'Zone')
      : null,
  );

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Esc exits Edit Zone mode
      if (e.key === 'Escape' && isEditingZone) {
        exitEditZone();
        return;
      }

      switch (e.key) {
        case 'q':
        case 'Q':
          setTool('select');
          break;
        case 'w':
        case 'W':
          if (!e.metaKey && !e.ctrlKey) setTool('move');
          break;
        case 'e':
        case 'E':
          setTool('rotate');
          break;
        case 'p':
        case 'P':
          setTool('place');
          break;
        case 'g':
        case 'G':
          toggleGridSnap();
          break;
      }
    },
    [setTool, toggleGridSnap, isEditingZone, exitEditZone],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const canSave = dirty && !saving;

  return (
    <div className="studio-toolbar">
      {/* Back */}
      <Button
        type="button"
        onClick={onBack}
        aria-label="Back to company selection"
        variant="ghost"
        size="sm"
        className="studio-toolbar-button"
      >
        <ArrowLeft data-icon="inline-start" aria-hidden="true" />
        <span>Back</span>
      </Button>

      <div className="studio-toolbar-separator" />

      {/* Tool buttons */}
      {TOOLS.map((t) => {
        const active = tool === t.id;
        return (
          <Button
            key={t.id}
            type="button"
            onClick={() => setTool(t.id)}
            aria-label={`${t.label} tool (${t.shortcut})`}
            variant="ghost"
            size="sm"
            data-active={active}
            className="studio-toolbar-button"
          >
            <t.Icon data-icon="inline-start" aria-hidden="true" />
            <kbd>{t.shortcut}</kbd>
          </Button>
        );
      })}

      <div className="studio-toolbar-separator" />

      {/* Grid snap toggle */}
      <Button
        type="button"
        onClick={toggleGridSnap}
        aria-label={`Toggle grid snap (G) — currently ${gridSnap ? 'on' : 'off'}`}
        variant="ghost"
        size="sm"
        data-active={gridSnap}
        className="studio-toolbar-button"
      >
        <Grid3x3 data-icon="inline-start" aria-hidden="true" />
        <kbd>G</kbd>
      </Button>

      <div className="studio-toolbar-separator" />

      {/* Edit Zone controls */}
      {isEditingZone ? (
        <Button
          type="button"
          onClick={exitEditZone}
          aria-label="Exit zone editing (Esc)"
          variant="outline"
          size="sm"
          className="studio-toolbar-button"
          data-tone="warn"
        >
          <X data-icon="inline-start" aria-hidden="true" />
          <span data-slot="strong">{editingZoneLabel}</span>
          <kbd>Esc</kbd>
        </Button>
      ) : selectedZoneId ? (
        <Button
          type="button"
          onClick={() => enterEditZone(selectedZoneId)}
          aria-label="Enter zone editing mode"
          variant="ghost"
          size="sm"
          className="studio-toolbar-button"
        >
          <BoxSelect data-icon="inline-start" aria-hidden="true" />
          <span>Edit Zone</span>
        </Button>
      ) : null}

      <div className="studio-toolbar-separator" />

      {/* Item count */}
      <span className="studio-toolbar-count">
        {instanceCount} item{instanceCount !== 1 ? 's' : ''}
      </span>

      <div className="studio-toolbar-spacer" />

      {/* Save — wrapped for dirty indicator dot */}
      <div className="studio-toolbar-save-wrap">
        <Button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          aria-label={saving ? 'Saving in progress' : 'Save layout (Ctrl+S)'}
          variant="ghost"
          size="sm"
          data-active={canSave}
          className="studio-toolbar-button"
          data-disabled={!canSave ? 'true' : 'false'}
          data-flash={saveFlash ? 'true' : 'false'}
        >
          <Save data-icon="inline-start" aria-hidden="true" />
          <span>{saving ? 'Saving\u2026' : saveFlash ? 'Saved!' : 'Save'}</span>
          <kbd>{'\u2318'}S</kbd>
        </Button>
        {/* Dirty amber dot — Skill §15 */}
        {dirty && !saveFlash && <div className="studio-toolbar-dirty-dot" />}
      </div>
    </div>
  );
}
