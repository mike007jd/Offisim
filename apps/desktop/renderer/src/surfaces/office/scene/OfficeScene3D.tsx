import { useUiState } from '@/app/ui-state.js';
import { useEmployees, useOfficeLayout, useReassignEmployee, useThreads } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { resolveAppearance } from '@/lib/avatar.js';
import { extractZoneSlug, type PrefabDefinition, type PrefabInstanceRow } from '@offisim/shared-types';
import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ACESFilmicToneMapping, type Camera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { BlockCharacter } from './BlockCharacter.js';
import { RoomShell } from './r3d/RoomShell.js';
import { SceneEnvironment } from './r3d/SceneEnvironment.js';
import { SceneLighting } from './r3d/SceneLighting.js';
import { ScenePostFx } from './r3d/ScenePostFx.js';
import { BookshelfMesh3D } from './r3d/prefabs/BookshelfMesh3D.js';
import { DecorativeMesh3D } from './r3d/prefabs/DecorativeMesh3D.js';
import { MeetingTableMesh3D } from './r3d/prefabs/MeetingTableMesh3D.js';
import { Prefab3D } from './r3d/prefabs/Prefab3D.js';
import { RestAreaMesh3D } from './r3d/prefabs/RestAreaMesh3D.js';
import { ServerRackUnit3D } from './r3d/prefabs/ServerRackMesh3D.js';
import { WhiteboardMesh3D } from './r3d/prefabs/WhiteboardMesh3D.js';
import { WorkstationUnit3D } from './r3d/prefabs/WorkstationMesh3D.js';
import { OFFICE_CAMERA_PRESET, SCENE_CONTENT_SCALE } from './r3d/scene-art-direction.js';
import { LIGHT_SCENE_3D } from './r3d/scene-colors.js';
import { SceneMaterial } from './r3d/scene-materials.js';
import { compactSceneEmployeeName } from './scene-labels.js';
import {
  type ZoneDef,
  employeePlacements,
  defaultEmployeeZone as resolveDefaultEmployeeZone,
  zoneDefsFromLayout,
} from './scene-layout.js';

export interface ScenePlacementPoint {
  readonly x: number;
  readonly z: number;
  readonly zoneId: string | null;
}

export interface ScenePrefabMove {
  readonly instanceId: string;
  readonly x: number;
  readonly z: number;
  readonly zoneId: string;
}

interface SceneEmployeeDrop {
  readonly zoneId: string | null;
  readonly x: number | null;
  readonly z: number | null;
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
  readonly moved: boolean;
}

interface SceneEmployeeDrag {
  readonly employeeId: string;
  readonly x: number;
  readonly z: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly moved: boolean;
}

interface SceneDropNotice {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly message: string;
}

export interface ScenePlacementProbe {
  readonly clientX: number;
  readonly clientY: number;
  readonly active: boolean;
  readonly commitId: string | null;
}

interface OfficeScene3DProps {
  readonly placementEnabled?: boolean;
  readonly placementProbe?: ScenePlacementProbe | null;
  readonly onPlacementPoint?: (point: ScenePlacementPoint) => void;
  readonly selectedPrefabId?: string | null;
  readonly onPrefabSelect?: (instanceId: string) => void;
  readonly onPrefabMove?: (move: ScenePrefabMove) => void;
}

const ZONE_TINT: Record<string, string> = {
  workspace: LIGHT_SCENE_3D.zoneWorkspace,
  meeting: LIGHT_SCENE_3D.zoneMeeting,
  rest: LIGHT_SCENE_3D.zoneRest,
  lounge: LIGHT_SCENE_3D.zoneRest,
  library: LIGHT_SCENE_3D.zoneLibrary,
  server: LIGHT_SCENE_3D.zoneServer,
};

function zoneTint(archetype: string): string {
  return ZONE_TINT[archetype] ?? LIGHT_SCENE_3D.zoneWorkspace;
}

type ScenePrefabItem = { instance: PrefabInstanceRow; definition: PrefabDefinition };

interface LegacyPrefabRefreshRule {
  readonly prefabId: string;
  readonly from: readonly [number, number];
  readonly to?: readonly [number, number];
  readonly fromRotation?: PrefabInstanceRow['rotation'];
  readonly toRotation?: PrefabInstanceRow['rotation'];
}

const LEGACY_POSITION_EPSILON = 0.08;
const WORKSTATION_PREFAB_IDS = new Set([
  'workstation-standard',
  'workstation-compact',
  'workstation-dual',
]);

const WORKSPACE_SCENE_SLOTS: Readonly<
  Record<string, readonly { x: number; z: number; rotation: PrefabInstanceRow['rotation'] }[]>
> = {
  'zone-dev': [
    { x: -3.8, z: -1.35, rotation: 0 },
    { x: 2.75, z: 1.55, rotation: 180 },
  ],
  'zone-product': [
    { x: -3.25, z: -1.25, rotation: 0 },
    { x: 2.65, z: 1.65, rotation: 180 },
  ],
  'zone-art': [
    { x: -3.2, z: -1.25, rotation: 0 },
    { x: 2.85, z: 1.65, rotation: 180 },
  ],
};

