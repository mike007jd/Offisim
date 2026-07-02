import { useUiState } from '@/app/ui-state.js';
import { useConversationRun } from '@/assistant/runtime/conversation-run-react.js';
import { usePrefersReducedMotion } from '@/assistant/runtime/office-dramaturgy.js';
import {
  type FlowCueTarget,
  type SceneInk,
  type WorkloadCue,
  bundleEmphasis,
} from '@/assistant/runtime/scene-cue-projection.js';
import { useSceneCueFrame } from '@/assistant/runtime/scene-cue-react.js';
import { useReassignEmployee } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { resolveAppearance } from '@/lib/avatar.js';
import { openArtifactClaim } from '@/surfaces/office/stage-viewer/artifact-claim.js';
import {
  type CharacterPerformanceState,
  type PrefabDefinition,
  type PrefabInstanceRow,
  type RoleSlug,
  animationTempoForRole,
} from '@offisim/shared-types';
import { Html, Line, OrbitControls } from '@react-three/drei';
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
import { type EmployeePosture, type ZoneDef, rotateLocal } from './scene-layout.js';
import { useSceneStagingInputs } from './use-scene-staging-inputs.js';
import { WorkBench } from './work-bench/WorkBench.js';

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

interface SceneFlowLine {
  readonly id: string;
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
  readonly color: string;
  readonly label: string;
  /** 1.6px base + the shared bundleEmphasis step (+1 when the cue bundles ≥2 signals). */
  readonly lineWidth: number;
}

/**
 * THE one 3D ink→hex table: every SceneCue ink role maps to exactly one
 * LIGHT_SCENE_3D token. Approval is the amber LED tone — never the risk hue
 * (PRD) — and neutral is the quiet muted-text tone used for recovery signals.
 */
const INK_3D: Record<SceneInk, string> = {
  work: LIGHT_SCENE_3D.selectionRing,
  artifact: LIGHT_SCENE_3D.ghostValid,
  risk: LIGHT_SCENE_3D.ghostBlocked,
  approval: LIGHT_SCENE_3D.ledAmber,
  neutral: LIGHT_SCENE_3D.textMuted,
};

