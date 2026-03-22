/**
 * EditorToolbar — Top-left floating toolbar for editor controls.
 *
 * Contains:
 * - View/Edit mode toggle
 * - Save layout button (persists to localStorage)
 * - Reset button (clears all editor-placed prefabs)
 * - Placement count badge
 */

import { useEffect, useRef, useState } from 'react';
import { useEditor } from './EditorMode.js';

// ── Styles ───────────────────────────────────────────────────────

const TOOLBAR_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 12,
  top: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'rgba(15, 23, 42, 0.92)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(51, 65, 85, 0.5)',
  borderRadius: 10,
  padding: '4px 6px',
  fontFamily: 'Inter, system-ui, sans-serif',
  zIndex: 30,
};

const BTN_BASE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  padding: '4px 10px',
  border: '1px solid transparent',
  borderRadius: 6,
  fontSize: 10,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'background 0.1s, border-color 0.1s',
  whiteSpace: 'nowrap',
};

// ── Save button styles by flash state ─────────────────────────────
const SAVE_STYLES: Record<'idle' | 'saved' | 'error', Pick<React.CSSProperties, 'background' | 'borderColor'>> = {
  idle:  { background: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.3)' },
  saved: { background: 'rgba(16, 185, 129, 0.35)', borderColor: 'rgba(16, 185, 129, 0.6)' },
  error: { background: 'rgba(239, 68, 68, 0.2)',   borderColor: 'rgba(16, 185, 129, 0.3)' },
};

const SAVE_LABELS: Record<'idle' | 'saved' | 'error', string> = {
  idle: 'Save', saved: 'Saved!', error: 'Error',
};

// ── Component ────────────────────────────────────────────────────

export function EditorToolbar() {
  const { mode, toggleMode, placedPrefabs, resetAll, activeTool, cancelPlacement, saveLayout } = useEditor();
  const [saveFlash, setSaveFlash] = useState<'idle' | 'saved' | 'error'>('idle');
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Cleanup timer on unmount
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const isEdit = mode === 'edit';
  const isPlacing = activeTool === 'place';
  const count = placedPrefabs.length;

  return (
    <div style={TOOLBAR_STYLE}>
      {/* Mode toggle */}
      <button
        onClick={toggleMode}
        style={{
          ...BTN_BASE,
          background: isEdit
            ? 'rgba(59, 130, 246, 0.25)'
            : 'rgba(51, 65, 85, 0.3)',
          borderColor: isEdit
            ? 'rgba(59, 130, 246, 0.5)'
            : 'rgba(71, 85, 105, 0.3)',
          color: isEdit ? '#93c5fd' : 'var(--text-secondary-val)',
        }}
      >
        <ModeIcon isEdit={isEdit} />
        {isEdit ? 'Edit' : 'View'}
      </button>

      {isEdit && (
        <>
          {/* Separator */}
          <div style={{
            width: 1,
            height: 18,
            background: 'rgba(51, 65, 85, 0.5)',
            margin: '0 2px',
          }} />

          {/* Cancel placement */}
          {isPlacing && (
            <button
              onClick={cancelPlacement}
              style={{
                ...BTN_BASE,
                background: 'rgba(245, 158, 11, 0.15)',
                borderColor: 'rgba(245, 158, 11, 0.3)',
                color: '#fbbf24',
              }}
            >
              Cancel
            </button>
          )}

          {/* Save layout to localStorage */}
          <button
            onClick={async () => {
              clearTimeout(flashTimer.current);
              const ok = await saveLayout();
              setSaveFlash(ok ? 'saved' : 'error');
              flashTimer.current = setTimeout(() => setSaveFlash('idle'), 1500);
            }}
            style={{ ...BTN_BASE, ...SAVE_STYLES[saveFlash], color: '#6ee7b7' }}
          >
            <SaveIcon />
            {SAVE_LABELS[saveFlash]}
          </button>

          {/* Reset */}
          {count > 0 && (
            <button
              onClick={resetAll}
              style={{
                ...BTN_BASE,
                background: 'rgba(239, 68, 68, 0.1)',
                borderColor: 'rgba(239, 68, 68, 0.25)',
                color: '#fca5a5',
              }}
            >
              Reset
            </button>
          )}

          {/* Count badge */}
          {count > 0 && (
            <span style={{
              fontSize: 9,
              fontFamily: 'monospace',
              color: 'var(--text-muted-val)',
              padding: '2px 6px',
              background: 'rgba(51, 65, 85, 0.3)',
              borderRadius: 4,
            }}>
              {count} placed
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ── Inline SVG icons (no deps) ───────────────────────────────────

function ModeIcon({ isEdit }: { isEdit: boolean }) {
  if (isEdit) {
    // Pencil icon
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    );
  }
  // Eye icon
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17,21 17,13 7,13 7,21" />
      <polyline points="7,3 7,8 15,8" />
    </svg>
  );
}