const LEGACY_SYSTEM_PREFAB_REFRESH: Readonly<Record<string, readonly LegacyPrefabRefreshRule[]>> = {
  'zone-dev': [
    { prefabId: 'workstation-dual', from: [-4.6, -1.9], to: [-3.8, -1.35] },
    { prefabId: 'workstation-dual', from: [-4.35, -1.75], to: [-3.8, -1.35] },
    {
      prefabId: 'workstation-standard',
      from: [-1.45, -1.9],
      to: [2.75, 1.55],
      toRotation: 180,
    },
    {
      prefabId: 'workstation-standard',
      from: [0.15, -1.75],
      to: [2.75, 1.55],
      toRotation: 180,
    },
    { prefabId: 'workstation-standard', from: [1.75, -1.9] },
    { prefabId: 'workstation-dual', from: [4.9, -1.9] },
    { prefabId: 'workstation-dual', from: [4.95, 2.55] },
    { prefabId: 'workstation-standard', from: [-2.25, 2.7] },
    { prefabId: 'workstation-standard', from: [2.45, 2.7] },
    { prefabId: 'standing-table', from: [-5.1, 2.9], to: [-0.9, 2.85] },
    { prefabId: 'standing-table', from: [-5.15, 2.85], to: [-0.9, 2.85] },
    { prefabId: 'network-switch', from: [5.3, 2.8], to: [5.15, -2.85] },
    { prefabId: 'network-switch', from: [5.35, -3.05], to: [5.15, -2.85] },
    { prefabId: 'plant-large', from: [5.5, -3.0], to: [-5.35, 2.9] },
    { prefabId: 'plant-large', from: [-5.45, -3.05], to: [-5.35, 2.9] },
  ],
  'zone-product': [
    { prefabId: 'workstation-standard', from: [-3.7, -1.35], to: [-3.25, -1.25] },
    { prefabId: 'workstation-standard', from: [-3.75, -1.45], to: [-3.25, -1.25] },
    { prefabId: 'workstation-standard', from: [-0.7, -1.35] },
    {
      prefabId: 'workstation-standard',
      from: [2.3, -1.35],
      to: [2.65, 1.65],
      toRotation: 180,
    },
    {
      prefabId: 'workstation-standard',
      from: [1.45, -1.45],
      to: [2.65, 1.65],
      toRotation: 180,
    },
    { prefabId: 'workstation-compact', from: [4.9, 2.2] },
    { prefabId: 'standing-table', from: [-2.6, 2.7], to: [0, 2.8] },
    { prefabId: 'standing-table', from: [-3.35, 2.75], to: [0, 2.8] },
    { prefabId: 'status-board', from: [4.6, -2.8], to: [4.8, -2.85] },
    { prefabId: 'status-board', from: [4.75, 2.55], to: [4.8, -2.85] },
    { prefabId: 'plant-large', from: [5.0, 2.9], to: [-5.05, 2.75] },
    { prefabId: 'plant-large', from: [5.15, -2.95], to: [-5.05, 2.75] },
  ],
  'zone-art': [
    { prefabId: 'workstation-dual', from: [-4.1, -1.45], to: [-3.2, -1.25] },
    { prefabId: 'workstation-dual', from: [-4.0, -1.45], to: [-3.2, -1.25] },
    { prefabId: 'workstation-standard', from: [-0.9, -1.45] },
    { prefabId: 'workstation-standard', from: [2.4, -1.45] },
    {
      prefabId: 'workstation-dual',
      from: [-1.1, 2.7],
      to: [2.85, 1.65],
      toRotation: 180,
    },
    {
      prefabId: 'workstation-standard',
      from: [1.45, -1.45],
      to: [2.85, 1.65],
      toRotation: 180,
    },
    { prefabId: 'standing-table', from: [3.8, 2.8], to: [-0.1, 2.75] },
    { prefabId: 'standing-table', from: [3.75, 2.65], to: [-0.1, 2.75] },
    { prefabId: 'status-board', from: [4.7, -2.8], to: [4.8, -2.85] },
    { prefabId: 'plant-large', from: [-4.8, 2.9], to: [-5.05, 2.65] },
    { prefabId: 'plant-large', from: [-4.95, 2.75], to: [-5.05, 2.65] },
    { prefabId: 'plant-small', from: [4.7, -3.1] },
  ],
  'zone-library': [
    { prefabId: 'bookshelf-double', from: [-4.9, -2.85], to: [-5.4, -2.55] },
    { prefabId: 'bookshelf-double', from: [4.9, -2.85], to: [5.4, -2.55] },
    { prefabId: 'reading-table', from: [0, 0.65], to: [0, 1.45] },
    { prefabId: 'chair-standalone', from: [-1.05, 2.45], to: [-2.4, 2.85] },
    { prefabId: 'chair-standalone', from: [1.05, 2.45], to: [2.4, 2.85] },
    { prefabId: 'plant-large', from: [5.6, 2.65], to: [-5.4, 2.7] },
  ],
};

function prefabDefinitionId({ instance, definition }: ScenePrefabItem): string {
  return definition.prefabId ?? instance.prefab_id;
}

function isSceneWorkstation(item: ScenePrefabItem): boolean {
  return WORKSTATION_PREFAB_IDS.has(prefabDefinitionId(item));
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= LEGACY_POSITION_EPSILON;
}

function legacyRefreshRuleFor(
  item: ScenePrefabItem,
  zone: ZoneDef,
): LegacyPrefabRefreshRule | null {
  const rules = LEGACY_SYSTEM_PREFAB_REFRESH[extractZoneSlug(zone.id)];
  if (!rules) return null;
  const prefabId = prefabDefinitionId(item);
  const localX = item.instance.position_x - zone.cx;
  const localZ = item.instance.position_y - zone.cz;
  const rotation = ((item.instance.rotation % 360) + 360) % 360;
  return (
    rules.find(
      (rule) =>
        rule.prefabId === prefabId &&
        near(localX, rule.from[0]) &&
        near(localZ, rule.from[1]) &&
        (rule.fromRotation === undefined || rotation === rule.fromRotation),
    ) ?? null
  );
}

