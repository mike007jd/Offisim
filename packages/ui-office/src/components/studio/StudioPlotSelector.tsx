/**
 * StudioPlotSelector -- Bottom bar for selecting the office plot size.
 *
 * Shows preset sizes as buttons. Active preset is highlighted.
 * Positioned at the bottom of the studio viewport, overlaying the R3F Canvas.
 */

import { Button } from '@offisim/ui-core';
import { PLOT_SIZES, type PlotSize, useStudioStore } from './StudioState.js';
import {
  STUDIO_LABEL_CLASS,
  STUDIO_PANEL_CLASS,
  studioToolButtonClass,
} from './studio-style-helpers.js';

// -- Component ----------------------------------------------------------------

export function StudioPlotSelector() {
  const plotSize = useStudioStore((s) => s.plotSize);
  const setPlotSize = useStudioStore((s) => s.setPlotSize);

  return (
    <div className={STUDIO_PANEL_CLASS.bottom}>
      <span className={`${STUDIO_LABEL_CLASS} mb-0 mr-sp-2`}>Plot Size</span>
      {PLOT_SIZES.map((size: PlotSize) => {
        const active = plotSize.name === size.name;
        return (
          <Button
            key={size.name}
            type="button"
            onClick={() => setPlotSize(size)}
            aria-label={`Set plot size to ${size.name} (${size.width} x ${size.depth})`}
            className={`flex-col px-sp-5 py-sp-1 ${studioToolButtonClass(active)}`}
          >
            <span className="text-fs-sm font-semibold">{size.name}</span>
            <span className={`font-mono text-fs-micro ${active ? 'text-accent' : 'text-ink-3'}`}>
              {size.width}×{size.depth}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
