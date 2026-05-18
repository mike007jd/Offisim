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
      className="h-auto w-full justify-start gap-2 rounded-md border border-border-subtle bg-surface-muted px-1 py-2 text-left hover:bg-surface-hover"
    >
      {/* Color swatch with optional lock overlay */}
      <div
        className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded"
        style={{
          background: preset.accentColor,
        }}
      >
        {/* Inner proportional size indicator */}
        <div
          className="rounded-sm bg-surface-elevated"
          style={{
            width: Math.min(20, Math.round((preset.w / Math.max(preset.w, preset.d)) * 20)),
            height: Math.min(20, Math.round((preset.d / Math.max(preset.w, preset.d)) * 20)),
          }}
        />
        {isRequired && (
          <div className="absolute bottom-px right-px flex items-center justify-center">
            <Lock className="size-2 text-text-inverse" aria-hidden="true" />
          </div>
        )}
      </div>

      {/* Text info */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-caption font-medium text-text-secondary">
          {preset.label}
        </span>
        <span className="flex flex-wrap gap-1 text-caption text-text-muted">
          <span>{sizeLabel}</span>
          <span className="text-text-disabled">·</span>
          <span>{itemsLabel}</span>
          {desksLabel && (
            <>
              <span className="text-text-disabled">·</span>
              <span>{desksLabel}</span>
            </>
          )}
        </span>
      </div>
    </Button>
  );
}