function relaxedScenePrefabs(
  prefabs: readonly ScenePrefabItem[] | undefined,
  zones: readonly ZoneDef[],
): readonly ScenePrefabItem[] | undefined {
  if (!prefabs) return undefined;
  const zonesBySlug = new Map(zones.map((zone) => [extractZoneSlug(zone.id), zone]));
  const refreshed: ScenePrefabItem[] = [];

  for (const item of prefabs) {
    const zone = zonesBySlug.get(extractZoneSlug(item.instance.zone_id));
    if (!zone) {
      refreshed.push(item);
      continue;
    }
    const rule = legacyRefreshRuleFor(item, zone);
    if (!rule) {
      refreshed.push(item);
      continue;
    }
    if (!rule.to) {
      continue;
    }
    refreshed.push({
      ...item,
      instance: {
        ...item.instance,
        position_x: zone.cx + rule.to[0],
        position_y: zone.cz + rule.to[1],
        rotation: rule.toRotation ?? item.instance.rotation,
      },
    });
  }

  const denseWorkspaceSlugs = new Set<string>();
  const workstationsBySlug = new Map<string, ScenePrefabItem[]>();
  for (const item of refreshed) {
    const zone = zonesBySlug.get(extractZoneSlug(item.instance.zone_id));
    if (!zone || zone.archetype !== 'workspace' || !isSceneWorkstation(item)) continue;
    const slug = extractZoneSlug(zone.id);
    const items = workstationsBySlug.get(slug) ?? [];
    items.push(item);
    workstationsBySlug.set(slug, items);
  }

  for (const [slug, items] of workstationsBySlug) {
    if (items.length > (WORKSPACE_SCENE_SLOTS[slug]?.length ?? 2)) {
      denseWorkspaceSlugs.add(slug);
    }
  }

  if (denseWorkspaceSlugs.size === 0) return refreshed;

  const workstationRank = new Map<ScenePrefabItem, number>();
  for (const slug of denseWorkspaceSlugs) {
    const items = [...(workstationsBySlug.get(slug) ?? [])].sort(
      (a, b) =>
        a.instance.position_y - b.instance.position_y ||
        a.instance.position_x - b.instance.position_x,
    );
    items.forEach((item, index) => workstationRank.set(item, index));
  }

  const out: ScenePrefabItem[] = [];
  for (const item of refreshed) {
    const zone = zonesBySlug.get(extractZoneSlug(item.instance.zone_id));
    const slug = zone ? extractZoneSlug(zone.id) : '';
    const rank = workstationRank.get(item);
    if (!zone || !denseWorkspaceSlugs.has(slug) || rank === undefined) {
      out.push(item);
      continue;
    }
    const slot = WORKSPACE_SCENE_SLOTS[slug]?.[rank];
    if (!slot) continue;
    out.push({
      ...item,
      instance: {
        ...item.instance,
        position_x: zone.cx + slot.x,
        position_y: zone.cz + slot.z,
        rotation: slot.rotation,
      },
    });
  }

  return out;
}

function hitTestZone(zones: ZoneDef[], x: number, z: number): ZoneDef | null {
  for (const zone of zones) {
    if (
      x >= zone.cx - zone.w / 2 &&
      x <= zone.cx + zone.w / 2 &&
      z >= zone.cz - zone.d / 2 &&
      z <= zone.cz + zone.d / 2
    ) {
      return zone;
    }
  }
  return null;
}

function groundPointFromClient(
  clientX: number,
  clientY: number,
  element: HTMLCanvasElement,
  camera: Camera,
  zones: ZoneDef[],
): ScenePlacementPoint | null {
  const rect = element.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null;
  }
  const raycaster = new Raycaster();
  const plane = new Plane(new Vector3(0, 1, 0), 0);
  const pointer = new Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const hit = new Vector3();
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(plane, hit)) return null;
  return { x: hit.x, z: hit.z, zoneId: hitTestZone(zones, hit.x, hit.z)?.id ?? null };
}

