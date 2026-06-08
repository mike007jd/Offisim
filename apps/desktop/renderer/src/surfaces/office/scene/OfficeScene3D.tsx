import { useUiState } from '@/app/ui-state.js';
import { useEmployees, useOfficeLayout, useReassignEmployee, useThreads } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { resolveAppearance } from '@/lib/avatar.js';
import type { PrefabDefinition, PrefabInstanceRow } from '@offisim/shared-types';
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
  return (
    <group position={[zone.cx, 0, zone.cz]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 0]} receiveShadow>
        <planeGeometry args={[zone.w, zone.d]} />
        <meshStandardMaterial
          color={highlight ? LIGHT_SCENE_3D.selectionRing : zoneTint(zone.archetype)}
          roughness={0.95}
          transparent
          opacity={highlight ? 0.32 : 0.5}
        />
      </mesh>
      {highlight ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry
            args={[Math.min(zone.w, zone.d) / 2 - 0.3, Math.min(zone.w, zone.d) / 2, 48]}
          />
          <meshBasicMaterial color={LIGHT_SCENE_3D.selectionRing} transparent opacity={0.7} />
        </mesh>
      ) : null}
      <Html
        position={[-zone.w / 2 + 0.5, 0.05, -zone.d / 2 + 0.5]}
        center={false}
        distanceFactor={22}
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
          className="off-scene-html-interactive"
        >
          <button
            type="button"
            aria-label={`Open ${employee.name}`}
            title={employee.name}
            className={`off-scene-tag is-interactive${running ? ' is-running' : ''}`}
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
      <MeetingTableMesh3D position={[8.5, 0, -8.5]} rotation={0} capacity={8} />
      <ServerRackUnit3D position={[1, 0, -13]} rotation={0} heightScale={1.24} />
      <ServerRackUnit3D position={[-1, 0, -13]} rotation={0} />
      <BookshelfMesh3D position={[-12.5, 0, -12.5]} rotation={0} template="bookshelf-double" />
      <RestAreaMesh3D position={[7.5, 0, 8]} rotation={0} />
      <DecorativeMesh3D position={[12.5, 0, 11]} rotation={0} template="plant-large" />
      <DecorativeMesh3D position={[3.5, 0, 11]} rotation={0} template="plant-small" />
      <WhiteboardMesh3D position={[8.5, 0, -14]} rotation={0} />
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

  const defaultEmployeeZone = useMemo(() => resolveDefaultEmployeeZone(zoneDefs), [zoneDefs]);

  const placementsByEmployee = useMemo(
    () => employeePlacements(roster, zoneDefs, defaultEmployeeZone, real?.prefabs),
    [defaultEmployeeZone, real?.prefabs, roster, zoneDefs],
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
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
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
        real.prefabs.map(({ instance, definition }) => (
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
