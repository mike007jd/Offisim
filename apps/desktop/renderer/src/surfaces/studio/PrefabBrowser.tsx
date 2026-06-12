import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { getAllBuiltinPrefabs } from '@offisim/renderer';
import {
  type SemanticCategory,
  ZONE_PRESET_GROUPS,
  type ZonePreset,
} from '@offisim/shared-types';
import {
  Box,
  BookOpen,
  Cpu,
  type LucideIcon,
  PanelTop,
  Sprout,
  Users,
  Wrench,
} from 'lucide-react';
import { Fragment, type PointerEvent as ReactPointerEvent, useMemo, useRef } from 'react';
import { type StudioPlacement, useStudioStore } from './studio-store.js';
import { ZONE_ARCHETYPE_ICON } from './zone-archetype-icons.js';

const CATEGORY_META: Record<SemanticCategory, { label: string; icon: LucideIcon }> = {
  workspace: { label: 'Workspace', icon: PanelTop },
  compute: { label: 'Compute', icon: Cpu },
  knowledge: { label: 'Knowledge', icon: BookOpen },
  collaboration: { label: 'Collaboration', icon: Users },
  infrastructure: { label: 'Infrastructure', icon: Wrench },
  decorative: { label: 'Decorative', icon: Sprout },
};

const DRAG_THRESHOLD_PX = 6;

/** Card gesture: a real drag (past threshold) starts a drag-mode placement
 *  whose ghost rides the cursor into the viewport; a plain click toggles
 *  click-to-place mode (repeat placement until Esc / right-click). */