function ScenePrefabInstance3D({
  instance,
  definition,
  zones,
  selected,
  onSelect,
  onMove,
  onHoverZone,
  onDragState,
}: {
  instance: PrefabInstanceRow;
  definition: PrefabDefinition;
  zones: ZoneDef[];
  selected: boolean;
  onSelect?: (instanceId: string) => void;
  onMove?: (move: ScenePrefabMove) => void;
  onHoverZone: (zoneId: string | null) => void;
  onDragState: (drag: { instanceId: string } | null) => void;
}) {
  const { camera, gl } = useThree();
  const cleanupRef = useRef<(() => void) | null>(null);
  const selectionRadius = Math.max(definition.gridSize[0], definition.gridSize[1]) * 0.55;

  useEffect(
    () => () => {
      cleanupRef.current?.();
    },
    [],
  );

  const beginDrag = (event: PointerEvent) => {
    if (!onMove) return;

    cleanupRef.current?.();

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    let complete = false;

    const releasePointer = () => {
      try {
        gl.domElement.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture is best-effort; Safari/WebView can already release it on pointerup.
      }
    };

    const cleanup = () => {
      if (complete) return;
      complete = true;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerCancel);
      document.removeEventListener('mouseup', onMouseUp);
      gl.domElement.removeEventListener('pointerup', onPointerUp);
      gl.domElement.removeEventListener('pointercancel', onPointerCancel);
      gl.domElement.removeEventListener('mouseup', onMouseUp);
      releasePointer();
      document.body.style.cursor = '';
      onHoverZone(null);
      onDragState(null);
      cleanupRef.current = null;
    };

    const toGround = (e: PointerEvent | MouseEvent) =>
      groundPointFromClient(e.clientX, e.clientY, gl.domElement, camera, zones);

    const onPointerMove = (e: PointerEvent) => {
      e.preventDefault();
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 5) moved = true;
      onHoverZone(moved ? (toGround(e)?.zoneId ?? null) : null);
    };

    const finishDrop = (e: PointerEvent | MouseEvent) => {
      e.preventDefault();
      const point = moved ? toGround(e) : null;
      if (moved && point?.zoneId) {
        onMove({
          instanceId: instance.instance_id,
          zoneId: point.zoneId,
          x: point.x,
          z: point.z,
        });
      }
      cleanup();
    };

    const onPointerUp = (e: PointerEvent) => finishDrop(e);
    const onMouseUp = (e: MouseEvent) => finishDrop(e);
    const onPointerCancel = () => {
      cleanup();
    };

    try {
      gl.domElement.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is best-effort; the window listeners still own the drag lifecycle.
    }

    onSelect?.(instance.instance_id);
    onDragState({ instanceId: instance.instance_id });
    document.body.style.cursor = 'grabbing';
    cleanupRef.current = cleanup;
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('mouseup', onMouseUp);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('mouseup', onMouseUp);
    gl.domElement.addEventListener('pointerup', onPointerUp);
    gl.domElement.addEventListener('pointercancel', onPointerCancel);
    gl.domElement.addEventListener('mouseup', onMouseUp);
  };

  return (
    // SCENE_CONTENT_SCALE lives on the placement group (not a single scene-wide
    // root) on purpose: `position` stays in stored authoring coordinates while
    // the drag/placement raycaster hits the world-space y=0 plane, so scaling
    // here keeps stored coords == world coords. A shared scaled root would force
    // every ground hit to be divided by the scale to round-trip into storage.
    // biome-ignore lint/a11y/useKeyWithClickEvents: r3f raycaster on a 3D prefab; editable prefab selection is also reachable through Studio inspector controls
    <group
      position={[instance.position_x, 0, instance.position_y]}
      rotation={[0, (instance.rotation * Math.PI) / 180, 0]}
      scale={SCENE_CONTENT_SCALE}
      onClick={(e) => {
        if (!onSelect) return;
        e.stopPropagation();
        onSelect(instance.instance_id);
      }}
      onPointerDown={(e) => {
        if (!onMove) return;
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        e.nativeEvent.preventDefault();
        beginDrag(e.nativeEvent);
      }}
      onPointerOver={(e) => {
        if (!onSelect && !onMove) return;
        e.stopPropagation();
        document.body.style.cursor = onMove ? 'grab' : 'pointer';
      }}
      onPointerOut={() => {
        if (!cleanupRef.current) document.body.style.cursor = '';
      }}
    >
      {selected ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.065, 0]}>
          <ringGeometry args={[selectionRadius, selectionRadius + 0.16, 56]} />
          <meshBasicMaterial color={LIGHT_SCENE_3D.selectionRing} transparent opacity={0.78} />
        </mesh>
      ) : null}
      <Prefab3D definition={definition} />
    </group>
  );
}

function PlacementController({
  zones,
  onHover,
  onPick,
}: {
  zones: ZoneDef[];
  onHover: (zoneId: string | null) => void;
  onPick: (point: ScenePlacementPoint) => void;
}) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new Raycaster();
    const plane = new Plane(new Vector3(0, 1, 0), 0);
    const pointer = new Vector2();
    const hit = new Vector3();
    let start: { x: number; y: number } | null = null;
    const toGround = (e: PointerEvent): ScenePlacementPoint | null => {
      const rect = el.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      return { x: hit.x, z: hit.z, zoneId: hitTestZone(zones, hit.x, hit.z)?.id ?? null };
    };
    const onPointerDown = (e: PointerEvent) => {
      start = { x: e.clientX, y: e.clientY };
    };
    const onPointerMove = (e: PointerEvent) => {
      onHover(toGround(e)?.zoneId ?? null);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return;
      const point = toGround(e);
      if (point) onPick(point);
    };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.style.cursor = 'crosshair';
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.style.cursor = '';
      onHover(null);
    };
  }, [camera, gl, zones, onHover, onPick]);
  return null;
}

function ExternalPlacementController({
  zones,
  probe,
  onHover,
  onPick,
}: {
  zones: ZoneDef[];
  probe: ScenePlacementProbe | null;
  onHover: (zoneId: string | null) => void;
  onPick: (point: ScenePlacementPoint) => void;
}) {
  const { camera, gl } = useThree();
  const lastCommitIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!probe?.active) {
      onHover(null);
      return;
    }
    const point = groundPointFromClient(probe.clientX, probe.clientY, gl.domElement, camera, zones);
    onHover(point?.zoneId ?? null);
  }, [camera, gl, onHover, probe?.active, probe?.clientX, probe?.clientY, zones]);

  useEffect(() => {
    if (!probe?.commitId) return;
    if (lastCommitIdRef.current === probe.commitId) return;
    lastCommitIdRef.current = probe.commitId;
    const point = groundPointFromClient(probe.clientX, probe.clientY, gl.domElement, camera, zones);
    if (point) onPick(point);
    onHover(null);
  }, [camera, gl, onHover, onPick, probe?.commitId, probe, zones]);
  return null;
}

