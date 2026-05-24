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
      className="studio-zone-preset-card"
    >
      {/* Color swatch with optional lock overlay */}
      <div className="studio-zone-preset-swatch">
        {/* Inner proportional size indicator */}
        <svg className="studio-zone-preset-swatch-map" viewBox="0 0 28 28" aria-hidden="true">
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
          <div className="studio-zone-preset-lock">
            <Lock data-icon="lock" aria-hidden="true" />
          </div>
        )}
      </div>

      {/* Text info */}
      <div className="studio-zone-preset-copy">
        <span className="studio-zone-preset-title">{preset.label}</span>
        <span className="studio-zone-preset-meta">
          <span>{sizeLabel}</span>
          <span data-separator>·</span>
          <span>{itemsLabel}</span>
          {desksLabel && (
            <>
              <span data-separator>·</span>
              <span>{desksLabel}</span>
            </>
          )}
        </span>
      </div>
    </Button>
  );
}
