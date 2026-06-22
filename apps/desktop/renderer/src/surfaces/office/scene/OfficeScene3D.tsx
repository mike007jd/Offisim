import { useUiState } from '@/app/ui-state.js';
import {
  dominantBeatsFrom,
  useEmployeeWorkloads,
} from '@/assistant/runtime/conversation-run-react.js';
import { usePrefersReducedMotion } from '@/assistant/runtime/office-dramaturgy.js';
import { useEmployees, useOfficeLayout, useReassignEmployee, useThreads } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { resolveAppearance } from '@/lib/avatar.js';
import {
  type CharacterPerformanceState,
  type PrefabDefinition,
  type PrefabInstanceRow,
  type RoleSlug,
  type StagingPrefab,
  applyDramaturgyMode,
  defaultEmployeePerformanceProfile,
  projectOfficeStaging,
} from '@offisim/shared-types';
import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ACESFilmicToneMapping, type Group } from 'three';
import { BlockCharacter } from './BlockCharacter.js';
import { RoomShell } from './r3d/RoomShell.js';
import { SceneEnvironment } from './r3d/SceneEnvironment.js';
import { SceneLighting } from './r3d/SceneLighting.js';
import { ScenePostFx } from './r3d/ScenePostFx.js';
import { ZoneCeilingLight, ZoneRug } from './r3d/ZoneDressing.js';
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
import { type ScenePlacementPoint, groundPointFromClient } from './scene-ground.js';
import { compactSceneEmployeeName } from './scene-labels.js';
import {
  type EmployeePosture,
  type ZoneDef,
  employeePlacements,
  defaultEmployeeZone as resolveDefaultEmployeeZone,
  rotateLocal,
  zoneDefsFromLayout,
} from './scene-layout.js';

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

/** Display-only placed prefab. All editing now lives in StudioScene3D. */
function ScenePrefabInstance3D({
  instance,
  definition,
}: {
  instance: PrefabInstanceRow;
  definition: PrefabDefinition;
}) {
  return (
    // SCENE_CONTENT_SCALE lives on the placement group (not a single scene-wide
    // root) on purpose: `position` stays in stored authoring coordinates while
    // ground raycasts hit the world-space y=0 plane, so scaling here keeps
    // stored coords == world coords.
    <group
      position={[instance.position_x, 0, instance.position_y]}
      rotation={[0, (instance.rotation * Math.PI) / 180, 0]}
      scale={SCENE_CONTENT_SCALE}
    >
      <Prefab3D definition={definition} />
    </group>
  );
}