/** Evenly spread `count` standing positions inside a zone footprint. */
function ZoneRug({ zone, highlight = false }: { zone: ZoneDef; highlight?: boolean }) {
  const borderOpacity = highlight ? 0.86 : 0.38;
  const rugOpacity = highlight ? 0.42 : zone.archetype === 'server' ? 0.56 : 0.44;
  const showGlass =
    zone.archetype === 'meeting' || zone.archetype === 'server' || zone.archetype === 'library';
  const labelZ =
    zone.archetype === 'meeting' || zone.archetype === 'server'
      ? -zone.d / 2 + 0.68
      : zone.d / 2 - 0.68;
  const labelX =
    zone.archetype === 'meeting' || zone.archetype === 'library'
      ? -zone.w / 2 + 4.2
      : -zone.w / 2 + 0.72;
  const borderStrips: [number, number, number, number][] = [
    [0, -zone.d / 2, zone.w, 0.07],
    [0, zone.d / 2, zone.w, 0.07],
    [-zone.w / 2, 0, 0.07, zone.d],
    [zone.w / 2, 0, 0.07, zone.d],
  ];
  return (
    <group position={[zone.cx, 0, zone.cz]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 0]} receiveShadow>
        <planeGeometry args={[zone.w, zone.d]} />
        <SceneMaterial
          materialClass={zone.archetype === 'server' ? 'rubber' : 'carpet'}
          color={highlight ? LIGHT_SCENE_3D.selectionRing : zoneTint(zone.archetype)}
          overrides={{
            roughness: zone.archetype === 'server' ? 0.86 : 0.95,
            transparent: true,
            opacity: rugOpacity,
          }}
        />
      </mesh>
      {borderStrips.map(([x, z, w, d]) => (
        <mesh key={`zone-border-${x}-${z}`} position={[x, 0.044, z]} receiveShadow>
          <boxGeometry args={[w, 0.032, d]} />
          <SceneMaterial
            materialClass="rubber"
            color={highlight ? LIGHT_SCENE_3D.selectionRing : LIGHT_SCENE_3D.floorBorder}
            overrides={{ transparent: true, opacity: borderOpacity, roughness: 0.82 }}
          />
        </mesh>
      ))}
      {showGlass ? (
        <mesh position={[0, 0.62, -zone.d / 2 + 0.1]} castShadow receiveShadow>
          <boxGeometry args={[zone.w * 0.82, 1.18, 0.045]} />
          <SceneMaterial
            materialClass="glass"
            color={LIGHT_SCENE_3D.partition}
            overrides={{ transparent: true, opacity: 0.2, roughness: 0.16, thickness: 0.05 }}
          />
        </mesh>
      ) : null}
      {highlight ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry
            args={[Math.min(zone.w, zone.d) / 2 - 0.3, Math.min(zone.w, zone.d) / 2, 48]}
          />
          <meshBasicMaterial color={LIGHT_SCENE_3D.selectionRing} transparent opacity={0.7} />
        </mesh>
      ) : null}
      <Html
        position={[labelX, 0.1, labelZ]}
        center={false}
        distanceFactor={12}
        occlude={false}
        className="off-scene-html-passive"
      >
        <span className="off-scene-zone-label">{zone.label}</span>
      </Html>
    </group>
  );
}

