import type { PrefabDefinition, SemanticCategory } from '@offisim/shared-types';
import { useState } from 'react';
import { PrefabThumbnail } from './PrefabThumbnail.js';
import { FONT, LAYOUT, SP, STUDIO_COLORS, STUDIO_TRANSITION } from './studio-style-helpers.js';

const CATEGORY_COLOR_MAP: Record<SemanticCategory, string> = {
  workspace: STUDIO_COLORS.catWorkspace,
  compute: STUDIO_COLORS.catCompute,
  knowledge: STUDIO_COLORS.catKnowledge,
  collaboration: STUDIO_COLORS.catCollaboration,
  infrastructure: STUDIO_COLORS.catInfrastructure,
  decorative: STUDIO_COLORS.catDecorative,
};

export function StudioPalettePrefabCard({
  definition,
  isActive,
  onSelect,
}: {
  definition: PrefabDefinition;
  isActive: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const color = CATEGORY_COLOR_MAP[definition.category] ?? STUDIO_COLORS.textSecondary;

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={`Place ${definition.name} (${definition.gridSize[0]}x${definition.gridSize[1]})`}
      title={`${definition.name} (${definition.gridSize[0]}x${definition.gridSize[1]})`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        padding: `${SP.sm}px ${SP.xs}px ${SP.xs}px`,
        borderRadius: LAYOUT.cardRadius,
        background: isActive
          ? STUDIO_COLORS.accentMuted
          : hovered
            ? STUDIO_COLORS.surface2
            : STUDIO_COLORS.surface1,
        border: isActive
          ? `1px solid ${STUDIO_COLORS.borderActive}`
          : `1px solid ${STUDIO_COLORS.borderSubtle}`,
        cursor: 'pointer',
        fontFamily: FONT.family,
        transition: STUDIO_TRANSITION.allFast,
      }}
    >
      <PrefabThumbnail
        prefabId={definition.prefabId}
        size={32}
        color={isActive ? STUDIO_COLORS.accentText : color}
      />
      <span
        style={{
          fontSize: FONT.xs,
          fontWeight: FONT.medium,
          color: isActive ? STUDIO_COLORS.accentText : STUDIO_COLORS.textTertiary,
          textAlign: 'center',
          lineHeight: 1.15,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical' as const,
          wordBreak: 'break-word' as const,
          width: '100%',
        }}
      >
        {definition.name}
      </span>
    </button>
  );
}
