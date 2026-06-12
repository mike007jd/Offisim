import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import type { ZoneRow } from '@offisim/shared-types';
import { ChevronDown, ChevronRight, Focus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { StudioPrefabVM } from './StudioScene3D.js';
import { useStudioStore } from './studio-store.js';
import { zoneArchetypeIcon } from './zone-archetype-icons.js';

/** Unity/Godot-style hierarchy: zones are expandable nodes, placed objects are
 *  their children. Selection is two-way with the 3D viewport. */
export function SceneTreePanel({
  zones,
  prefabs,
  onEnterFocus,
}: {
  zones: readonly ZoneRow[];
  prefabs: readonly StudioPrefabVM[];
  onEnterFocus: (zoneId: string | null) => void;
}) {
  const selection = useStudioStore((s) => s.selection);
  const focusZoneId = useStudioStore((s) => s.focusZoneId);
  const select = useStudioStore((s) => s.select);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const prefabsByZone = useMemo(() => {
    const map = new Map<string, StudioPrefabVM[]>();
    for (const vm of prefabs) {
      const bucket = map.get(vm.instance.zone_id) ?? [];
      bucket.push(vm);
      map.set(vm.instance.zone_id, bucket);
    }
    return map;
  }, [prefabs]);

  // The focused zone (and the zone of a selected object) always reveals its children.
  useEffect(() => {
    const reveal =
      focusZoneId ??
      (selection?.kind === 'object'
        ? prefabs.find((vm) => vm.instance.instance_id === selection.id)?.instance.zone_id
        : undefined);
    if (!reveal) return;
    setExpanded((prev) => {
      if (prev.has(reveal)) return prev;
      const next = new Set(prev);
      next.add(reveal);
      return next;
    });
  }, [focusZoneId, selection, prefabs]);

  const toggle = (zoneId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(zoneId)) {
        next.delete(zoneId);
      } else {
        next.add(zoneId);
      }
      return next;
    });

  const ordered = useMemo(() => [...zones].sort((a, b) => a.sort_order - b.sort_order), [zones]);

  return (
    <div className="off-studio-tree" role="tree" aria-label="Scene objects">
      <div className="off-studio-panel-head">
        <CapsLabel>Scene</CapsLabel>
        <span className="off-studio-tree-count">
          {zones.length} zones · {prefabs.length} objects
        </span>
      </div>
      <div className="off-studio-tree-body">
        {ordered.map((zone) => {
          const children = prefabsByZone.get(zone.zone_id) ?? [];
          const open = expanded.has(zone.zone_id);
          const zoneSelected = selection?.kind === 'zone' && selection.id === zone.zone_id;
          return (
            <div key={zone.zone_id} className="off-studio-tree-zone">
              <div
                className={cn(
                  'off-studio-tree-row is-zone',
                  zoneSelected && 'is-sel',
                  focusZoneId === zone.zone_id && 'is-focus',
                )}
              >
                <IconButton
                  icon={open ? ChevronDown : ChevronRight}
                  label={open ? 'Collapse zone' : 'Expand zone'}
                  size="iconSm"
                  variant="ghost"
                  onClick={() => toggle(zone.zone_id)}
                />
                <button
                  type="button"
                  className="off-studio-tree-label off-focusable"
                  onClick={() => select({ kind: 'zone', id: zone.zone_id })}
                  onDoubleClick={() => onEnterFocus(zone.zone_id)}
                  title="Click to select · double-click to edit this zone"
                >
                  <Icon icon={zoneArchetypeIcon(zone.archetype)} size="sm" />
                  <span className="off-studio-tree-name">{zone.label}</span>
                  <span className="off-studio-tree-meta">{children.length}</span>
                </button>
                <IconButton
                  icon={Focus}
                  label={`Edit ${zone.label}`}
                  size="iconSm"
                  variant={focusZoneId === zone.zone_id ? 'accentSoft' : 'ghost'}
                  onClick={() => onEnterFocus(zone.zone_id)}
                />
              </div>
              {open
                ? children.map((vm) => {
                    const objectSelected =
                      selection?.kind === 'object' && selection.id === vm.instance.instance_id;
                    return (
                      <button
                        key={vm.instance.instance_id}
                        type="button"
                        className={cn(
                          'off-studio-tree-row is-object off-focusable',
                          objectSelected && 'is-sel',
                        )}
                        onClick={() => select({ kind: 'object', id: vm.instance.instance_id })}
                        onDoubleClick={() => onEnterFocus(zone.zone_id)}
                      >
                        <span className="off-studio-tree-name">{vm.definition.name}</span>
                        <span className="off-studio-tree-meta">
                          {vm.instance.position_x.toFixed(1)}, {vm.instance.position_y.toFixed(1)}
                        </span>
                      </button>
                    );
                  })
                : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
