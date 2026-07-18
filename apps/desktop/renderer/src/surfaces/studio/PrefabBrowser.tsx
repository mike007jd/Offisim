import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { cn } from '@/lib/utils.js';
import { getAllBuiltinPrefabs } from '@offisim/prefab';
import { type SemanticCategory, ZONE_PRESET_GROUPS, type ZonePreset } from '@offisim/shared-types';
import {
  BookOpen,
  Box,
  ChevronLeft,
  ChevronRight,
  Cpu,
  type LucideIcon,
  PanelTop,
  Sprout,
  Users,
  Wrench,
} from 'lucide-react';
import {
  Fragment,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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

function BrowserTrack({ children, label }: { children: ReactNode; label: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const track = trackRef.current;
    const content = contentRef.current;
    if (!track || !content) return;
    const sync = () => {
      const max = Math.max(0, track.scrollWidth - track.clientWidth);
      const next = { left: track.scrollLeft > 2, right: track.scrollLeft < max - 2 };
      setEdges((previous) =>
        previous.left === next.left && previous.right === next.right ? previous : next,
      );
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(track);
    observer.observe(content);
    track.addEventListener('scroll', sync, { passive: true });
    return () => {
      observer.disconnect();
      track.removeEventListener('scroll', sync);
    };
  }, []);

  const scroll = (direction: -1 | 1) => {
    trackRef.current?.scrollBy({ left: direction * 320, behavior: 'smooth' });
  };

  return (
    <div className="off-studio-browser-scroll-shell">
      <Button
        variant="ghost"
        size="iconSm"
        className="off-studio-browser-scroll-button"
        onClick={() => scroll(-1)}
        disabled={!edges.left}
        aria-label={`Show earlier ${label}`}
      >
        <Icon icon={ChevronLeft} size="sm" />
      </Button>
      <section ref={trackRef} className="off-studio-browser-track" aria-label={label}>
        <div ref={contentRef} className="off-studio-browser-track-content">
          {children}
        </div>
      </section>
      <Button
        variant="ghost"
        size="iconSm"
        className="off-studio-browser-scroll-button"
        onClick={() => scroll(1)}
        disabled={!edges.right}
        aria-label={`Show more ${label}`}
      >
        <Icon icon={ChevronRight} size="sm" />
      </Button>
    </div>
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
    <BrowserTrack label="Room templates">
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
                meta={`${preset.w}×${preset.d} · ${preset.prefabs.length} items`}
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
    </BrowserTrack>
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
    <BrowserTrack label="Furniture and office items">
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
    </BrowserTrack>
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
    <section className="off-studio-browser" aria-label="Add to office">
      <header className="off-studio-browser-head">
        <CapsLabel>{focusActive ? 'Furniture and items' : 'Room templates'}</CapsLabel>
        <span className="off-studio-browser-hint">
          {focusActive
            ? 'Drag into the room, or choose an item and place it on the canvas'
            : 'Drag a template onto open floor to add a room'}
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
