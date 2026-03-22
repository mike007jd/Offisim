/**
 * StudioPlotSelector -- Bottom bar for selecting the office plot size.
 *
 * Shows preset sizes as buttons. Active preset is highlighted.
 * Positioned at the bottom of the studio viewport, overlaying the R3F Canvas.
 */

import { useStudioStore, PLOT_SIZES, type PlotSize } from './StudioState.js';

// -- Styles -------------------------------------------------------------------

const BAR_STYLE: React.CSSProperties = {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  height: 48,
  background: 'rgba(15, 15, 26, 0.95)',
  borderTop: '1px solid #333',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 14px',
  fontFamily: 'Inter, system-ui, sans-serif',
  zIndex: 10,
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: 'uppercase',
  color: '#64748b',
  marginRight: 8,
  flexShrink: 0,
};

const BTN_BASE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '4px 14px',
  border: '1px solid transparent',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'background 0.1s, border-color 0.1s',
};

// -- Component ----------------------------------------------------------------

export function StudioPlotSelector() {
  const plotSize = useStudioStore((s) => s.plotSize);
  const setPlotSize = useStudioStore((s) => s.setPlotSize);

  return (
    <div style={BAR_STYLE}>
      <span style={LABEL_STYLE}>Plot Size</span>
      {PLOT_SIZES.map((size: PlotSize) => {
        const active = plotSize.name === size.name;
        return (
          <button
            key={size.name}
            onClick={() => setPlotSize(size)}
            style={{
              ...BTN_BASE,
              background: active ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
              color: active ? '#a5b4fc' : '#ccc',
              borderColor: active ? 'rgba(99,102,241,0.5)' : 'transparent',
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600 }}>{size.name}</span>
            <span style={{ fontSize: 9, fontFamily: 'monospace', color: active ? '#818cf8' : '#64748b' }}>
              {size.width}&times;{size.depth}
            </span>
          </button>
        );
      })}
    </div>
  );
}
