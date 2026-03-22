/**
 * StudioToolbar -- Top toolbar with tool buttons, grid toggle, item count, save, and back.
 *
 * Positioned at the top of the studio viewport, overlaying the R3F Canvas.
 * Keyboard shortcuts: 1=Select, 2=Move, 3=Rotate, 4=Place, G=Grid snap.
 */

import { useEffect, useCallback } from 'react';
import { useStudioStore, type StudioTool } from './StudioState.js';

// -- Types --------------------------------------------------------------------

interface StudioToolbarProps {
  onSave: () => void;
  onBack: () => void;
  saving?: boolean;
}

// -- Tool definitions ---------------------------------------------------------

interface ToolDef {
  id: StudioTool;
  label: string;
  shortcut: string;
  icon: string;
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', shortcut: '1', icon: '\u25B3' },
  { id: 'move', label: 'Move', shortcut: '2', icon: '\u2725' },
  { id: 'rotate', label: 'Rotate', shortcut: '3', icon: '\u21BB' },
  { id: 'place', label: 'Place', shortcut: '4', icon: '\u271A' },
];

// -- Styles -------------------------------------------------------------------

const BAR_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 48,
  background: 'rgba(15, 15, 26, 0.95)',
  borderBottom: '1px solid #333',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 10px',
  fontFamily: 'Inter, system-ui, sans-serif',
  zIndex: 10,
};

const TOOL_BTN_BASE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  border: '1px solid transparent',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'inherit',
  transition: 'background 0.1s, border-color 0.1s',
};

const SHORTCUT_STYLE: React.CSSProperties = {
  fontSize: 9,
  fontFamily: 'monospace',
  opacity: 0.5,
  marginLeft: 2,
};

const SEPARATOR: React.CSSProperties = {
  width: 1,
  height: 24,
  background: '#333',
  margin: '0 6px',
  flexShrink: 0,
};

const SPACER: React.CSSProperties = { flex: 1 };

// -- Component ----------------------------------------------------------------

export function StudioToolbar({ onSave, onBack, saving }: StudioToolbarProps) {
  const tool = useStudioStore((s) => s.tool);
  const setTool = useStudioStore((s) => s.setTool);
  const gridSnap = useStudioStore((s) => s.gridSnap);
  const toggleGridSnap = useStudioStore((s) => s.toggleGridSnap);
  const dirty = useStudioStore((s) => s.dirty);
  const instanceCount = useStudioStore((s) => s.instances.length);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      switch (e.key) {
        case '1':
          setTool('select');
          break;
        case '2':
          setTool('move');
          break;
        case '3':
          setTool('rotate');
          break;
        case '4':
          setTool('place');
          break;
        case 'g':
        case 'G':
          toggleGridSnap();
          break;
      }
    },
    [setTool, toggleGridSnap],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div style={BAR_STYLE}>
      {/* Back */}
      <button
        onClick={onBack}
        style={{
          ...TOOL_BTN_BASE,
          background: 'rgba(255,255,255,0.05)',
          color: '#ccc',
        }}
      >
        &larr; Back
      </button>

      <div style={SEPARATOR} />

      {/* Tool buttons */}
      {TOOLS.map((t) => {
        const active = tool === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            style={{
              ...TOOL_BTN_BASE,
              background: active ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
              color: active ? '#a5b4fc' : '#ccc',
              borderColor: active ? 'rgba(99,102,241,0.5)' : 'transparent',
            }}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
            <span style={SHORTCUT_STYLE}>{t.shortcut}</span>
          </button>
        );
      })}

      <div style={SEPARATOR} />

      {/* Grid snap toggle */}
      <button
        onClick={toggleGridSnap}
        style={{
          ...TOOL_BTN_BASE,
          background: gridSnap ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
          color: gridSnap ? '#a5b4fc' : '#ccc',
          borderColor: gridSnap ? 'rgba(99,102,241,0.5)' : 'transparent',
        }}
        title="Toggle grid snap (G)"
      >
        <span>#</span>
        <span>Grid</span>
      </button>

      <div style={SEPARATOR} />

      {/* Item count */}
      <span
        style={{
          fontSize: 11,
          fontFamily: 'monospace',
          color: '#94a3b8',
        }}
      >
        {instanceCount} item{instanceCount !== 1 ? 's' : ''}
      </span>

      <div style={SPACER} />

      {/* Save */}
      <button
        onClick={onSave}
        disabled={!dirty || saving}
        style={{
          ...TOOL_BTN_BASE,
          background: dirty && !saving ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.03)',
          color: dirty && !saving ? '#a5b4fc' : '#555',
          borderColor: dirty && !saving ? 'rgba(99,102,241,0.5)' : 'transparent',
          cursor: dirty && !saving ? 'pointer' : 'not-allowed',
        }}
      >
        {saving ? 'Saving\u2026' : 'Save'}
      </button>
    </div>
  );
}
