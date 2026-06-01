import { useUiState } from '@/app/ui-state.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import {
  useCreatePrefabInstance,
  useCreateZone,
  useDeletePrefabInstance,
  useDeleteZone,
  useOfficeLayout,
  useOfficeScene,
  useUpdatePrefabInstance,
  useUpdateZone,
} from '@/data/queries.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { SegmentedControl } from '@/design-system/grammar/SegmentedControl.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { safeErrorMessage } from '@/lib/provider-bridge.js';
import { cn } from '@/lib/utils.js';
import {
  OfficeScene3D,
  type ScenePlacementPoint,
  type ScenePlacementProbe,
  type ScenePrefabMove,
} from '@/surfaces/office/scene/OfficeScene3D.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import { type ZoneArchetype, findOverlaps } from '@offisim/shared-types';
import {
  Armchair,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Info,
  LayoutGrid,
  Move3d,
  PanelTop,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Sofa,
  Sprout,
  Trash2,
} from 'lucide-react';
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';

const PALETTE = [
  { id: 'desk', label: 'Desk cluster', icon: PanelTop, prefabId: 'workstation-standard' },
  { id: 'seating', label: 'Seating', icon: Armchair, prefabId: 'chair-standalone' },
  { id: 'lounge', label: 'Lounge', icon: Sofa, prefabId: 'sofa-set' },
  { id: 'plant', label: 'Plant', icon: Sprout, prefabId: 'plant-small' },
  { id: 'prop', label: 'Whiteboard', icon: Box, prefabId: 'whiteboard' },
];
const PALETTE_DRAG_THRESHOLD_PX = 6;
const PALETTE_DRAG_SETTLE_MS = 160;

type PaletteItem = (typeof PALETTE)[number];

interface PaletteDragState {
  itemId: string;
  label: string;
  clientX: number;
  clientY: number;
  active: boolean;
  commitId: string | null;
}

const ZONE_KIND_LABEL: Record<string, string> = {
  workspace: 'Workspace',
  meeting: 'Meeting',
  server: 'Server',
  library: 'Library',
  rest: 'Rest',
  lounge: 'Lounge',
};

const EDITABLE_ZONE_ARCHETYPES: ReadonlySet<ZoneArchetype> = new Set([
  'workspace',
  'meeting',
  'server',
  'library',
  'rest',
]);

function colorHexToNumber(color: string): number {
  return Number.parseInt(color.replace('#', ''), 16);
}

const DEFAULT_ZONE_FLOOR = colorHexToNumber(UI_DATA_COLORS.ink4);

interface StudioZone {
  id: string;
  label: string;
  kind: ZoneArchetype;
  cx: number;
  cz: number;
  w: number;
  d: number;
  accentColor: string;
  floorColor: number;
  deskSlots: number;
  sortOrder: number;
  prefabCount: number;
}

interface StudioZoneDraft {
  label: string;
  cx: number;
  cz: number;
  w: number;
  d: number;
}

function toStudioZoneKind(kind: string | null | undefined): ZoneArchetype {
  if (kind === 'meeting' || kind === 'server' || kind === 'library' || kind === 'rest') {
    return kind;
  }
  if (kind === 'lounge') return 'rest';
  return 'workspace';
}

function zoneDraftFrom(zone: StudioZone): StudioZoneDraft {
  return {
    label: zone.label,
    cx: zone.cx,
    cz: zone.cz,
    w: zone.w,
    d: zone.d,
  };
}

function zoneDraftDirty(zone: StudioZone, draft: StudioZoneDraft | null): boolean {
  if (!draft) return false;
  return (
    draft.label.trim() !== zone.label ||
    draft.cx !== zone.cx ||
    draft.cz !== zone.cz ||
    draft.w !== zone.w ||
    draft.d !== zone.d
  );
}

function setDraftNumber(
  draft: StudioZoneDraft | null,
  key: 'cx' | 'cz' | 'w' | 'd',
  value: string,
): StudioZoneDraft | null {
  if (!draft) return draft;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return draft;
  return { ...draft, [key]: parsed };
}

