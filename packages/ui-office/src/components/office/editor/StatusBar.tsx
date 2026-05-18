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
    <div className="flex h-8 shrink-0 items-center justify-between border-t border-border-subtle px-4">
      <div className="flex items-center gap-3">
        <p className="font-mono text-caption text-text-muted">
          {zoneCount} zones · {itemCount} items
          {placingPresetLabel && ` · Placing: ${placingPresetLabel}`}
          {isDragging && ' · Dragging...'}
        </p>
        {overlapCount > 0 && (
          <span className="rounded bg-error-muted px-2 py-0.5 font-mono text-caption text-error">
            {overlapCount} overlap{overlapCount > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <p className="font-mono text-caption text-text-secondary">
        <Grid3X3 className="inline h-3 w-3 mr-1" />
        {Math.round(zoom * 100)}% · {SCALE}px/unit
      </p>
    </div>
  );
}
