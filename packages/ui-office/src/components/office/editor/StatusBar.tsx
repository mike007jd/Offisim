import { Grid3X3 } from 'lucide-react';
import { SCALE } from './types.js';

export interface StatusBarProps {
  zoneCount: number;
  itemCount: number;
  placingPresetLabel: string | null;
  isDragging: boolean;
  overlapCount: number;
  zoom: number;
}

export function StatusBar({
  zoneCount,
  itemCount,
  placingPresetLabel,
  isDragging,
  overlapCount,
  zoom,
}: StatusBarProps) {
  return (
    <div className="office-editor-status-bar">
      <div className="office-editor-status-group">
        <p className="office-editor-status-copy">
          {zoneCount} zones · {itemCount} items
          {placingPresetLabel && ` · Placing: ${placingPresetLabel}`}
          {isDragging && ' · Dragging...'}
        </p>
        {overlapCount > 0 && (
          <span className="office-editor-status-overlap">
            {overlapCount} overlap{overlapCount > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <p className="office-editor-status-scale">
        <Grid3X3 data-icon="grid" aria-hidden="true" />
        {Math.round(zoom * 100)}% · {SCALE}px/unit
      </p>
    </div>
  );
}