function EmployeeUnit({
  employee,
  x,
  z,
  rotation,
  withDesk,
  running,
  active,
  dragging,
  zones,
  onSelect,
  onHoverZone,
  onDrop,
  onDragState,
}: {
  employee: Employee;
  x: number;
  z: number;
  rotation: number;
  withDesk: boolean;
  running: boolean;
  active: boolean;
  dragging: boolean;
  zones: ZoneDef[];
  onSelect: () => void;
  onHoverZone: (zoneId: string | null) => void;
  onDrop: (result: SceneEmployeeDrop) => void;
  onDragState: (drag: SceneEmployeeDrag | null) => void;
}) {
  const { camera, gl } = useThree();
  const cleanupRef = useRef<(() => void) | null>(null);
  const appearance = useMemo(
    () => resolveAppearance(employee.id, employee.appearance),
    [employee.id, employee.appearance],
  );
  const phase = useMemo(
    () => (employee.id.charCodeAt(employee.id.length - 1) % 10) * 0.6,
    [employee.id],
  );
  const labelSeed = employee.id
    .split('')
    .reduce((total, char, index) => total + char.charCodeAt(0) * (index + 1), 0);
  const labelLane = (labelSeed % 5) - 2;
  const labelTier = Math.floor(labelSeed / 5) % 3;
  const labelX = labelLane * 0.3;
  const labelY = 2.12 + labelTier * 0.18 + Math.abs(labelLane) * 0.06;
  const labelZ = (labelTier - 1) * 0.24 + labelLane * 0.07;
  const labelText = compactSceneEmployeeName(employee.name);
  const labelInteractive = active || running;
  const characterRotation = (rotation * Math.PI) / 180;

  useEffect(
    () => () => {
      cleanupRef.current?.();
    },
    [],
  );

  const beginDrag = (event: PointerEvent | MouseEvent) => {
    if (cleanupRef.current) return;

    const pointerId = 'pointerId' in event ? event.pointerId : null;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    let complete = false;
    let lastPoint: ScenePlacementPoint | null = null;
    let lastClientX = startX;
    let lastClientY = startY;

    const releasePointer = () => {
      try {
        if (pointerId !== null) gl.domElement.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture is best-effort; WebView can release it before cleanup runs.
      }
    };

    const cleanup = () => {
      if (complete) return;
      complete = true;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerCancel);
      document.removeEventListener('mouseup', onMouseUp);
      gl.domElement.removeEventListener('pointerup', onPointerUp);
      gl.domElement.removeEventListener('pointercancel', onPointerCancel);
      gl.domElement.removeEventListener('mouseup', onMouseUp);
      gl.domElement.removeEventListener('lostpointercapture', onLostPointerCapture);
      window.removeEventListener('blur', onPointerCancel);
      releasePointer();
      document.body.style.cursor = '';
      onHoverZone(null);
      onDragState(null);
      cleanupRef.current = null;
    };

    const toGround = (e: PointerEvent | MouseEvent) =>
      groundPointFromClient(e.clientX, e.clientY, gl.domElement, camera, zones);

    const updateDragPreview = (e: PointerEvent | MouseEvent, nextMoved: boolean) => {
      const point = toGround(e);
      lastPoint = point;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      onDragState({
        employeeId: employee.id,
        x: point?.x ?? x,
        z: point?.z ?? z,
        clientX: e.clientX,
        clientY: e.clientY,
        moved: nextMoved,
      });
      return point;
    };

    const onPointerMove = (e: PointerEvent) => {
      e.preventDefault();
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 5) moved = true;
      const point = updateDragPreview(e, moved);
      onHoverZone(moved ? (point?.zoneId ?? null) : null);
    };

    const finishDrop = (e: PointerEvent | MouseEvent) => {
      e.preventDefault();
      const ground = moved ? toGround(e) : null;
      onDrop({
        zoneId: ground?.zoneId ?? null,
        x: ground?.x ?? null,
        z: ground?.z ?? null,
        startX,
        startY,
        endX: e.clientX,
        endY: e.clientY,
        moved,
      });
      cleanup();
    };

    const finishLatestDrop = () => {
      if (complete) return;
      onDrop({
        zoneId: moved ? (lastPoint?.zoneId ?? null) : null,
        x: moved ? (lastPoint?.x ?? null) : null,
        z: moved ? (lastPoint?.z ?? null) : null,
        startX,
        startY,
        endX: lastClientX,
        endY: lastClientY,
        moved,
      });
      cleanup();
    };

    const onPointerUp = (e: PointerEvent) => finishDrop(e);
    const onMouseUp = (e: MouseEvent) => finishDrop(e);
    const onLostPointerCapture = () => finishLatestDrop();
    const onPointerCancel = () => {
      onDrop({
        zoneId: null,
        x: null,
        z: null,
        startX,
        startY,
        endX: startX,
        endY: startY,
        moved,
      });
      cleanup();
    };

    try {
      if (pointerId !== null) gl.domElement.setPointerCapture(pointerId);
    } catch {
      // Window/document listeners still own the drag lifecycle if capture is unavailable.
    }

    onDragState({
      employeeId: employee.id,
      x,
      z,
      clientX: startX,
      clientY: startY,
      moved: false,
    });
    document.body.style.cursor = 'grabbing';
    cleanupRef.current = cleanup;
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('mouseup', onMouseUp);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('mouseup', onMouseUp);
    gl.domElement.addEventListener('pointerup', onPointerUp);
    gl.domElement.addEventListener('pointercancel', onPointerCancel);
    gl.domElement.addEventListener('mouseup', onMouseUp);
    gl.domElement.addEventListener('lostpointercapture', onLostPointerCapture);
    window.addEventListener('blur', onPointerCancel);
  };

  return (
    // Scale the whole unit (character, selection ring, label, fallback desk)
    // together so they stay proportional; the seat position stays unscaled.
    <group position={[x, 0, z]} scale={SCENE_CONTENT_SCALE}>
      {withDesk ? (
        <WorkstationUnit3D position={[0, 0, -1.8]} rotation={0} variant="compact" />
      ) : null}
      {!dragging ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, 0]}>
          <circleGeometry args={[0.46, 34]} />
          <meshBasicMaterial
            color={LIGHT_SCENE_3D.text}
            transparent
            opacity={active ? 0.18 : running ? 0.14 : 0.1}
            depthWrite={false}
          />
        </mesh>
      ) : null}
      {active && !dragging ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <ringGeometry args={[0.52, 0.64, 40]} />
          <meshBasicMaterial color={LIGHT_SCENE_3D.selectionRing} transparent opacity={0.8} />
        </mesh>
      ) : null}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: r3f raycaster on a 3D object; employees are keyboard-selectable via the team dock and thread list */}
      <group
        rotation={[0, characterRotation, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          e.nativeEvent.preventDefault();
          beginDrag(e.nativeEvent);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'grab';
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
        }}
      >
        <mesh position={[0, 1.05, 0]}>
          <boxGeometry args={[1.2, 2.1, 1.2]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        {!dragging ? (
          <BlockCharacter
            appearance={appearance}
            action={active ? 'active' : running ? 'working' : 'idle'}
            running={running}
            phase={phase}
          />
        ) : null}
      </group>
      {!dragging ? (
        <Html
          position={[labelX, labelY, labelZ]}
          center
          distanceFactor={18}
          occlude={false}
          className={labelInteractive ? 'off-scene-html-interactive' : 'off-scene-html-passive'}
        >
          {labelInteractive ? (
            <button
              type="button"
              aria-label={`Open ${employee.name}`}
              title={employee.name}
              className={`off-scene-tag is-interactive${running ? ' is-running' : ''}${
                active ? ' is-active' : ''
              }`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                e.nativeEvent.preventDefault();
                beginDrag(e.nativeEvent);
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                e.nativeEvent.preventDefault();
                beginDrag(e.nativeEvent);
              }}
              onDragStart={(e) => {
                e.preventDefault();
              }}
              draggable={false}
            >
              {labelText}
            </button>
          ) : (
            <span className="off-scene-tag">{labelText}</span>
          )}
        </Html>
      ) : null}
    </group>
  );
}