function EmployeeUnit({
  employee,
  x,
  z,
  rotation,
  posture,
  withDesk,
  running,
  activeCount,
  reducedMotion,
  active,
  dragging,
  performance,
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
  posture: EmployeePosture;
  withDesk: boolean;
  running: boolean;
  activeCount: number;
  reducedMotion: boolean;
  active: boolean;
  dragging: boolean;
  performance?: CharacterPerformanceState;
  zones: ZoneDef[];
  onSelect: () => void;
  onHoverZone: (zoneId: string | null) => void;
  onDrop: (result: SceneEmployeeDrop) => void;
  onDragState: (drag: SceneEmployeeDrag | null) => void;
}) {
  const { camera, gl } = useThree();
  // Smoothly glide to the target (home placement or a high-value staged anchor)
  // rather than snapping; `walkingRef` flips on the walk locomotion in transit.
  const unitRef = useRef<Group>(null);
  const walkingRef = useRef(false);
  const targetRef = useRef<[number, number]>([x, z]);
  targetRef.current = [x, z];
  useLayoutEffect(() => {
    unitRef.current?.position.set(x, 0, z);
    // Only seed the initial mount position; subsequent moves animate in useFrame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame((_, delta) => {
    const group = unitRef.current;
    if (!group) return;
    const [tx, tz] = targetRef.current;
    const dx = tx - group.position.x;
    const dz = tz - group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.04) {
      const step = Math.min(1, (1.9 * delta) / dist);
      group.position.x += dx * step;
      group.position.z += dz * step;
      walkingRef.current = dist > 0.12;
    } else {
      walkingRef.current = false;
    }
  });
  const cleanupRef = useRef<(() => void) | null>(null);
  const appearance = useMemo(
    () => resolveAppearance(employee.id, employee.appearance),
    [employee.id, employee.appearance],
  );
  // Employee performance profile flavor — tempo scales animation speed only.
  const tempo = useMemo(
    () => defaultEmployeePerformanceProfile((employee.roleSlug ?? 'developer') as RoleSlug).tempo,
    [employee.roleSlug],
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
  // One desk-depth-ish step along the character's facing (prefab-local +z).
  const fallbackDeskOffset = rotateLocal(0, 0.99, rotation);

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
    <group ref={unitRef} scale={SCENE_CONTENT_SCALE}>
      {withDesk ? (
        // Fallback desk sits in front of the character (along their facing) and
        // turns its chair side toward them, so they read as seated at it.
        <WorkstationUnit3D
          position={[fallbackDeskOffset[0], 0, fallbackDeskOffset[1]]}
          rotation={rotation + 180}
          variant="compact"
        />
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
            posture={posture}
            running={running}
            reducedMotion={reducedMotion}
            performance={performance}
            walkingRef={walkingRef}
            tempo={tempo}
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
          zIndexRange={[2, 0]}
          className={labelInteractive ? 'off-scene-html-interactive' : 'off-scene-html-passive'}
        >
          {/* Relative wrapper so the active-count badge can sit at the tag's
              top-right corner without being clipped by the tag's overflow. */}
          <div className="off-scene-actor">
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
            {activeCount > 1 ? (
              <span className="off-scene-count-badge" aria-label={`${activeCount} active runs`}>
                {`×${activeCount}`}
              </span>
            ) : null}
          </div>
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
          zIndexRange={[2, 0]}
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
      zIndexRange={[2, 0]}
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

export function OfficeScene3D() {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const openThread = useUiState((s) => s.openThread);
  const closeThread = useUiState((s) => s.closeThread);
  const recordSceneDropDiagnostic = useUiState((s) => s.recordSceneDropDiagnostic);
  const employees = useEmployees();
  const threads = useThreads(projectId);
  const workloads = useEmployeeWorkloads(projectId, companyId);
  const layout = useOfficeLayout(companyId);
  const reassign = useReassignEmployee();
  const [employeeDrag, setEmployeeDrag] = useState<SceneEmployeeDrag | null>(null);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const [dropNotice, setDropNotice] = useState<SceneDropNotice | null>(null);

  const real = layout.data ?? null;
  const roster = employees.data ?? [];

  const zoneDefs: ZoneDef[] = useMemo(() => zoneDefsFromLayout(real), [real]);
  // Only reachable with a real backend layout that has zero zones — the
  // no-backend preview path always resolves to the non-empty FALLBACK_ZONES.
  // OfficeStage owns the "No office layout yet" overlay (so Studio mounts of
  // this scene never see it); here zero zones just means zero seats.
  const emptyOffice = zoneDefs.length === 0;
  const scenePrefabs = real?.prefabs;

  const defaultEmployeeZone = useMemo(() => resolveDefaultEmployeeZone(zoneDefs), [zoneDefs]);

  const placementsByEmployee = useMemo(
    () => employeePlacements(roster, zoneDefs, defaultEmployeeZone, scenePrefabs),
    [defaultEmployeeZone, roster, scenePrefabs, zoneDefs],
  );

  // Live dramaturgy: the agent.run beat timeline → per-employee performance and
  // (for high-value movement beats only) a reserved relocation anchor on the
  // office's real prefab layout. Empty when nothing is running. Staging reads the
  // dominant beat of each employee's dominant ACTIVE run (the same workload truth
  // that lights the ring + badge), so a just-finished run never stages over a
  // still-running one, and 2D/3D agree on the staged target.
  const dominantBeats = useMemo(() => dominantBeatsFrom(workloads), [workloads]);
  const stagingPrefabs = useMemo<StagingPrefab[]>(
    () =>
      (scenePrefabs ?? []).map((p) => ({
        instanceId: p.instance.instance_id,
        prefabId: p.instance.prefab_id,
        x: p.instance.position_x,
        z: p.instance.position_y,
        rotation: p.instance.rotation,
        // 3D draws each prefab in a SCENE_CONTENT_SCALE group, so anchor offsets
        // scale with it — the actor lands on the scaled desk, matching the
        // home-seat planner (which also scales). 2D scales identically below.
        scale: SCENE_CONTENT_SCALE,
      })),
    [scenePrefabs],
  );
  const officeMode = useUiState((s) => s.officeMode);
  const reducedMotion = usePrefersReducedMotion();
  const dramaturgyByEmployee = useMemo(
    () =>
      new Map(
        applyDramaturgyMode(
          projectOfficeStaging(dominantBeats, stagingPrefabs, placementsByEmployee),
          {
            mode: officeMode,
            reducedMotion,
          },
        ).map((d) => [d.employeeId, d]),
      ),
    [dominantBeats, stagingPrefabs, placementsByEmployee, officeMode, reducedMotion],
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
    <>
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
        gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.02 }}
        className="off-scene-canvas"
      >
        <color attach="background" args={[LIGHT_SCENE_3D.sceneBackground]} />

        <SceneLighting />
        <SceneEnvironment />
        <RoomShell onFloorClick={closeThread} />

        {zoneDefs.map((zone) => (
          <Fragment key={zone.id}>
            <ZoneRug zone={zone} highlight={employeeDrag !== null && hoveredZoneId === zone.id} />
            <ZoneCeilingLight zone={zone} />
          </Fragment>
        ))}

        {real ? (
          scenePrefabs?.map(({ instance, definition }) => (
            <ScenePrefabInstance3D
              key={instance.instance_id}
              instance={instance}
              definition={definition}
            />
          ))
        ) : (
          <FallbackFurniture />
        )}

        {/* Zero zones → zero seats: an honest empty office renders nobody, so
            the synthetic default-zone placement fallback below stays unused. */}
        {emptyOffice
          ? null
          : roster.map((employee) => {
              const placement = placementsByEmployee.get(employee.id) ?? {
                x: defaultEmployeeZone.cx,
                z: defaultEmployeeZone.cz,
                rotation: 0,
                posture: 'standing' as const,
              };
              const thread = threadByEmployee.get(employee.id);
              const workload = workloads.get(employee.id);
              const activeCount = workload?.activeCount ?? 0;
              const running = activeCount > 0;
              // High-value movement beats relocate the actor to a reserved
              // anchor; everything else stays at the home placement (and only
              // the performance changes).
              const dram = dramaturgyByEmployee.get(employee.id);
              const anchor = dram?.staging;
              const relocated = anchor != null && anchor.x != null && anchor.z != null;
              const target = relocated
                ? {
                    x: anchor.x as number,
                    z: anchor.z as number,
                    rotation: anchor.facing ?? placement.rotation,
                    posture: (anchor.posture ?? placement.posture) as EmployeePosture,
                  }
                : placement;
              return (
                <EmployeeUnit
                  key={employee.id}
                  employee={employee}
                  x={target.x}
                  z={target.z}
                  rotation={target.rotation}
                  posture={!real ? 'sitting' : target.posture}
                  withDesk={!real}
                  running={running}
                  activeCount={activeCount}
                  reducedMotion={reducedMotion}
                  active={Boolean(thread && thread.id === selectedThreadId)}
                  dragging={employeeDrag?.employeeId === employee.id}
                  performance={dram?.performance}
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
          enabled={!employeeDrag}
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
    </>
  );
}
