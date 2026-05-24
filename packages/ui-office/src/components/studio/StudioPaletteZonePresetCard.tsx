import type { ZonePreset } from '@offisim/shared-types';
import { Button } from '@offisim/ui-core';
import { Lock } from 'lucide-react';
import { useStudioStore } from './StudioState.js';

export function StudioPaletteZonePresetCard({
  preset,
  isRequired,
  onStartPlacement,
}: {
  preset: ZonePreset;
  isRequired: boolean;
  onStartPlacement?: () => void;
}) {
  const handleClick = () => {
    if (onStartPlacement) onStartPlacement();
    else useStudioStore.getState().startZonePlacement(preset);
  };

  const sizeLabel = `${preset.w}x${preset.d}`;
  const itemsLabel = `${preset.prefabs.length} items`;
  const desksLabel = preset.deskSlots > 0 ? `${preset.deskSlots} desks` : null;

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={handleClick}
      aria-label={`Place ${preset.label} zone (${sizeLabel})`}
      title={preset.description}
      className="h-auto w-full justify-start gap-sp-2 rounded-r-md border border-line-soft bg-surface-2 px-sp-1 py-sp-2 text-left hover:bg-surface-sunken"
    >
      {/* Color swatch with optional lock overlay */}
      <div className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded">
        {/* Inner proportional size indicator */}
        <svg className="absolute inset-0 size-7" viewBox="0 0 28 28" aria-hidden="true">
          <rect width="28" height="28" rx="4" fill={preset.accentColor} />
          <rect
            x={(28 - Math.min(20, Math.round((preset.w / Math.max(preset.w, preset.d)) * 20))) / 2}
            y={(28 - Math.min(20, Math.round((preset.d / Math.max(preset.w, preset.d)) * 20))) / 2}
            width={Math.min(20, Math.round((preset.w / Math.max(preset.w, preset.d)) * 20))}
            height={Math.min(20, Math.round((preset.d / Math.max(preset.w, preset.d)) * 20))}
            rx="2"
            className="fill-surface-1"
          />
        </svg>
        {isRequired && (
          <div className="absolute bottom-px right-px flex items-center justify-center">
            <Lock className="size-2 text-ink-inverse" aria-hidden="true" />
          </div>
        )}
      </div>

      {/* Text info */}
      <div className="flex min-w-0 flex-1 flex-col gap-sp-1">
        <span className="truncate text-fs-micro font-medium text-ink-2">{preset.label}</span>
        <span className="flex flex-wrap gap-sp-1 text-fs-micro text-ink-3">
          <span>{sizeLabel}</span>
          <span className="text-ink-4">·</span>
          <span>{itemsLabel}</span>
          {desksLabel && (
            <>
              <span className="text-ink-4">·</span>
              <span>{desksLabel}</span>
            </>
          )}
        </span>
      </div>
    </Button>
  );
}