function EmployeeDragGhost({ employee, drag }: { employee: Employee; drag: SceneEmployeeDrag }) {
  const appearance = useMemo(
    () => resolveAppearance(employee.id, employee.appearance),
    [employee.id, employee.appearance],
  );
  const wobble = Math.sin((drag.clientX + drag.clientY) * 0.035) * 0.16;
  const phase = (drag.clientX + drag.clientY) * 0.012;
  const ghostOpacity = 1;

  return (
    <group position={[drag.x, 0.16, drag.z]} rotation={[0, wobble, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <circleGeometry args={[0.94, 44]} />
        <meshBasicMaterial
          color={LIGHT_SCENE_3D.selectionRing}
          transparent
          opacity={drag.moved ? 0.12 : 0.06}
          depthWrite={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.58, 0.98, 44]} />
        <meshBasicMaterial
          color={LIGHT_SCENE_3D.selectionRing}
          transparent
          opacity={drag.moved ? 0.42 : 0.24}
          depthWrite={false}
        />
      </mesh>
      <group scale={1.5}>
        <BlockCharacter
          appearance={appearance}
          action="dragging"
          running
          phase={phase}
          opacity={ghostOpacity}
        />
      </group>
      {drag.moved ? (
        <Html
          position={[0, 2.64, 0]}
          center
          distanceFactor={17}
          occlude={false}
          className="off-scene-html-passive"
        >
          <span className="off-scene-drag-chip">Move</span>
        </Html>
      ) : null}
    </group>
  );
}

function SceneDropNoticeLabel({ notice }: { notice: SceneDropNotice }) {
  return (
    <Html
      position={[notice.x, 1.15, notice.z]}
      center
      distanceFactor={18}
      occlude={false}
      className="off-scene-html-passive"
    >
      <span className="off-scene-drop-note">{notice.message}</span>
    </Html>
  );
}

/** Synthetic furniture for the fallback layout (no real prefab instances). */
function FallbackFurniture() {
  return (
    <group scale={SCENE_CONTENT_SCALE}>
      <WorkstationUnit3D position={[-14.8, 0, 8.6]} rotation={0} variant="dual" />
      <WorkstationUnit3D position={[-2.7, 0, 9.0]} rotation={0} />
      <WorkstationUnit3D position={[10.4, 0, 9.0]} rotation={0} variant="dual" />
      <BookshelfMesh3D position={[-15.7, 0, -2.1]} rotation={0} template="bookshelf-double" />
      <BookshelfMesh3D position={[-7.0, 0, -2.1]} rotation={0} template="bookshelf-double" />
      <BookshelfMesh3D position={[-11.3, 0, 1.2]} rotation={0} template="reading-table" />
      <RestAreaMesh3D position={[3.5, 0, 0.2]} rotation={0} />
      <DecorativeMesh3D position={[7.8, 0, -0.6]} rotation={0} template="coffee-table" />
      <DecorativeMesh3D position={[11.5, 0, -2.1]} rotation={180} template="water-cooler" />
      <MeetingTableMesh3D position={[-9.4, 0, -8.45]} rotation={0} capacity={8} />
      <WhiteboardMesh3D position={[-9.4, 0, -11.7]} rotation={0} />
      <ServerRackUnit3D position={[6.2, 0, -9.2]} rotation={0} heightScale={1.24} />
      <ServerRackUnit3D position={[9.4, 0, -9.2]} rotation={0} />
      <ServerRackUnit3D position={[12.6, 0, -9.2]} rotation={0} heightScale={1.24} />
      <DecorativeMesh3D position={[-18.2, 0, 14.0]} rotation={0} template="plant-large" />
      <DecorativeMesh3D position={[17.2, 0, 14.0]} rotation={0} template="plant-large" />
    </group>
  );
}

export function OfficeScene3D({
  placementEnabled = false,
  placementProbe = null,
  onPlacementPoint,
  selectedPrefabId = null,
  onPrefabSelect,
  onPrefabMove,
}: OfficeScene3DProps) {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const openThread = useUiState((s) => s.openThread);
  const closeThread = useUiState((s) => s.closeThread);
  const recordSceneDropDiagnostic = useUiState((s) => s.recordSceneDropDiagnostic);
  const employees = useEmployees();
  const threads = useThreads(projectId);
  const layout = useOfficeLayout(companyId);
  const reassign = useReassignEmployee();
  const [employeeDrag, setEmployeeDrag] = useState<SceneEmployeeDrag | null>(null);
  const [prefabDrag, setPrefabDrag] = useState<{ instanceId: string } | null>(null);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const [placementZoneId, setPlacementZoneId] = useState<string | null>(null);
  const [dropNotice, setDropNotice] = useState<SceneDropNotice | null>(null);

  const real = layout.data ?? null;
  const liveThread = threads.data?.find((t) => t.runState === 'running');
  const roster = employees.data ?? [];

  const zoneDefs: ZoneDef[] = useMemo(() => zoneDefsFromLayout(real), [real]);
  const scenePrefabs = useMemo(
    () => relaxedScenePrefabs(real?.prefabs, zoneDefs),
    [real?.prefabs, zoneDefs],
  );

  const defaultEmployeeZone = useMemo(() => resolveDefaultEmployeeZone(zoneDefs), [zoneDefs]);

  const placementsByEmployee = useMemo(
    () => employeePlacements(roster, zoneDefs, defaultEmployeeZone, scenePrefabs),
    [defaultEmployeeZone, roster, scenePrefabs, zoneDefs],
  );

  const threadByEmployee = useMemo(() => {
    const map = new Map<string, NonNullable<typeof threads.data>[number]>();
    for (const t of threads.data ?? []) {
      if (t.employeeId && !map.has(t.employeeId)) map.set(t.employeeId, t);
    }
    return map;
  }, [threads.data]);
  const draggedEmployee = employeeDrag
    ? (roster.find((employee) => employee.id === employeeDrag.employeeId) ?? null)
    : null;

  useEffect(() => {
    if (!dropNotice) return;
    const timer = window.setTimeout(() => setDropNotice(null), 1400);
    return () => window.clearTimeout(timer);
  }, [dropNotice]);

  return (
    <Canvas
      shadows="soft"
      dpr={[1, 1.75]}
      // Keep R3F's default `frameloop="always"`. We tried "demand" to save
      // idle CPU but BlockCharacter.useFrame mutates `group.position.y`
      // directly via refs (idle bob, walk bob) and never invalidates, so
      // demand mode froze every employee's animation. ServerRack LOD checks
      // similarly run in useFrame without setState. Re-enable demand only
      // alongside an invalidate() in those useFrame consumers.
      camera={{ position: OFFICE_CAMERA_PRESET.position, fov: OFFICE_CAMERA_PRESET.fov }}
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 0.92 }}
      className="off-scene-canvas"
    >
      <color attach="background" args={[LIGHT_SCENE_3D.sceneBackground]} />

      <SceneLighting />
      <SceneEnvironment />
      <RoomShell onFloorClick={placementEnabled ? undefined : closeThread} />

      {zoneDefs.map((zone) => (
        <ZoneRug
          key={zone.id}
          zone={zone}
          highlight={
            (employeeDrag !== null && hoveredZoneId === zone.id) ||
            (prefabDrag !== null && hoveredZoneId === zone.id) ||
            (placementEnabled && placementZoneId === zone.id)
          }
        />
      ))}

      {placementEnabled && onPlacementPoint ? (
        <PlacementController
          zones={zoneDefs}
          onHover={setPlacementZoneId}
          onPick={onPlacementPoint}
        />
      ) : null}

      {placementProbe && onPlacementPoint ? (
        <ExternalPlacementController
          zones={zoneDefs}
          probe={placementProbe}
          onHover={setPlacementZoneId}
          onPick={onPlacementPoint}
        />
      ) : null}

      {real ? (
        scenePrefabs?.map(({ instance, definition }) => (
          <ScenePrefabInstance3D
            key={instance.instance_id}
            instance={instance}
            definition={definition}
            zones={zoneDefs}
            selected={selectedPrefabId === instance.instance_id}
            onSelect={onPrefabSelect}
            onMove={onPrefabMove}
            onHoverZone={setHoveredZoneId}
            onDragState={setPrefabDrag}
          />
        ))
      ) : (
        <FallbackFurniture />
      )}

      {roster.map((employee) => {
        const placement = placementsByEmployee.get(employee.id) ?? {
          x: defaultEmployeeZone.cx,
          z: defaultEmployeeZone.cz,
          rotation: 0,
        };
        const thread = threadByEmployee.get(employee.id);
        const running =
          thread?.runState === 'running' || (liveThread?.scope === 'team' && employee.online);
        return (
          <EmployeeUnit
            key={employee.id}
            employee={employee}
            x={placement.x}
            z={placement.z}
            rotation={placement.rotation}
            withDesk={!real}
            running={running}
            active={Boolean(thread && thread.id === selectedThreadId)}
            dragging={employeeDrag?.employeeId === employee.id}
            zones={zoneDefs}
            onSelect={() => thread && openThread(thread.id)}
            onHoverZone={setHoveredZoneId}
            onDragState={setEmployeeDrag}
            onDrop={(result) => {
              if (result.zoneId)
                reassign.mutate({ employeeId: employee.id, zoneId: result.zoneId });
              recordSceneDropDiagnostic({
                id: `drop-${crypto.randomUUID()}`,
                at: new Date().toISOString(),
                employeeId: employee.id,
                startX: result.startX,
                startY: result.startY,
                endX: result.endX,
                endY: result.endY,
                targetZoneId: result.zoneId,
                decision: result.zoneId ? 'assigned' : result.moved ? 'missed' : 'not-moved',
              });
              if (result.moved && !result.zoneId) {
                setDropNotice({
                  id: `drop-note-${crypto.randomUUID()}`,
                  x: result.x ?? placement.x,
                  z: result.z ?? placement.z,
                  message: 'Drop on a zone',
                });
              }
            }}
          />
        );
      })}

      {employeeDrag && draggedEmployee ? (
        <EmployeeDragGhost employee={draggedEmployee} drag={employeeDrag} />
      ) : null}
      {dropNotice ? <SceneDropNoticeLabel key={dropNotice.id} notice={dropNotice} /> : null}

      {/* Free orbit camera: drag to rotate, two-finger / right-drag to pan,
          scroll to zoom. Damped for a premium feel. Polar clamps keep the user
          above the floor plane; OrbitControls is suspended mid-drag so employee
          and prefab dragging keep the camera still. */}
      <OrbitControls
        makeDefault
        target={OFFICE_CAMERA_PRESET.target}
        enabled={!employeeDrag && !prefabDrag && !placementEnabled}
        enableRotate
        enablePan
        enableDamping
        dampingFactor={0.075}
        minDistance={OFFICE_CAMERA_PRESET.minDistance}
        maxDistance={OFFICE_CAMERA_PRESET.maxDistance}
        minPolarAngle={OFFICE_CAMERA_PRESET.minPolarAngle}
        maxPolarAngle={OFFICE_CAMERA_PRESET.maxPolarAngle}
      />
      <ScenePostFx />
    </Canvas>
  );
}
