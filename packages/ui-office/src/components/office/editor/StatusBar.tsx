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
    <div className="flex h-8 shrink-0 items-center justify-between border-t border-line-soft px-sp-4">
      <div className="flex items-center gap-sp-3">
        <p className="font-mono text-fs-micro text-ink-3">
          {zoneCount} zones · {itemCount} items
          {placingPresetLabel && ` · Placing: ${placingPresetLabel}`}
          {isDragging && ' · Dragging...'}
        </p>
        {overlapCount > 0 && (
          <span className="rounded-r-xs bg-danger-surface px-sp-2 py-sp-1 font-mono text-fs-micro text-danger">
            {overlapCount} overlap{overlapCount > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <p className="font-mono text-fs-micro text-ink-2">
        <Grid3X3 className="mr-sp-1 inline h-3 w-3" />
        {Math.round(zoom * 100)}% · {SCALE}px/unit
      </p>
    </div>
  );
}
