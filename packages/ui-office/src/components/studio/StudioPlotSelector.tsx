/**
 * StudioPlotSelector -- Bottom bar for selecting the office plot size.
 *
 * Shows preset sizes as buttons. Active preset is highlighted.
 * Positioned at the bottom of the studio viewport, overlaying the R3F Canvas.
 */

import { PLOT_SIZES, type PlotSize, useStudioStore } from './StudioState.js';
import {
  FONT,
  SP,
  STUDIO_COLORS,
  labelStyle,
  panelStyle,
  toolButtonStyle,
} from './studio-tokens.js';

// -- Component ----------------------------------------------------------------

export function StudioPlotSelector() {
  const plotSize = useStudioStore((s) => s.plotSize);
  const setPlotSize = useStudioStore((s) => s.setPlotSize);

  return (
    <div style={panelStyle('bottom')}>
      <span
        style={{
          ...labelStyle(),
          marginBottom: 0,
          marginRight: SP.sm,
          flexShrink: 0,
        }}
      >
        Plot Size
      </span>
      {PLOT_SIZES.map((size: PlotSize) => {
        const active = plotSize.name === size.name;
        return (
          <button
            key={size.name}
            type="button"
            onClick={() => setPlotSize(size)}
            aria-label={`Set plot size to ${size.name} (${size.width} x ${size.depth})`}
            style={{
              ...toolButtonStyle(active),
              flexDirection: 'column',
              padding: `${SP.xs}px ${SP.lg}px`,
            }}
          >
            <span style={{ fontSize: FONT.base, fontWeight: FONT.semibold }}>{size.name}</span>
            <span
              style={{
                fontSize: FONT.xs,
                fontFamily: FONT.mono,
                color: active ? STUDIO_COLORS.accentHover : STUDIO_COLORS.textTertiary,
              }}
            >
              {size.width}&times;{size.depth}
            </span>
          </button>
        );
      })}
    </div>
  );
}