function usePlacementGesture() {
  const placement = useStudioStore((s) => s.placement);
  const startPlacement = useStudioStore((s) => s.startPlacement);
  const endPlacement = useStudioStore((s) => s.endPlacement);
  const suppressClickRef = useRef(false);

  const onCardPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    make: (mode: 'drag' | 'click') => StudioPlacement,
  ) => {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    const onMove = (e: PointerEvent) => {
      if (dragging) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_THRESHOLD_PX) {
        dragging = true;
        suppressClickRef.current = true;
        startPlacement(make('drag'));
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // Late: the scene's pointerup handler commits drag placements.
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onCardClick = (key: string, make: (mode: 'drag' | 'click') => StudioPlacement) => {
    if (suppressClickRef.current) return;
    if (placementKey(placement) === key) {
      endPlacement();
    } else {
      startPlacement(make('click'));
    }
  };

  return { placement, onCardPointerDown, onCardClick };
}

function placementKey(placement: StudioPlacement | null): string | null {
  if (!placement) return null;
  return placement.kind === 'prefab'
    ? `prefab:${placement.prefabId}`
    : `preset:${placement.presetId}:${placement.blank}`;
}

function PlacementCard({
  make,
  icon,
  name,
  meta,
  title,
  blank = false,
  disabled,
  gesture,
}: {
  make: (mode: 'drag' | 'click') => StudioPlacement;
  icon: LucideIcon;
  name: string;
  meta: string;
  title: string;
  blank?: boolean;
  disabled: boolean;
  gesture: ReturnType<typeof usePlacementGesture>;
}) {
  const key = placementKey(make('click'));
  return (
    <button
      type="button"
      className={cn(
        'off-studio-card off-focusable',
        blank && 'is-blank',
        placementKey(gesture.placement) === key && 'is-on',
      )}
      disabled={disabled}
      title={title}
      onPointerDown={(e) => gesture.onCardPointerDown(e, make)}
      onClick={() => key && gesture.onCardClick(key, make)}
    >
      <span className="off-studio-card-art">
        <Icon icon={icon} size="md" />
      </span>
      <span className="off-studio-card-name">{name}</span>
      <span className="off-studio-card-meta">{meta}</span>
    </button>
  );
}

/** Overview shelf: zone presets (furnished templates) + a blank shell per group. */
function ZonePresetShelf({ disabled }: { disabled: boolean }) {
  const gesture = usePlacementGesture();
  const presetPlacement =
    (presetId: string, blank: boolean) =>
    (mode: 'drag' | 'click'): StudioPlacement => ({
      kind: 'zone-preset',
      presetId,
      blank,
      mode,
    });
  return (
    <div className="off-studio-browser-track">
      {ZONE_PRESET_GROUPS.map((group) => {
        const blankPreset = group.presets[0];
        return (
          <Fragment key={group.archetype}>
            <span className="off-studio-browser-group">
              <Icon icon={ZONE_ARCHETYPE_ICON[group.archetype]} size="sm" />
              {group.label}
            </span>
            {group.presets.map((preset: ZonePreset) => (
              <PlacementCard
                key={preset.id}
                make={presetPlacement(preset.id, false)}
                icon={ZONE_ARCHETYPE_ICON[preset.archetype]}
                name={preset.label}
                meta={`${preset.w}×${preset.d} · ${preset.prefabs.length} obj`}
                title={`${preset.description} · ${preset.w}×${preset.d} · ${preset.prefabs.length} objects`}
                disabled={disabled}
                gesture={gesture}
              />
            ))}
            {blankPreset ? (
              <PlacementCard
                make={presetPlacement(blankPreset.id, true)}
                icon={Box}
                name="Blank"
                meta={`${blankPreset.w}×${blankPreset.d}`}
                title={`Empty ${group.label.toLowerCase()} shell — furnish it yourself`}
                blank
                disabled={disabled}
                gesture={gesture}
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

/** Focus shelf: the furniture catalog for the focused zone, grouped by
 *  semantic category and filtered to the zone's allowed categories. */
function FurnitureShelf({
  allowedCategories,
  disabled,
}: {
  allowedCategories: readonly SemanticCategory[] | null;
  disabled: boolean;
}) {
  const gesture = usePlacementGesture();
  const groups = useMemo(() => {
    const all = getAllBuiltinPrefabs();
    const allowed = allowedCategories?.length
      ? all.filter((prefab) => allowedCategories.includes(prefab.category))
      : all;
    const byCategory = new Map<SemanticCategory, typeof allowed>();
    for (const prefab of allowed) {
      const bucket = byCategory.get(prefab.category) ?? [];
      bucket.push(prefab);
      byCategory.set(prefab.category, bucket);
    }
    return [...byCategory.entries()];
  }, [allowedCategories]);

  return (
    <div className="off-studio-browser-track">
      {groups.map(([category, prefabs]) => (
        <Fragment key={category}>
          <span className="off-studio-browser-group">
            <Icon icon={CATEGORY_META[category].icon} size="sm" />
            {CATEGORY_META[category].label}
          </span>
          {prefabs.map((prefab) => (
            <PlacementCard
              key={prefab.prefabId}
              make={(mode) => ({ kind: 'prefab', prefabId: prefab.prefabId, rotation: 0, mode })}
              icon={CATEGORY_META[prefab.category].icon}
              name={prefab.name}
              meta={`${prefab.gridSize[0]}×${prefab.gridSize[1]}`}
              title={`${prefab.description} · ${prefab.gridSize[0]}×${prefab.gridSize[1]}`}
              disabled={disabled}
              gesture={gesture}
            />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

export function PrefabBrowser({
  focusActive,
  allowedCategories,
  disabled,
}: {
  focusActive: boolean;
  allowedCategories: readonly SemanticCategory[] | null;
  disabled: boolean;
}) {
  return (
    <section className="off-studio-browser" aria-label="Prefabs">
      <header className="off-studio-browser-head">
        <CapsLabel>{focusActive ? 'Prefabs · Furniture' : 'Prefabs · Zone templates'}</CapsLabel>
        <span className="off-studio-browser-hint">
          {focusActive
            ? 'Drag into the zone, or click then place repeatedly · R rotate · right-click stop'
            : 'Drag onto open floor to add a zone'}
        </span>
      </header>
      {focusActive ? (
        <FurnitureShelf allowedCategories={allowedCategories} disabled={disabled} />
      ) : (
        <ZonePresetShelf disabled={disabled} />
      )}
    </section>
  );
}
