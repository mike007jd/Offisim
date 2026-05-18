import type { PrefabDefinition, SemanticCategory } from '@offisim/shared-types';
import { Button, cn } from '@offisim/ui-core';
import { PrefabThumbnail } from './PrefabThumbnail.js';
import { STUDIO_COLORS } from './studio-style-helpers.js';

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
  const color = CATEGORY_COLOR_MAP[definition.category] ?? STUDIO_COLORS.textSecondary;

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onSelect}
      aria-label={`Place ${definition.name} (${definition.gridSize[0]}x${definition.gridSize[1]})`}
      title={`${definition.name} (${definition.gridSize[0]}x${definition.gridSize[1]})`}
      className={cn(
        'h-auto flex-col gap-0.5 rounded-md border px-1 py-2',
        isActive
          ? 'border-border-focus bg-accent-muted'
          : 'border-border-subtle bg-surface-muted hover:bg-surface-hover',
      )}
    >
      <PrefabThumbnail
        prefabId={definition.prefabId}
        size={32}
        color={isActive ? STUDIO_COLORS.accentText : color}
      />
      <span
        className={cn(
          'line-clamp-2 w-full break-words text-center text-caption font-medium leading-tight',
          isActive ? 'text-accent-text' : 'text-text-muted',
        )}
      >
        {definition.name}
      </span>
    </Button>
  );
}
