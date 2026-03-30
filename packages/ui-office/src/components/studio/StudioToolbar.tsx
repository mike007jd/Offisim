/**
 * StudioToolbar -- Top toolbar with tool buttons, grid toggle, item count, save, and back.
 *
 * Positioned at the top of the studio viewport, overlaying the R3F Canvas.
 * Keyboard shortcuts: 1=Select, 2=Move, 3=Rotate, 4=Place, G=Grid snap.
 */

import { ArrowLeft, BoxSelect, Grid3x3, MousePointer2, Move, Plus, RotateCcw, Save, X } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { type StudioTool, useStudioStore } from './StudioState.js';
import { FONT, SP, STUDIO_COLORS, kbdStyle, panelStyle, toolButtonStyle } from './studio-tokens.js';

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
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', shortcut: 'Q', Icon: MousePointer2 },
  { id: 'move', label: 'Move', shortcut: 'W', Icon: Move },
  { id: 'rotate', label: 'Rotate', shortcut: 'E', Icon: RotateCcw },
  { id: 'place', label: 'Place', shortcut: 'P', Icon: Plus },
];

// -- Styles -------------------------------------------------------------------

const SEPARATOR: React.CSSProperties = {
  width: 1,
  height: SP.xxl,
  background: STUDIO_COLORS.border,
  margin: `0 ${SP.sm}px`,
  flexShrink: 0,
};

const SPACER: React.CSSProperties = { flex: 1 };

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
  const focusedZoneId = useStudioStore((s) => s.focusedZoneId);
  const zones = useStudioStore((s) => s.zones);
  const enterEditZone = useStudioStore((s) => s.enterEditZone);
  const exitEditZone = useStudioStore((s) => s.exitEditZone);

  const editingZoneLabel = isEditingZone
    ? zones.find((z) => z.zoneId === focusedZoneId)?.label ?? 'Zone'
    : null;

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
    <div style={panelStyle('top')}>
      {/* Back */}
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to company selection"
        style={{
          ...toolButtonStyle(false),
          gap: SP.xs,
        }}
      >
        <ArrowLeft size={14} />
        <span>Back</span>
      </button>

      <div style={SEPARATOR} />

      {/* Tool buttons */}
      {TOOLS.map((t) => {
        const active = tool === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTool(t.id)}
            aria-label={`${t.label} tool (${t.shortcut})`}
            style={toolButtonStyle(active)}
          >
            <t.Icon size={14} />
            <kbd style={kbdStyle()}>{t.shortcut}</kbd>
          </button>
        );
      })}

      <div style={SEPARATOR} />

      {/* Grid snap toggle */}
      <button
        type="button"
        onClick={toggleGridSnap}
        aria-label={`Toggle grid snap (G) — currently ${gridSnap ? 'on' : 'off'}`}
        style={toolButtonStyle(gridSnap)}
      >
        <Grid3x3 size={14} />
        <kbd style={kbdStyle()}>G</kbd>
      </button>

      <div style={SEPARATOR} />

      {/* Edit Zone controls */}
      {isEditingZone ? (
        <button
          type="button"
          onClick={exitEditZone}
          aria-label="Exit zone editing (Esc)"
          style={{
            ...toolButtonStyle(true),
            borderColor: '#f59e0b',
            background: 'rgba(245, 158, 11, 0.12)',
            color: '#fbbf24',
            gap: SP.xs,
          }}
        >
          <X size={14} />
          <span style={{ fontSize: FONT.sm, fontWeight: 600 }}>{editingZoneLabel}</span>
          <kbd style={kbdStyle()}>Esc</kbd>
        </button>
      ) : selectedZoneId ? (
        <button
          type="button"
          onClick={() => enterEditZone(selectedZoneId)}
          aria-label="Enter zone editing mode"
          style={{
            ...toolButtonStyle(false),
            gap: SP.xs,
          }}
        >
          <BoxSelect size={14} />
          <span>Edit Zone</span>
        </button>
      ) : null}

      <div style={SEPARATOR} />

      {/* Item count */}
      <span
        style={{
          fontSize: FONT.base,
          fontFamily: FONT.mono,
          color: STUDIO_COLORS.textSecondary,
        }}
      >
        {instanceCount} item{instanceCount !== 1 ? 's' : ''}
      </span>

      <div style={SPACER} />

      {/* Save — wrapped for dirty indicator dot */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          aria-label={saving ? 'Saving in progress' : 'Save layout (Ctrl+S)'}
          style={{
            ...toolButtonStyle(canSave),
            cursor: canSave ? 'pointer' : 'not-allowed',
            ...(saveFlash
              ? {
                  background: STUDIO_COLORS.successMuted,
                  color: STUDIO_COLORS.success,
                  borderColor: STUDIO_COLORS.success,
                }
              : {}),
          }}
        >
          <Save size={14} />
          <span>{saving ? 'Saving\u2026' : saveFlash ? 'Saved!' : 'Save'}</span>
          <kbd style={kbdStyle()}>{'\u2318'}S</kbd>
        </button>
        {/* Dirty amber dot — Skill §15 */}
        {dirty && !saveFlash && (
          <div
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: STUDIO_COLORS.warning,
              pointerEvents: 'none',
            }}
          />
        )}
        {/* TODO: save success scale bounce animation — see Skill §14 timings */}
      </div>
    </div>
  );
}
