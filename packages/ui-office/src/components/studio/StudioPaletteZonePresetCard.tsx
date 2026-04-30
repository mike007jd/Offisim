import type { ZonePreset } from '@offisim/shared-types';
import { Lock } from 'lucide-react';
import { useState } from 'react';
import { useStudioStore } from './StudioState.js';
import {
  FONT,
  LAYOUT,
  SP,
  STUDIO_COLORS,
  STUDIO_TRANSITION,
} from './studio-style-helpers.js';

export function StudioPaletteZonePresetCard({
  preset,
  isRequired,
  onStartPlacement,
}: {
  preset: ZonePreset;
  isRequired: boolean;
  onStartPlacement?: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  const handleClick = () => {
    if (onStartPlacement) onStartPlacement();
    else useStudioStore.getState().startZonePlacement(preset);
  };

  const sizeLabel = `${preset.w}x${preset.d}`;
  const itemsLabel = `${preset.prefabs.length} items`;
  const desksLabel = preset.deskSlots > 0 ? `${preset.deskSlots} desks` : null;

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={`Place ${preset.label} zone (${sizeLabel})`}
      title={preset.description}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: SP.sm,
        padding: `${SP.sm}px ${SP.xs}px`,
        borderRadius: LAYOUT.cardRadius,
        background: hovered ? STUDIO_COLORS.surface2 : STUDIO_COLORS.surface1,
        border: `1px solid ${STUDIO_COLORS.borderSubtle}`,
        cursor: 'pointer',
        fontFamily: FONT.family,
        textAlign: 'left',
        transition: STUDIO_TRANSITION.allFast,
        width: '100%',
      }}
    >
      {/* Color swatch with optional lock overlay */}
      <div
        style={{
          position: 'relative',
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: 4,
          background: preset.accentColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {/* Inner proportional size indicator */}
        <div
          style={{
            width: Math.min(20, Math.round((preset.w / Math.max(preset.w, preset.d)) * 20)),
            height: Math.min(20, Math.round((preset.d / Math.max(preset.w, preset.d)) * 20)),
            borderRadius: 2,
            background: STUDIO_COLORS.surface0,
          }}
        />
        {isRequired && (
          <div
            style={{
              position: 'absolute',
              bottom: 1,
              right: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Lock size={8} style={{ color: STUDIO_COLORS.textInverse }} />
          </div>
        )}
      </div>

      {/* Text info */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: FONT.base,
            fontWeight: FONT.medium,
            color: STUDIO_COLORS.textSecondary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {preset.label}
        </span>
        <span
          style={{
            fontSize: FONT.xs,
            color: STUDIO_COLORS.textTertiary,
            display: 'flex',
            gap: SP.xs,
            flexWrap: 'wrap' as const,
          }}
        >
          <span>{sizeLabel}</span>
          <span style={{ color: STUDIO_COLORS.textDisabled }}>·</span>
          <span>{itemsLabel}</span>
          {desksLabel && (
            <>
              <span style={{ color: STUDIO_COLORS.textDisabled }}>·</span>
              <span>{desksLabel}</span>
            </>
          )}
        </span>
      </div>
    </button>
  );
}
