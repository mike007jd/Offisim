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
        'h-auto flex-col gap-sp-1 rounded-r-md border px-sp-1 py-sp-2',
        isActive
          ? 'border-focus bg-accent-surface'
          : 'border-line-soft bg-surface-2 hover:bg-surface-sunken',
      )}
    >
      <PrefabThumbnail
        prefabId={definition.prefabId}
        size={32}
        color={isActive ? STUDIO_COLORS.accentText : color}
      />
      <span
        className={cn(
          'line-clamp-2 w-full break-words text-center text-fs-micro font-medium leading-tight',
          isActive ? 'text-accent' : 'text-ink-3',
        )}
      >
        {definition.name}
      </span>
    </Button>
  );
}