export function StudioSurface() {
  const zoneLabelInputId = useId();
  const zoneXInputId = useId();
  const zoneZInputId = useId();
  const zoneWidthInputId = useId();
  const zoneDepthInputId = useId();
  const companyId = useUiState((s) => s.companyId);
  const fallbackScene = useOfficeScene();
  const layout = useOfficeLayout(companyId);
  const createZone = useCreateZone();
  const updateZone = useUpdateZone();
  const deleteZone = useDeleteZone();
  const createPrefab = useCreatePrefabInstance();
  const updatePrefab = useUpdatePrefabInstance();
  const deletePrefab = useDeletePrefabInstance();
  const [tool, setTool] = useState<'select' | 'place'>('select');
  const [placing, setPlacing] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedPrefabId, setSelectedPrefabId] = useState<string | null>(null);
  const [zoneDraft, setZoneDraft] = useState<StudioZoneDraft | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [objectDeleteArmed, setObjectDeleteArmed] = useState(false);
  const [paletteDrag, setPaletteDrag] = useState<PaletteDragState | null>(null);
  const suppressPaletteClickRef = useRef(false);
  const dragClearTimerRef = useRef<number | null>(null);

  const zones = useMemo<StudioZone[]>(() => {
    if (layout.data?.zones.length) {
      const prefabCounts = new Map<string, number>();
      for (const prefab of layout.data.prefabs) {
        const zoneId = prefab.instance.zone_id;
        prefabCounts.set(zoneId, (prefabCounts.get(zoneId) ?? 0) + 1);
      }
      return layout.data.zones.map((zone) => ({
        id: zone.zone_id,
        label: zone.label,
        kind: toStudioZoneKind(zone.archetype),
        cx: zone.cx,
        cz: zone.cz,
        w: zone.w,
        d: zone.d,
        accentColor: zone.accent_color,
        floorColor: zone.floor_color,
        deskSlots: zone.desk_slots,
        sortOrder: zone.sort_order,
        prefabCount: prefabCounts.get(zone.zone_id) ?? 0,
      }));
    }
    return (fallbackScene.data?.zones ?? []).map((zone) => ({
      ...zone,
      kind: toStudioZoneKind(zone.kind),
      accentColor: UI_DATA_COLORS.ink6,
      floorColor: DEFAULT_ZONE_FLOOR,
      deskSlots: 0,
      sortOrder: 0,
      prefabCount: 0,
    }));
  }, [fallbackScene.data?.zones, layout.data?.prefabs, layout.data?.zones]);
  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;
  const selectedPrefab =
    layout.data?.prefabs.find((prefab) => prefab.instance.instance_id === selectedPrefabId) ?? null;
  const selectedPrefabZone =
    zones.find((zone) => zone.id === selectedPrefab?.instance.zone_id) ?? null;
  const selectedZonePersisted = Boolean(
    layout.data?.zones.some((zone) => zone.zone_id === selectedZoneId),
  );
  const busy =
    createZone.isPending ||
    updateZone.isPending ||
    deleteZone.isPending ||
    createPrefab.isPending ||
    updatePrefab.isPending ||
    deletePrefab.isPending;
  const dirty = Boolean(selectedZone && zoneDraftDirty(selectedZone, zoneDraft));
  const validation = useMemo(() => {
    if (!selectedZone || !zoneDraft)
      return { errors: [] as string[], overlaps: [] as StudioZone[] };
    const errors: string[] = [];
    if (!zoneDraft.label.trim()) errors.push('Zone name is required');
    if (zoneDraft.w < 3 || zoneDraft.d < 3) errors.push('Footprint must be at least 3 x 3');
    if (zoneDraft.w > 30 || zoneDraft.d > 30) errors.push('Footprint must stay within 30 x 30');
    const overlaps = findOverlaps({ id: selectedZone.id, ...zoneDraft }, zones);
    if (overlaps.length > 0) {
      errors.push(`Overlaps ${overlaps.map((zone) => zone.label).join(', ')}`);
    }
    return { errors, overlaps };
  }, [selectedZone, zoneDraft, zones]);
  const canSaveDraft =
    Boolean(selectedZonePersisted && selectedZone && zoneDraft && dirty) &&
    validation.errors.length === 0 &&
    !busy;
  const placementProbe = useMemo<ScenePlacementProbe | null>(
    () =>
      paletteDrag
        ? {
            clientX: paletteDrag.clientX,
            clientY: paletteDrag.clientY,
            active: paletteDrag.active,
            commitId: paletteDrag.commitId,
          }
        : null,
    [paletteDrag],
  );
  const dragGhostItem = paletteDrag ? PALETTE.find((item) => item.id === paletteDrag.itemId) : null;
  const dragGhostStyle = paletteDrag
    ? ({
        '--off-drag-x': `${paletteDrag.clientX}px`,
        '--off-drag-y': `${paletteDrag.clientY}px`,
      } as CSSProperties)
    : undefined;

  useEffect(
    () => () => {
      if (dragClearTimerRef.current !== null) {
        window.clearTimeout(dragClearTimerRef.current);
      }
      document.body.style.cursor = '';
    },
    [],
  );

  useEffect(() => {
    setZoneDraft(selectedZone ? zoneDraftFrom(selectedZone) : null);
    setDeleteArmed(false);
  }, [selectedZone]);

  useEffect(() => {
    if (!selectedPrefabId || !layout.data) return;
    if (!layout.data.prefabs.some((prefab) => prefab.instance.instance_id === selectedPrefabId)) {
      setSelectedPrefabId(null);
    }
  }, [layout.data, selectedPrefabId]);

  function resetZoneDraft() {
    setZoneDraft(selectedZone ? zoneDraftFrom(selectedZone) : null);
  }

  function nextZoneArchetype(): StudioZone['kind'] {
    if (selectedZone && EDITABLE_ZONE_ARCHETYPES.has(selectedZone.kind)) return selectedZone.kind;
    return 'workspace';
  }

  async function createWorkspaceZone() {
    if (!companyId) {
      toast.error('Select a company first');
      return;
    }
    if (!layout.data) return;
    const base = selectedZone ?? zones.at(-1);
    const nextIndex = zones.length + 1;
    const candidate = {
      cx: (base?.cx ?? 0) + 4,
      cz: base?.cz ?? 0,
      w: base?.w ?? 8,
      d: base?.d ?? 6,
    };
    while (
      findOverlaps({ id: 'zone-new-candidate', ...candidate }, zones).length > 0 &&
      candidate.cx < 36
    ) {
      candidate.cx += 4;
      candidate.cz += 2;
    }
    try {
      const result = await createZone.mutateAsync({
        label: `Workspace ${nextIndex}`,
        archetype: nextZoneArchetype(),
        accentColor: base?.accentColor ?? UI_DATA_COLORS.ink6,
        floorColor: base?.floorColor ?? DEFAULT_ZONE_FLOOR,
        cx: candidate.cx,
        cz: candidate.cz,
        w: candidate.w,
        d: candidate.d,
        deskSlots: 0,
        sortOrder: Math.max(0, ...zones.map((zone) => zone.sortOrder)) + 1,
      });
      if (result.persisted && result.zoneId) {
        setSelectedZoneId(result.zoneId);
        toast.success('Zone created');
      }
    } catch (error) {
      toast.error('Zone creation failed', { description: safeErrorMessage(error) });
    }
  }

  async function deleteSelectedZone() {
    if (!selectedZone || !selectedZonePersisted) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    try {
      const result = await deleteZone.mutateAsync({ zoneId: selectedZone.id });
      setSelectedZoneId(null);
      setDeleteArmed(false);
      if (result.persisted) {
        toast.success('Zone deleted', {
          description:
            result.deletedObjects > 0
              ? `${result.deletedObjects} objects removed`
              : selectedZone.label,
        });
      }
    } catch (error) {
      toast.error('Zone deletion failed', { description: safeErrorMessage(error) });
    }
  }

  async function saveZoneDraft() {
    if (!selectedZone || !selectedZonePersisted || !zoneDraft) return;
    if (validation.errors.length > 0) {
      toast.error('Zone has invalid edits', { description: validation.errors[0] });
      return;
    }
    if (!dirty) return;
    try {
      const result = await updateZone.mutateAsync({
        zoneId: selectedZone.id,
        fields: {
          label: zoneDraft.label.trim(),
          cx: zoneDraft.cx,
          cz: zoneDraft.cz,
          w: zoneDraft.w,
          d: zoneDraft.d,
        },
      });
      if (result.persisted) {
        toast.success('Zone saved', { description: zoneDraft.label.trim() });
      }
    } catch (error) {
      toast.error('Zone save failed', { description: safeErrorMessage(error) });
    }
  }

  function moveZone(dx: number, dz: number) {
    if (!selectedZone || !selectedZonePersisted || !zoneDraft) return;
    setZoneDraft({ ...zoneDraft, cx: zoneDraft.cx + dx, cz: zoneDraft.cz + dz });
  }

  function resizeZone(dw: number, dd: number) {
    if (!selectedZone || !selectedZonePersisted || !zoneDraft) return;
    setZoneDraft({
      ...zoneDraft,
      w: Math.max(3, zoneDraft.w + dw),
      d: Math.max(3, zoneDraft.d + dd),
    });
  }

  async function addPrefab(
    item: PaletteItem,
    targetZone: StudioZone | null = selectedZone,
    point?: Pick<ScenePlacementPoint, 'x' | 'z'>,
  ) {
    if (!layout.data || !targetZone) return;
    const targetZonePersisted = layout.data.zones.some((zone) => zone.zone_id === targetZone.id);
    if (!targetZonePersisted) {
      toast.error('Pick a persisted zone footprint');
      return;
    }
    try {
      const spread = point ? 0 : Math.min(2, targetZone.prefabCount * 0.6);
      const result = await createPrefab.mutateAsync({
        zoneId: targetZone.id,
        prefabId: item.prefabId,
        x: point?.x ?? targetZone.cx + spread,
        z: point?.z ?? targetZone.cz + spread,
      });
      if (result.persisted) {
        setSelectedZoneId(targetZone.id);
        setSelectedPrefabId(result.instanceId);
        setObjectDeleteArmed(false);
        toast.success(`Added ${item.label}`, { description: targetZone.label });
      }
    } catch (error) {
      toast.error('Object placement failed', { description: safeErrorMessage(error) });
    }
  }

  function placeOnCanvas(point: ScenePlacementPoint) {
    const itemId = paletteDrag?.itemId ?? placing;
    const item = PALETTE.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const targetZone = zones.find((zone) => zone.id === point.zoneId) ?? null;
    if (!targetZone) {
      toast.error('Pick a zone footprint');
      return;
    }
    void addPrefab(item, targetZone, point);
    if (paletteDrag?.itemId) {
      setTool('select');
      setPlacing(null);
    }
  }

  function beginPaletteDrag(item: PaletteItem, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!layout.data || busy || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;

    const clearListeners = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      document.body.style.cursor = '';
    };
    const settleSuppress = () => {
      if (dragClearTimerRef.current !== null) {
        window.clearTimeout(dragClearTimerRef.current);
      }
      dragClearTimerRef.current = window.setTimeout(() => {
        setPaletteDrag(null);
        suppressPaletteClickRef.current = false;
      }, PALETTE_DRAG_SETTLE_MS);
    };
    const onPointerMove = (moveEvent: PointerEvent) => {
      if (
        !dragging &&
        Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) <=
          PALETTE_DRAG_THRESHOLD_PX
      ) {
        return;
      }
      if (!dragging) {
        dragging = true;
        suppressPaletteClickRef.current = true;
        setTool('place');
        setPlacing(item.id);
      }
      document.body.style.cursor = 'grabbing';
      setPaletteDrag({
        itemId: item.id,
        label: item.label,
        clientX: moveEvent.clientX,
        clientY: moveEvent.clientY,
        active: true,
        commitId: null,
      });
    };
    const onPointerUp = (upEvent: PointerEvent) => {
      clearListeners();
      if (!dragging) {
        suppressPaletteClickRef.current = false;
        return;
      }
      suppressPaletteClickRef.current = true;
      setPaletteDrag({
        itemId: item.id,
        label: item.label,
        clientX: upEvent.clientX,
        clientY: upEvent.clientY,
        active: false,
        commitId: crypto.randomUUID(),
      });
      settleSuppress();
    };
    const onPointerCancel = () => {
      clearListeners();
      setPaletteDrag(null);
      suppressPaletteClickRef.current = false;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  function selectPrefab(instanceId: string) {
    const prefab = layout.data?.prefabs.find((item) => item.instance.instance_id === instanceId);
    setSelectedPrefabId(instanceId);
    setSelectedZoneId(prefab?.instance.zone_id ?? selectedZoneId);
    setObjectDeleteArmed(false);
    setTool('select');
    setPlacing(null);
  }

  async function movePrefab(move: ScenePrefabMove) {
    const zone = zones.find((candidate) => candidate.id === move.zoneId);
    try {
      const result = await updatePrefab.mutateAsync({
        instanceId: move.instanceId,
        fields: {
          zone_id: move.zoneId,
          position_x: move.x,
          position_y: move.z,
        },
      });
      if (result.persisted) {
        setSelectedPrefabId(move.instanceId);
        setSelectedZoneId(move.zoneId);
        toast.success('Object moved', { description: zone?.label ?? move.zoneId });
      }
    } catch (error) {
      toast.error('Object move failed', { description: safeErrorMessage(error) });
    }
  }

  async function rotateSelectedObject() {
    if (!selectedPrefab) return;
    const turns = [0, 90, 180, 270] as const;
    const currentIndex = Math.max(0, turns.indexOf(selectedPrefab.instance.rotation));
    const nextRotation = turns[(currentIndex + 1) % turns.length];
    try {
      const result = await updatePrefab.mutateAsync({
        instanceId: selectedPrefab.instance.instance_id,
        fields: { rotation: nextRotation },
      });
      if (result.persisted) {
        toast.success('Object rotated', { description: `${nextRotation}°` });
      }
    } catch (error) {
      toast.error('Object rotation failed', { description: safeErrorMessage(error) });
    }
  }

  async function deleteSelectedObject() {
    if (!selectedPrefab) return;
    if (!objectDeleteArmed) {
      setObjectDeleteArmed(true);
      return;
    }
    try {
      const result = await deletePrefab.mutateAsync({
        instanceId: selectedPrefab.instance.instance_id,
      });
      if (result.persisted) {
        toast.success('Object deleted', { description: selectedPrefab.definition.name });
        setSelectedPrefabId(null);
        setObjectDeleteArmed(false);
      }
    } catch (error) {
      toast.error('Object deletion failed', { description: safeErrorMessage(error) });
    }
  }

  return (
    <div className="off-studio">
      {paletteDrag?.active && dragGhostItem ? (
        <div className="off-studio-drag-ghost" style={dragGhostStyle}>
          <Icon icon={dragGhostItem.icon} size="sm" />
          {paletteDrag.label}
        </div>
      ) : null}
      <aside className="off-studio-panel is-left">
        <div className="off-studio-panel-head">
          <CapsLabel>Objects</CapsLabel>
        </div>
        <div className="off-studio-panel-body">
          {PALETTE.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn('off-studio-tool off-focusable', placing === item.id && 'is-on')}
              disabled={!layout.data || busy}
              title={layout.data ? `Place ${item.label} in scene` : 'Desktop layout required'}
              onPointerDown={(event) => beginPaletteDrag(item, event)}
              onClick={() => {
                if (suppressPaletteClickRef.current) {
                  suppressPaletteClickRef.current = false;
                  return;
                }
                setTool('place');
                setPlacing((current) => (current === item.id ? null : item.id));
              }}
            >
              <Icon icon={item.icon} size="sm" />
              {item.label}
            </button>
          ))}
        </div>
      </aside>

      <section className="off-studio-stage">
        {!layout.isLoading && !layout.data ? (
          <div className="off-studio-banner">
            <Icon icon={Info} size="sm" />
            Preview scene — Studio editing needs the desktop app, so changes here won't be saved.
          </div>
        ) : null}
        <div className="off-studio-toolbar">
          <SegmentedControl
            options={[
              { value: 'select', label: 'Select', icon: <Icon icon={Move3d} size="sm" /> },
              { value: 'place', label: 'Place', icon: <Icon icon={Box} size="sm" /> },
            ]}
            value={tool}
            onChange={(v) => {
              setTool(v);
              if (v === 'select') setPlacing(null);
            }}
            ariaLabel="Studio tool"
          />
          <span className="off-studio-toolbar-hint">
            {paletteDrag?.active
              ? `Drop on a zone footprint to place ${paletteDrag.label}`
              : tool === 'place' && placing
                ? `Click a zone footprint to place ${PALETTE.find((item) => item.id === placing)?.label ?? 'object'}`
                : `${zones.length} zones · ${layout.data?.prefabs.length ?? 0} objects`}
          </span>
        </div>
        <div className="off-studio-canvas-host">
          <OfficeScene3D
            allowOrbit
            placementEnabled={tool === 'place' && Boolean(placing) && Boolean(layout.data) && !busy}
            placementProbe={placementProbe}
            onPlacementPoint={placeOnCanvas}
            selectedPrefabId={selectedPrefabId}
            onPrefabSelect={selectPrefab}
            onPrefabMove={busy ? undefined : movePrefab}
          />
        </div>
      </section>

      <aside className="off-studio-panel is-right">
        <div className="off-studio-panel-head">
          <CapsLabel>Zones</CapsLabel>
          <IconButton
            icon={Plus}
            label="Create zone"
            size="iconSm"
            variant="outline"
            disabled={!layout.data || busy}
            onClick={() => void createWorkspaceZone()}
          />
        </div>
        <div className="off-studio-panel-body">
          {zones.map((zone) => (
            <button
              key={zone.id}
              type="button"
              className={cn(
                'off-studio-zone off-focusable',
                zone.id === selectedZoneId && 'is-sel',
              )}
              onClick={() => {
                setSelectedZoneId(zone.id);
                setSelectedPrefabId(null);
              }}
            >
              <Icon icon={LayoutGrid} size="sm" />
              <span className="off-studio-zone-name">{zone.label}</span>
              <span className="off-studio-zone-kind">
                {ZONE_KIND_LABEL[zone.kind] ?? zone.kind}
              </span>
            </button>
          ))}
        </div>
        {selectedPrefab ? (
          <div className="off-studio-props">
            <CapsLabel>Object</CapsLabel>
            <div className="off-about-row">
              <span>Name</span>
              <span>{selectedPrefab.definition.name}</span>
            </div>
            <div className="off-about-row">
              <span>Zone</span>
              <span>{selectedPrefabZone?.label ?? selectedPrefab.instance.zone_id}</span>
            </div>
            <div className="off-about-row">
              <span>Position</span>
              <span>
                {selectedPrefab.instance.position_x.toFixed(1)},{' '}
                {selectedPrefab.instance.position_y.toFixed(1)}
              </span>
            </div>
            <div className="off-about-row">
              <span>Rotation</span>
              <span>{selectedPrefab.instance.rotation}°</span>
            </div>
            <div className="off-studio-size-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void rotateSelectedObject()}
              >
                <Icon icon={RotateCw} size="sm" />
                Rotate
              </Button>
              <Button
                variant={objectDeleteArmed ? 'destructive' : 'outline'}
                size="sm"
                disabled={busy}
                onClick={() => void deleteSelectedObject()}
              >
                <Icon icon={Trash2} size="sm" />
                {objectDeleteArmed ? 'Confirm delete' : 'Delete'}
              </Button>
              {objectDeleteArmed ? (
                <Button variant="ghost" size="sm" onClick={() => setObjectDeleteArmed(false)}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {selectedZone ? (
          <div className="off-studio-props">
            <CapsLabel>Properties</CapsLabel>
            <div className="off-studio-field">
              <label htmlFor={zoneLabelInputId}>Label</label>
              <div className="off-studio-inline">
                <Input
                  id={zoneLabelInputId}
                  value={zoneDraft?.label ?? ''}
                  onChange={(event) =>
                    setZoneDraft(zoneDraft ? { ...zoneDraft, label: event.target.value } : null)
                  }
                  disabled={!selectedZonePersisted || busy}
                  aria-label="Zone label"
                />
                <IconButton
                  icon={Save}
                  label="Save zone edits"
                  size="iconSm"
                  variant="outline"
                  disabled={!canSaveDraft}
                  onClick={() => void saveZoneDraft()}
                />
                <IconButton
                  icon={RotateCcw}
                  label="Reset zone edits"
                  size="iconSm"
                  variant="outline"
                  disabled={!dirty || busy}
                  onClick={resetZoneDraft}
                />
              </div>
            </div>
            {dirty ? <div className="off-studio-dirty">Unsaved zone edits</div> : null}
            {validation.errors.length > 0 ? (
              <div className="off-studio-invalid">{validation.errors[0]}</div>
            ) : null}
            <div className="off-about-row">
              <span>Type</span>
              <span>{ZONE_KIND_LABEL[selectedZone.kind] ?? selectedZone.kind}</span>
            </div>
            <div className="off-about-row">
              <span>Objects</span>
              <span>{selectedZone.prefabCount}</span>
            </div>
            <div className="off-about-row">
              <span>Footprint</span>
              <span>
                {zoneDraft?.w ?? selectedZone.w} × {zoneDraft?.d ?? selectedZone.d}
              </span>
            </div>
            <div className="off-studio-nudge">
              <CapsLabel>Position</CapsLabel>
              <div className="off-studio-numeric-pair">
                <label htmlFor={zoneXInputId}>
                  X
                  <Input
                    id={zoneXInputId}
                    type="number"
                    value={zoneDraft?.cx ?? selectedZone.cx}
                    disabled={!selectedZonePersisted || busy}
                    onChange={(event) =>
                      setZoneDraft(setDraftNumber(zoneDraft, 'cx', event.target.value))
                    }
                  />
                </label>
                <label htmlFor={zoneZInputId}>
                  Z
                  <Input
                    id={zoneZInputId}
                    type="number"
                    value={zoneDraft?.cz ?? selectedZone.cz}
                    disabled={!selectedZonePersisted || busy}
                    onChange={(event) =>
                      setZoneDraft(setDraftNumber(zoneDraft, 'cz', event.target.value))
                    }
                  />
                </label>
              </div>
              <div className="off-studio-nudge-grid">
                <span />
                <IconButton
                  icon={ArrowUp}
                  label="Move zone up"
                  size="iconSm"
                  variant="outline"
                  disabled={!selectedZonePersisted || busy}
                  onClick={() => void moveZone(0, -1)}
                />
                <span />
                <IconButton
                  icon={ArrowLeft}
                  label="Move zone left"
                  size="iconSm"
                  variant="outline"
                  disabled={!selectedZonePersisted || busy}
                  onClick={() => void moveZone(-1, 0)}
                />
                <div className="off-studio-pos">
                  {zoneDraft?.cx ?? selectedZone.cx}, {zoneDraft?.cz ?? selectedZone.cz}
                </div>
                <IconButton
                  icon={ArrowRight}
                  label="Move zone right"
                  size="iconSm"
                  variant="outline"
                  disabled={!selectedZonePersisted || busy}
                  onClick={() => void moveZone(1, 0)}
                />
                <span />
                <IconButton
                  icon={ArrowDown}
                  label="Move zone down"
                  size="iconSm"
                  variant="outline"
                  disabled={!selectedZonePersisted || busy}
                  onClick={() => void moveZone(0, 1)}
                />
                <span />
              </div>
            </div>
            <div className="off-studio-nudge">
              <CapsLabel>Size</CapsLabel>
              <div className="off-studio-numeric-pair">
                <label htmlFor={zoneWidthInputId}>
                  W
                  <Input
                    id={zoneWidthInputId}
                    type="number"
                    min={3}
                    max={30}
                    value={zoneDraft?.w ?? selectedZone.w}
                    disabled={!selectedZonePersisted || busy}
                    onChange={(event) =>
                      setZoneDraft(setDraftNumber(zoneDraft, 'w', event.target.value))
                    }
                  />
                </label>
                <label htmlFor={zoneDepthInputId}>
                  D
                  <Input
                    id={zoneDepthInputId}
                    type="number"
                    min={3}
                    max={30}
                    value={zoneDraft?.d ?? selectedZone.d}
                    disabled={!selectedZonePersisted || busy}
                    onChange={(event) =>
                      setZoneDraft(setDraftNumber(zoneDraft, 'd', event.target.value))
                    }
                  />
                </label>
              </div>
              <div className="off-studio-size-actions">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!selectedZonePersisted || busy}
                  onClick={() => resizeZone(1, 1)}
                >
                  Grow
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!selectedZonePersisted || busy}
                  onClick={() => resizeZone(-1, -1)}
                >
                  Shrink
                </Button>
              </div>
            </div>
            {selectedZonePersisted ? (
              <div className="off-studio-danger">
                <Button
                  variant={deleteArmed ? 'destructive' : 'outline'}
                  size="sm"
                  disabled={busy}
                  onClick={() => void deleteSelectedZone()}
                >
                  <Icon icon={Trash2} size="sm" />
                  {deleteArmed ? 'Confirm delete' : 'Delete zone'}
                </Button>
                {deleteArmed ? (
                  <Button variant="ghost" size="sm" onClick={() => setDeleteArmed(false)}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="off-studio-props">
            <EmptyState
              icon={Move3d}
              title="No selection"
              description="Pick a zone to edit it, or place an object from the palette."
            />
          </div>
        )}
      </aside>
    </div>
  );
}