function flowTarget3D(target: FlowCueTarget) {
  switch (target) {
    case 'delivery':
      return [14.8, 0.1, 12.4] as const;
    case 'tool':
      return [10.4, 0.1, -9.0] as const;
    case 'review':
      return [-6.4, 0.1, -7.4] as const;
    case 'user':
      return [0, 0.1, 13.4] as const;
    default:
      return [0, 0.1, 0] as const;
  }
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
  workload,
  reducedMotion,
  active,
  dragging,
  performance,
  zones,
  onSelect,
  onDrilldown,
  onHoverChange,
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
  workload: WorkloadCue | null;
  reducedMotion: boolean;
  active: boolean;
  dragging: boolean;
  performance?: CharacterPerformanceState;
  zones: ZoneDef[];
  onSelect: () => void;
  onDrilldown: () => void;
  onHoverChange: (hovered: boolean) => void;
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: this effect only seeds the initial mount position on first render; x/z are intentionally excluded (subsequent moves animate via useFrame using targetRef). Adding x/z would re-snap the position every move, defeating the glide animation.
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
    () => animationTempoForRole((employee.roleSlug ?? 'developer') as RoleSlug),
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
  // The tag is interactive when selectable/running; the Html host also needs
  // pointer events when the workload bubble carries a clickable badge/marker/
  // chip row (drilldown) even if the actor itself is idle.
  const hasClickableWorkload =
    workload != null &&
    (workload.countLabel != null || workload.topIssue != null || workload.chips.length > 0);
  const labelInteractive = active || running;
  const htmlInteractive = labelInteractive || hasClickableWorkload;
  // Blocked primary slot (PRD): a blocked-severity issue owns the bubble — the
  // marker takes the primary (top-right) slot, the ×N count demotes to the
  // secondary (top-left) slot, and the working tell (typing dots + working
  // halo) never renders over the blocked actor.
  const blocked = workload?.primary === 'issue';
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
          // Feed the scene's hover state so the shared frame's ActorCue.hovered
          // carries it (the cue is the source; no per-scene hover derivation).
          onHoverChange(true);
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
          onHoverChange(false);
        }}
      >
        <mesh position={[0, 1.05, 0]}>
          <boxGeometry args={[1.2, 2.1, 1.2]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        {!dragging ? (
          <BlockCharacter
            appearance={appearance}
            action={active ? 'active' : running && !blocked ? 'working' : 'idle'}
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
          className={htmlInteractive ? 'off-scene-html-interactive' : 'off-scene-html-passive'}
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
            {/* The frame's WorkloadCue drives the ×N badge, the resource-marker
                hierarchy, and the chip row, in lockstep with the 2D scene. When
                the cue's primary slot is 'issue' the marker and badge swap
                slots (blocked wins the primary top-right position). All static
                (deterministic): no motion-only signal, so reduced motion
                changes nothing here. */}
            {workload?.countLabel ? (
              <button
                type="button"
                className={`off-scene-count-badge is-interactive${blocked ? ' is-secondary' : ''}`}
                aria-label={`${workload.activeCount} active runs — inspect workload`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDrilldown();
                }}
              >
                {workload.countLabel}
              </button>
            ) : null}
            {workload?.topIssue ? (
              <span
                className={`off-scene-resource-marker is-${workload.topIssue.severity}${
                  blocked ? ' is-primary' : ''
                }`}
                aria-label={workload.topIssue.label}
              >
                !
              </span>
            ) : null}
            {workload && workload.chips.length > 0 ? (
              <div className="off-scene-workload-bubble" aria-label="Workload">
                {workload.chips.map((chip) => (
                  <span
                    key={`${chip.tone}:${chip.label}`}
                    className={`is-${chip.tone}`}
                    title={chip.count != null ? `${chip.label} ${chip.count}` : chip.label}
                  >
                    {workload.tier === 'small'
                      ? chip.label.slice(0, 10)
                      : chip.count != null
                        ? `${chip.label} ${chip.count}`
                        : chip.label}
                  </span>
                ))}
                {workload.overflow ? (
                  <button
                    type="button"
                    className="off-scene-workload-overflow is-interactive"
                    aria-label="More workload — inspect"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDrilldown();
                    }}
                  >
                    +…
                  </button>
                ) : null}
              </div>
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
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const openThread = useUiState((s) => s.openThread);
  const closeThread = useUiState((s) => s.closeThread);
  const openStageView = useUiState((s) => s.openStageView);
  const openWorkloadDrilldown = useUiState((s) => s.openWorkloadDrilldown);
  const recordSceneDropDiagnostic = useUiState((s) => s.recordSceneDropDiagnostic);
  const selectedRun = useConversationRun(selectedThreadId ?? '');
  const reassign = useReassignEmployee();
  const [employeeDrag, setEmployeeDrag] = useState<SceneEmployeeDrag | null>(null);
  const [hoveredEmployeeId, setHoveredEmployeeId] = useState<string | null>(null);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const [dropNotice, setDropNotice] = useState<SceneDropNotice | null>(null);

  // Shared staging inputs — the same layout/roster/seat-planner facts the 2D
  // scene and the drilldown read (never re-derived per scene).
  const {
    layoutData,
    roster,
    zoneDefs,
    fallbackZone: defaultEmployeeZone,
    positions: placementsByEmployee,
    stagingPrefabs,
  } = useSceneStagingInputs();
  const real = layoutData ?? null;
  // Only reachable with a real backend layout that has zero zones — the
  // no-backend preview path always resolves to the non-empty FALLBACK_ZONES.
  // OfficeStage owns the "No office layout yet" overlay (so Studio mounts of
  // this scene never see it); here zero zones just means zero seats.
  const emptyOffice = zoneDefs.length === 0;
  const scenePrefabs = real?.prefabs;

  // BlockCharacter's reducedMotion prop path (static poses) is a render
  // concern; the frame separately carries staging=null under reduced motion.
  const reducedMotion = usePrefersReducedMotion();

  // THE render contract: one SceneCueFrame per render, shared with the 2D
  // scene and the drilldown. Staging, performance, flows, delivery, workload
  // bubbles, and selection all come from here — along with the shared
  // actorById index; hover + drag feed its input state so the cues carry
  // them. Only world geometry stays local.
  const { frame, actorById } = useSceneCueFrame({
    prefabs: stagingPrefabs,
    actorPositions: placementsByEmployee,
    hoveredEmployeeId,
    draggingEmployeeId: employeeDrag?.employeeId ?? null,
  });
  const deliveryLatest = frame.delivery.latest;

  const sceneFlowLines = useMemo<SceneFlowLine[]>(
    () =>
      frame.flows.map((cue) => {
        const home = placementsByEmployee.get(cue.employeeId) ?? {
          x: defaultEmployeeZone.cx,
          z: defaultEmployeeZone.cz,
        };
        const staging = actorById.get(cue.employeeId)?.staging;
        const fromX = staging?.x ?? home.x;
        const fromZ = staging?.z ?? home.z;
        return {
          id: `${cue.employeeId}|${cue.target}|${cue.kind}`,
          from: [fromX, 0.12, fromZ] as const,
          to: flowTarget3D(cue.target),
          color: INK_3D[cue.ink],
          label: cue.label,
          lineWidth: 1.6 + bundleEmphasis(cue),
        };
      }),
    [actorById, defaultEmployeeZone, placementsByEmployee, frame.flows],
  );

  const draggedEmployee = employeeDrag
    ? (roster.find((employee) => employee.id === employeeDrag.employeeId) ?? null)
    : null;
  const selectedWorkBenchEntry = useMemo(
    () => [...selectedRun.activity].reverse().find((entry) => entry.richDetail) ?? null,
    [selectedRun.activity],
  );

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
              // Every runtime fact for this actor comes from its cue: running,
              // selection, drag, the workload bubble, staging, performance.
              const cue = actorById.get(employee.id);
              const running = cue?.running ?? false;
              const workload = cue?.workload ?? null;
              // High-value movement beats relocate the actor to a reserved
              // anchor; everything else stays at the home placement (and only
              // the performance changes).
              const anchor = cue?.staging ?? null;
              const relocated = anchor != null && anchor.x != null && anchor.z != null;
              const target = relocated
                ? {
                    x: anchor.x as number,
                    z: anchor.z as number,
                    rotation: anchor.facing ?? placement.rotation,
                    posture: (anchor.posture ?? placement.posture) as EmployeePosture,
                  }
                : placement;
              // Unstaged actors carry performance: null (the cue contract);
              // map null to undefined so BlockCharacter's legacy action-driven
              // pose path (idle bob, active swivel) stays byte-identical.
              const performance = cue?.performance ?? undefined;
              const threadId = cue?.threadId ?? null;
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
                  workload={workload}
                  reducedMotion={reducedMotion}
                  active={cue?.selected ?? false}
                  dragging={cue?.dragging ?? false}
                  performance={performance}
                  zones={zoneDefs}
                  onSelect={() => threadId && openThread(threadId)}
                  onDrilldown={() => openWorkloadDrilldown(employee.id)}
                  onHoverChange={(hovered) =>
                    setHoveredEmployeeId((prev) =>
                      hovered ? employee.id : prev === employee.id ? null : prev,
                    )
                  }
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
        {sceneFlowLines.map((line) => (
          <Fragment key={line.id}>
            <Line
              points={[line.from, line.to]}
              color={line.color}
              lineWidth={line.lineWidth}
              transparent
              opacity={0.58}
            />
          </Fragment>
        ))}
        {deliveryLatest ? (
          <Html
            position={flowTarget3D('delivery')}
            center
            distanceFactor={18}
            occlude={false}
            zIndexRange={[3, 0]}
            className="off-scene-html-interactive"
          >
            {/* Interactive delivery shelf — reads the frame's delivery cue: ×N
                from recentCount, click target from `latest` (same claim path
                as the 2D scene). */}
            <button
              type="button"
              className="off-scene-delivery-shelf is-interactive"
              aria-label={`Open delivery — ${deliveryLatest.title}`}
              onClick={() => {
                void openArtifactClaim(deliveryLatest, { openStageView, projectId });
              }}
            >
              <span>Delivery</span>
              <b>{frame.delivery.recentCount}</b>
            </button>
          </Html>
        ) : null}

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
      {selectedThreadId && selectedWorkBenchEntry?.richDetail ? (
        <button
          type="button"
          className="off-scene-work-bench-peek off-focusable"
          aria-label="Open selected employee work bench"
          onClick={() => {
            const detail = selectedWorkBenchEntry.richDetail;
            if (!detail) return;
            if (detail.family === 'browser') {
              openStageView({
                kind: 'preview',
                sourceId: selectedWorkBenchEntry.id,
                title: detail.title ?? selectedWorkBenchEntry.tool,
                url: detail.url,
                detail,
              });
              return;
            }
            openStageView({
              kind: 'logs',
              sourceId: selectedWorkBenchEntry.id,
              title: selectedWorkBenchEntry.tool,
              tool: selectedWorkBenchEntry.tool,
              status: selectedWorkBenchEntry.state,
              detail,
            });
          }}
        >
          <div className="off-scene-work-bench-label">{selectedWorkBenchEntry.tool}</div>
          <WorkBench
            detail={selectedWorkBenchEntry.richDetail}
            status={selectedWorkBenchEntry.state}
            compact
          />
        </button>
      ) : null}
    </>
  );
}
