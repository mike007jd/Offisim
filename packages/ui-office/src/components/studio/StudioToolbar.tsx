/**
 * StudioToolbar -- Top toolbar with tool buttons, grid toggle, item count, save, and back.
 *
 * Positioned at the top of the studio viewport, overlaying the R3F Canvas.
 * Keyboard shortcuts: 1=Select, 2=Move, 3=Rotate, 4=Place, G=Grid snap.
 */

import { Button, cn } from '@offisim/ui-core';
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

// -- Presentation --------------------------------------------------------------

const toolbarButtonClass =
  'h-8 gap-1 rounded-md px-2 font-sans text-xs text-text-secondary data-[active=true]:border-accent data-[active=true]:bg-accent-muted data-[active=true]:text-accent-text';

const kbdClass =
  'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-subtle bg-surface-muted px-1 font-mono text-caption leading-none text-text-muted';

const separatorClass = 'mx-2 h-6 w-px shrink-0 bg-border-default';

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
    <div className="absolute left-0 right-0 top-0 z-sticky flex h-11 items-center overflow-hidden border-b border-border-default bg-surface-elevated font-sans">
      {/* Back */}
      <Button
        type="button"
        onClick={onBack}
        aria-label="Back to company selection"
        variant="ghost"
        size="sm"
        className={toolbarButtonClass}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Back</span>
      </Button>

      <div className={separatorClass} />

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
            className={toolbarButtonClass}
          >
            <t.Icon className="h-3.5 w-3.5" />
            <kbd className={kbdClass}>{t.shortcut}</kbd>
          </Button>
        );
      })}

      <div className={separatorClass} />

      {/* Grid snap toggle */}
      <Button
        type="button"
        onClick={toggleGridSnap}
        aria-label={`Toggle grid snap (G) — currently ${gridSnap ? 'on' : 'off'}`}
        variant="ghost"
        size="sm"
        data-active={gridSnap}
        className={toolbarButtonClass}
      >
        <Grid3x3 className="h-3.5 w-3.5" />
        <kbd className={kbdClass}>G</kbd>
      </Button>

      <div className={separatorClass} />

      {/* Edit Zone controls */}
      {isEditingZone ? (
        <Button
          type="button"
          onClick={exitEditZone}
          aria-label="Exit zone editing (Esc)"
          variant="outline"
          size="sm"
          className={cn(toolbarButtonClass, 'border-warning bg-warning-muted text-warning')}
        >
          <X className="h-3.5 w-3.5" />
          <span className="font-semibold">{editingZoneLabel}</span>
          <kbd className={kbdClass}>Esc</kbd>
        </Button>
      ) : selectedZoneId ? (
        <Button
          type="button"
          onClick={() => enterEditZone(selectedZoneId)}
          aria-label="Enter zone editing mode"
          variant="ghost"
          size="sm"
          className={toolbarButtonClass}
        >
          <BoxSelect className="h-3.5 w-3.5" />
          <span>Edit Zone</span>
        </Button>
      ) : null}

      <div className={separatorClass} />

      {/* Item count */}
      <span className="font-mono text-xs text-text-secondary">
        {instanceCount} item{instanceCount !== 1 ? 's' : ''}
      </span>

      <div className="flex-1" />

      {/* Save — wrapped for dirty indicator dot */}
      <div className="relative mr-2">
        <Button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          aria-label={saving ? 'Saving in progress' : 'Save layout (Ctrl+S)'}
          variant="ghost"
          size="sm"
          data-active={canSave}
          className={cn(
            toolbarButtonClass,
            !canSave && 'cursor-not-allowed',
            saveFlash && 'border-success bg-success-muted text-success',
          )}
        >
          <Save className="h-3.5 w-3.5" />
          <span>{saving ? 'Saving\u2026' : saveFlash ? 'Saved!' : 'Save'}</span>
          <kbd className={kbdClass}>{'\u2318'}S</kbd>
        </Button>
        {/* Dirty amber dot — Skill §15 */}
        {dirty && !saveFlash && (
          <div className="-right-0.5 -top-0.5 pointer-events-none absolute h-1.5 w-1.5 rounded-full bg-warning" />
        )}
      </div>
    </div>
  );
}
