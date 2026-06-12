import { useUiState } from '@/app/ui-state.js';
import {
  useCreatePrefabInstance,
  useCreateZone,
  useDeletePrefabInstance,
  useDeleteZone,
  useOfficeLayout,
  useUpdatePrefabInstance,
  useUpdateZone,
} from '@/data/queries.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { safeErrorMessage } from '@/lib/provider-bridge.js';
import { clampPrefabCenter } from '@/surfaces/office/scene/scene-ground.js';
import {
  type PrefabInstanceRow,
  type SemanticCategory,
  findOverlaps,
  findZonePreset,
} from '@offisim/shared-types';
import { ChevronRight, Info, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { PrefabBrowser } from './PrefabBrowser.js';
import { SceneTreePanel } from './SceneTreePanel.js';
import { type ZonePatch, StudioInspector } from './StudioInspector.js';
import {
  type StudioObjectMove,
  type StudioPlacementCommit,
  StudioScene3D,
  type StudioZoneDrag,
} from './StudioScene3D.js';
import { useStudioStore } from './studio-store.js';

/** Unity/Godot-style office editor: Scene hierarchy (left) · viewport with a
 *  UE-style prefab content browser under it (center) · inspector (right).
 *  Overview level edits zones as whole units; focusing a zone edits its
 *  furniture with the catalog filtered to that zone's allowed categories. */
export function StudioSurface() {
  const companyId = useUiState((s) => s.companyId);
  const layout = useOfficeLayout(companyId);
  const createZone = useCreateZone();
  const updateZone = useUpdateZone();
  const deleteZone = useDeleteZone();
  const createPrefab = useCreatePrefabInstance();
  const updatePrefab = useUpdatePrefabInstance();
  const deletePrefab = useDeletePrefabInstance();

  const focusZoneId = useStudioStore((s) => s.focusZoneId);
  const selection = useStudioStore((s) => s.selection);
  const placement = useStudioStore((s) => s.placement);
  const setFocusZone = useStudioStore((s) => s.setFocusZone);
  const select = useStudioStore((s) => s.select);
  const rotatePlacement = useStudioStore((s) => s.rotatePlacement);
  const endPlacement = useStudioStore((s) => s.endPlacement);

  const zones = useMemo(() => layout.data?.zones ?? [], [layout.data?.zones]);
  const prefabs = useMemo(() => layout.data?.prefabs ?? [], [layout.data?.prefabs]);
  const zoneRects = useMemo(
    () =>
      zones.map((candidate) => ({
        id: candidate.zone_id,
        label: candidate.label,
        cx: candidate.cx,
        cz: candidate.cz,
        w: candidate.w,
        d: candidate.d,
      })),
    [zones],
  );
  const editable = Boolean(layout.data);
  const busy =
    createZone.isPending ||
    updateZone.isPending ||
    deleteZone.isPending ||
    createPrefab.isPending ||
    updatePrefab.isPending ||
    deletePrefab.isPending;

  const focusedZone = zones.find((zone) => zone.zone_id === focusZoneId) ?? null;

  // Drop stale state when the underlying rows disappear (deletes, company swap).
  useEffect(() => {
    if (focusZoneId && !zones.some((zone) => zone.zone_id === focusZoneId)) {
      setFocusZone(null);
    }
  }, [focusZoneId, zones, setFocusZone]);
  useEffect(() => {
    if (!selection) return;
    const alive =
      selection.kind === 'zone'
        ? zones.some((zone) => zone.zone_id === selection.id)
        : prefabs.some((vm) => vm.instance.instance_id === selection.id);
    if (!alive) select(null);
  }, [selection, zones, prefabs, select]);

  /** The focused zone's allowed furniture categories from the stored row JSON;
   *  null (missing/invalid/empty) means the full catalog. */
  const allowedCategories = useMemo<readonly SemanticCategory[] | null>(() => {
    if (!focusedZone) return null;
    if (focusedZone.allowed_categories_json) {
      try {
        const parsed = JSON.parse(focusedZone.allowed_categories_json);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as SemanticCategory[];
      } catch {
        // Fall through to the preset-derived set.
      }
    }
    return null;
  }, [focusedZone]);

  // ── Mutations ────────────────────────────────────────────────────

  async function commitPlacement(point: StudioPlacementCommit) {
    if (!placement || !layout.data) return;
    try {
      if (placement.kind === 'prefab') {
        if (!focusedZone) return;
        const result = await createPrefab.mutateAsync({
          zoneId: focusedZone.zone_id,
          prefabId: placement.prefabId,
          x: point.x,
          z: point.z,
          rotation: placement.rotation,
        });
        if (result.persisted && result.instanceId) {
          select({ kind: 'object', id: result.instanceId });
        }
        return;
      }
      const preset = findZonePreset(placement.presetId);
      if (!preset) return;
      const sortOrder = Math.max(0, ...zones.map((zone) => zone.sort_order)) + 1;
      const label = placement.blank ? `${preset.label} (blank)` : preset.label;
      const result = await createZone.mutateAsync({
        label,
        archetype: preset.archetype,
        accentColor: preset.accentColor,
        floorColor: preset.floorColor,
        cx: point.x,
        cz: point.z,
        w: preset.w,
        d: preset.d,
        deskSlots: preset.deskSlots,
        sortOrder,
        allowedCategories: preset.allowedCategories,
        activityTypes: preset.activityTypes,
      });
      if (result.persisted && result.zoneId) {
        if (!placement.blank) {
          await Promise.all(
            preset.prefabs.map((p) =>
              createPrefab.mutateAsync({
                zoneId: result.zoneId as string,
                prefabId: p.prefabId,
                x: point.x + p.offsetX,
                z: point.z + p.offsetZ,
                rotation: p.rotation ?? 0,
              }),
            ),
          );
        }
        select({ kind: 'zone', id: result.zoneId });
        toast.success('Zone added', { description: label });
      }
    } catch (error) {
      toast.error('Placement failed', { description: safeErrorMessage(error) });
    }
  }

  async function moveObject(move: StudioObjectMove) {
    try {
      const result = await updatePrefab.mutateAsync({
        instanceId: move.instanceId,
        fields: { zone_id: move.zoneId, position_x: move.x, position_y: move.z },
      });
      if (result.persisted) select({ kind: 'object', id: move.instanceId });
    } catch (error) {
      toast.error('Object move failed', { description: safeErrorMessage(error) });
    }
  }

  /** Whole-zone translation: the rug and every object inside move together. */
  async function shiftZone(zoneId: string, dx: number, dz: number) {
    const zone = zones.find((candidate) => candidate.zone_id === zoneId);
    if (!zone || (dx === 0 && dz === 0)) return;
    const nextCx = Math.round((zone.cx + dx) * 2) / 2;
    const nextCz = Math.round((zone.cz + dz) * 2) / 2;
    const overlaps = findOverlaps(
      { id: zone.zone_id, cx: nextCx, cz: nextCz, w: zone.w, d: zone.d },
      zoneRects,
    );
    if (overlaps.length > 0) {
      toast.error('Zone move blocked', {
        description: `Overlaps ${overlaps.map((other) => other.label ?? other.id).join(', ')}`,
      });
      return;
    }
    const realDx = nextCx - zone.cx;
    const realDz = nextCz - zone.cz;
    try {
      const zonePrefabs = prefabs.filter((vm) => vm.instance.zone_id === zoneId);
      // Independent row writes — run the zone update and object translations together.
      const [result] = await Promise.all([
        updateZone.mutateAsync({ zoneId, fields: { cx: nextCx, cz: nextCz } }),
        ...zonePrefabs.map((vm) =>
          updatePrefab.mutateAsync({
            instanceId: vm.instance.instance_id,
            fields: {
              position_x: vm.instance.position_x + realDx,
              position_y: vm.instance.position_y + realDz,
            },
          }),
        ),
      ]);
      if (result.persisted) select({ kind: 'zone', id: zoneId });
    } catch (error) {
      toast.error('Zone move failed', { description: safeErrorMessage(error) });
    }
  }

  async function patchZone(zoneId: string, patch: ZonePatch) {
    const overlapMessage = zoneGeometryOverlapMessage(zoneId, patch);
    if (overlapMessage) {
      toast.error('Zone update blocked', { description: overlapMessage });
      return;
    }
    try {
      const result = await updateZone.mutateAsync({ zoneId, fields: { ...patch } });
      if (result.persisted && patch.label) {
        toast.success('Zone renamed', { description: patch.label });
      }
    } catch (error) {
      toast.error('Zone update failed', { description: safeErrorMessage(error) });
    }
  }

  function zoneGeometryOverlapMessage(zoneId: string, patch: ZonePatch): string | null {
    if (
      patch.cx === undefined &&
      patch.cz === undefined &&
      patch.w === undefined &&
      patch.d === undefined
    ) {
      return null;
    }
    const zone = zones.find((candidate) => candidate.zone_id === zoneId);
    if (!zone) return null;
    const overlaps = findOverlaps(
      {
        id: zone.zone_id,
        cx: patch.cx ?? zone.cx,
        cz: patch.cz ?? zone.cz,
        w: patch.w ?? zone.w,
        d: patch.d ?? zone.d,
      },
      zoneRects,
    );
    if (overlaps.length === 0) return null;
    return `Overlaps ${overlaps.map((other) => other.label ?? other.id).join(', ')}`;
  }

  async function removeZone(zoneId: string) {
    const zone = zones.find((candidate) => candidate.zone_id === zoneId);
    try {
      const result = await deleteZone.mutateAsync({ zoneId });
      if (result.persisted) {
        if (focusZoneId === zoneId) setFocusZone(null);
        select(null);
        toast.success('Zone deleted', {
          description:
            result.deletedObjects > 0
              ? `${result.deletedObjects} objects removed`
              : (zone?.label ?? zoneId),
        });
      }
    } catch (error) {
      toast.error('Zone deletion failed', { description: safeErrorMessage(error) });
    }
  }

  /** Rotation never rejects: if the rotated bounds poke out of the zone, the
   *  object slides back inside (clamp). */
  async function rotateObject(instanceId: string) {
    const vm = prefabs.find((candidate) => candidate.instance.instance_id === instanceId);
    const zone = zones.find((candidate) => candidate.zone_id === vm?.instance.zone_id);
    if (!vm || !zone) return;
    const nextRotation = ((vm.instance.rotation + 90) % 360) as PrefabInstanceRow['rotation'];
    const clamped = clampPrefabCenter(
      vm.instance.position_x,
      vm.instance.position_y,
      { prefabId: vm.definition.prefabId, rotation: nextRotation, gridSize: vm.definition.gridSize },
      zone,
    );
    try {
      await updatePrefab.mutateAsync({
        instanceId,
        fields: { rotation: nextRotation, position_x: clamped.x, position_y: clamped.z },
      });
    } catch (error) {
      toast.error('Object rotation failed', { description: safeErrorMessage(error) });
    }
  }

  async function removeObject(instanceId: string) {
    const vm = prefabs.find((candidate) => candidate.instance.instance_id === instanceId);
    try {
      const result = await deletePrefab.mutateAsync({ instanceId });
      if (result.persisted) {
        select(null);
        toast.success('Object deleted', { description: vm?.definition.name });
      }
    } catch (error) {
      toast.error('Object deletion failed', { description: safeErrorMessage(error) });
    }
  }

  // ── Editor keys: W select, E/R rotate (ghost first, then selection),
  //    F focus, 1-7 jump-focus zones, Esc steps back, Delete removes. ──
  // biome-ignore lint/correctness/useExhaustiveDependencies: registers against the latest render closure on purpose
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const zoneDigit = /^Digit([1-7])$/.exec(event.code)?.[1];
      if (zoneDigit) {
        const ordered = [...zones].sort((a, b) => a.sort_order - b.sort_order);
        const zone = ordered[Number(zoneDigit) - 1];
        if (zone) {
          event.preventDefault();
          setFocusZone(focusZoneId === zone.zone_id ? null : zone.zone_id);
        }
        return;
      }
      switch (event.code) {
        case 'KeyW':
          endPlacement();
          break;
        case 'KeyE':
        case 'KeyR':
          event.preventDefault();
          if (placement?.kind === 'prefab') {
            rotatePlacement();
          } else if (selection?.kind === 'object' && !busy) {
            void rotateObject(selection.id);
          }
          break;
        case 'KeyF':
          if (selection?.kind === 'zone') {
            event.preventDefault();
            setFocusZone(selection.id);
          }
          break;
        case 'Escape':
          if (placement) {
            endPlacement();
          } else if (focusZoneId) {
            setFocusZone(null);
          } else {
            select(null);
          }
          break;
        case 'Delete':
        case 'Backspace':
          if (selection?.kind === 'object' && !busy) {
            event.preventDefault();
            void removeObject(selection.id);
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div className="off-studio">
      <aside className="off-studio-panel is-left">
        <SceneTreePanel zones={zones} prefabs={prefabs} onEnterFocus={setFocusZone} />
      </aside>

      <section className="off-studio-stage">
        {layout.isError ? (
          <div className="off-studio-banner is-error" role="alert">
            <Icon icon={Info} size="sm" />
            Couldn't load the office layout.
            <button
              type="button"
              className="off-studio-banner-retry off-focusable"
              onClick={() => void layout.refetch()}
            >
              Retry
            </button>
          </div>
        ) : !layout.isLoading && !layout.data ? (
          <div className="off-studio-banner">
            <Icon icon={Info} size="sm" />
            Preview scene — Studio editing needs the desktop app, so changes here won't be saved.
          </div>
        ) : null}

        <div className="off-studio-toolbar">
          <nav className="off-studio-crumb" aria-label="Edit level">
            <button
              type="button"
              className="off-studio-crumb-seg off-focusable"
              onClick={() => setFocusZone(null)}
              disabled={!focusZoneId}
            >
              Plot
            </button>
            {focusedZone ? (
              <>
                <Icon icon={ChevronRight} size="sm" className="off-studio-crumb-sep" />
                <span className="off-studio-crumb-seg is-current">{focusedZone.label}</span>
              </>
            ) : null}
          </nav>
          <span className="off-studio-toolbar-hint">
            {placement
              ? placement.kind === 'prefab'
                ? 'Click to place · R rotate · right-click / Esc stop'
                : 'Click open floor to add the zone · right-click / Esc cancel'
              : focusedZone
                ? 'Drag objects to move · E/R rotate · Delete remove · Esc back to plot'
                : 'Click a zone to select · drag to move it · double-click / F to edit inside'}
          </span>
          {focusedZone ? (
            <Button variant="outline" size="sm" onClick={() => setFocusZone(null)}>
              <Icon icon={X} size="sm" />
              Exit zone edit
            </Button>
          ) : null}
        </div>

        <div className="off-studio-canvas-host">
          <StudioScene3D
            layout={layout.data ?? null}
            prefabs={prefabs}
            editable={editable && !busy}
            onCommitPlacement={(point) => void commitPlacement(point)}
            onMoveObject={(move) => void moveObject(move)}
            onMoveZone={(move: StudioZoneDrag) => void shiftZone(move.zoneId, move.dx, move.dz)}
            onEnterFocus={setFocusZone}
          />
        </div>

        <PrefabBrowser
          focusActive={Boolean(focusedZone)}
          allowedCategories={allowedCategories}
          disabled={!editable || busy}
        />
      </section>

      <aside className="off-studio-panel is-right">
        <StudioInspector
          zones={zones}
          prefabs={prefabs}
          busy={busy}
          onZonePatch={(zoneId, patch) => void patchZone(zoneId, patch)}
          onZoneShift={(zoneId, dx, dz) => void shiftZone(zoneId, dx, dz)}
          onZoneDelete={(zoneId) => void removeZone(zoneId)}
          onEnterFocus={setFocusZone}
          onExitFocus={() => setFocusZone(null)}
          onObjectRotate={(instanceId) => void rotateObject(instanceId)}
          onObjectDelete={(instanceId) => void removeObject(instanceId)}
        />
      </aside>
    </div>
  );
}
