import { useUiState } from '@/app/ui-state.js';
import { useConversationRun } from '@/assistant/runtime/conversation-run-react.js';
import { usePrefersReducedMotion } from '@/assistant/runtime/office-dramaturgy.js';
import {
  FLOW_TARGET_LABELS,
  type FlowCueTarget,
  RESOURCE_KIND_GLYPHS,
  type SceneInk,
  type WorkloadCue,
  bundleEmphasis,
  flowCueText,
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
  type ResourceKind,
  type RoleSlug,
  animationTempoForRole,
} from '@offisim/shared-types';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Fragment, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ACESFilmicToneMapping, type Group } from 'three';
import { GltfCharacter } from './character/GltfCharacter.js';
import { preloadCharacterAssets } from './character/character-assets.js';
import { openDeliveryHistory } from './delivery-history.js';
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
  floorBounds,
  rotateLocal,
  sceneObstacles,
} from './scene-layout.js';
import {
  type OfficePathfinder,
  type PathPoint,
  buildOfficePathfinder,
} from './scene-pathfinding.js';
import { useSceneStagingInputs } from './use-scene-staging-inputs.js';
import { WorkBench } from './work-bench/WorkBench.js';

// Warm the glTF loader cache the moment the scene module loads so first paint
// gets all character bodies/animations/accessories in parallel instead of a
// per-suspend waterfall (the Personnel preview shares the same cache).
preloadCharacterAssets();

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
  /** Lane density text (the shared flowCueText rule: `×N · label` for bundles). */
  readonly label: string;
  /** Lane label anchor — the curve midpoint, stacked when lanes share endpoints. */
  readonly labelPosition: readonly [number, number, number];
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
  resourceKind,
  reducedMotion,
  active,
  attention,
  dragging,
  performance,
  zones,
  pathfinder,
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
  /** Typed strain of the top issue (frame.resources) — the six-kind marker glyph. */
  resourceKind: ResourceKind | null;
  reducedMotion: boolean;
  active: boolean;
  /** frame.attention targets this actor — a subtle sustained focus emphasis. */
  attention: boolean;
  dragging: boolean;
  performance?: CharacterPerformanceState;
  zones: ZoneDef[];
  /** Floor pathfinder (H1/H2); null → the straight-line lerp fallback. */
  pathfinder: OfficePathfinder | null;
  onSelect: () => void;
  onDrilldown: () => void;
  onHoverChange: (hovered: boolean) => void;
  onHoverZone: (zoneId: string | null) => void;
  onDrop: (result: SceneEmployeeDrop) => void;
  onDragState: (drag: SceneEmployeeDrag | null) => void;
}) {
  const { camera, gl } = useThree();
  // Walk to the target (home placement or a high-value staged anchor) — routed
  // around known obstacles when a pathfinder is available, else a straight glide.
  // `walkingRef` flips on the walk locomotion while in transit.
  const unitRef = useRef<Group>(null);
  const walkingRef = useRef(false);
  const targetRef = useRef<[number, number]>([x, z]);
  targetRef.current = [x, z];
  // Waypoint route toward the current target. Always holds at least the final
  // target, so useFrame walks the list in order; when routing is unavailable it
  // holds just [target] and the walk is the straight lerp — behavior-identical
  // to the pre-pathfinding scene (zero regression).
  const waypointsRef = useRef<PathPoint[]>([[x, z]]);
  const waypointIndexRef = useRef(0);
  const plannedTargetRef = useRef<[number, number]>([x, z]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: this effect only seeds the initial mount position on first render; x/z are intentionally excluded (subsequent moves plan a route via the effect below and animate in useFrame). Adding x/z would re-snap the position every move, defeating the walk animation.
  useLayoutEffect(() => {
    unitRef.current?.position.set(x, 0, z);
    // Only seed the initial mount position; subsequent moves animate in useFrame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Precompute the walk route when the target changes — NOT every frame. A drag
  // to a new seat or a dramaturgy relocation replans from where the character
  // actually stands (its live animated position) around the known obstacles; an
  // unobstructed move (or a null pathfinder) collapses to a single-waypoint
  // straight line, the safe fallback that matches the old glide exactly.
  useEffect(() => {
    const [px, pz] = plannedTargetRef.current;
    if (Math.hypot(x - px, z - pz) < 0.05) return; // no meaningful target change
    plannedTargetRef.current = [x, z];
    const group = unitRef.current;
    const start: PathPoint = group ? [group.position.x, group.position.z] : [x, z];
    const route = pathfinder?.findWaypoints(start, [x, z]) ?? null;
    waypointsRef.current = route && route.length > 0 ? route : [[x, z]];
    waypointIndexRef.current = 0;
  }, [x, z, pathfinder]);
  useFrame((_, delta) => {
    const group = unitRef.current;
    if (!group) return;
    const waypoints = waypointsRef.current;
    const lastIndex = waypoints.length - 1;
    let index = waypointIndexRef.current;
    if (index > lastIndex) index = lastIndex;
    let wp = waypoints[index] ?? targetRef.current;
    let dx = wp[0] - group.position.x;
    let dz = wp[1] - group.position.z;
    let dist = Math.hypot(dx, dz);
    // Advance through intermediate waypoints once close enough; only the final
    // waypoint uses the fine arrival threshold below.
    while (dist <= 0.28 && index < lastIndex) {
      index += 1;
      wp = waypoints[index]!;
      dx = wp[0] - group.position.x;
      dz = wp[1] - group.position.z;
      dist = Math.hypot(dx, dz);
    }
    waypointIndexRef.current = index;
    if (dist > 0.04) {
      const step = Math.min(1, (1.9 * delta) / dist);
      group.position.x += dx * step;
      group.position.z += dz * step;
      // Walking tell: still traversing to a later waypoint, or the final leg is
      // more than a pace away (same 0.12 threshold as the old straight glide).
      walkingRef.current = index < lastIndex || dist > 0.12;
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
      {/* Attention focus (frame.attention): the selection-ring style at lower
          alpha — subtle, sustained, static (reduced-motion safe); never a
          second full-strength selection ring, and no camera movement. */}
      {attention && !active && !dragging ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[0.52, 0.64, 40]} />
          <meshBasicMaterial color={LIGHT_SCENE_3D.selectionRing} transparent opacity={0.3} />
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
          // Per-actor Suspense: a still-loading glb suspends only this
          // character (the hitbox, rings, label, and the rest of the scene
          // stay mounted); assets are module-preloaded so this rarely shows.
          <Suspense fallback={null}>
            <GltfCharacter
              appearance={appearance}
              action={active ? 'active' : running && !blocked ? 'working' : 'idle'}
              posture={posture}
              running={running}
              reducedMotion={reducedMotion}
              performance={performance}
              walkingRef={walkingRef}
              tempo={tempo}
              phase={phase}
              role={employee.roleSlug ?? employee.role}
            />
          </Suspense>
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
              // An approval issue pins the approval/amber ink — waiting on the
              // user, never the risk red — and a typed resource strain shows
              // its six-kind glyph (T/B/P/C/R/X); '!' stays the kindless
              // fallback (flow failures). Same scheme as the 2D marker disc.
              <span
                className={`off-scene-resource-marker is-${workload.topIssue.severity}${
                  workload.topIssue.kind === 'approval' ? ' is-approval' : ''
                }${blocked ? ' is-primary' : ''}`}
                aria-label={workload.topIssue.label}
                title={workload.topIssue.label}
              >
                {resourceKind ? RESOURCE_KIND_GLYPHS[resourceKind] : '!'}
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

function EmployeeDragGhost({
  employee,
  drag,
  reducedMotion,
}: {
  employee: Employee;
  drag: SceneEmployeeDrag;
  reducedMotion: boolean;
}) {
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
        {/* Ghost fade: GltfCharacter clones per-instance materials (body AND
            held props), so `opacity` fades the whole silhouette coherently. */}
        <Suspense fallback={null}>
          <GltfCharacter
            appearance={appearance}
            action="dragging"
            running
            phase={phase}
            opacity={ghostOpacity}
            role={employee.roleSlug ?? employee.role}
            reducedMotion={reducedMotion}
          />
        </Suspense>
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

  // Floor pathfinder (H1/H2): one grid built per obstacle set from the SAME
  // prefab obstacle radii the seat planner uses, so employees WALK a route
  // around furniture instead of gliding through it. Built once here (not per
  // frame, not per actor) and shared by every EmployeeUnit; null (no real
  // prefabs, e.g. the no-backend preview) keeps the straight-line lerp. A* runs
  // only when an actor's target changes.
  const pathfinder = useMemo(() => {
    const obstacles = sceneObstacles(scenePrefabs);
    if (obstacles.length === 0) return null;
    const { floorW, floorD } = floorBounds(zoneDefs);
    return buildOfficePathfinder(
      { minX: -floorW / 2, minZ: -floorD / 2, maxX: floorW / 2, maxZ: floorD / 2 },
      obstacles,
    );
  }, [scenePrefabs, zoneDefs]);

  // GltfCharacter's reducedMotion prop path (frozen mixer → static poses) is a
  // render concern; the frame separately carries staging=null under reduced motion.
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

  const sceneFlowLines = useMemo<SceneFlowLine[]>(() => {
    // Same (employee, target) lanes share identical geometry (kinds differ) —
    // stack their labels vertically instead of painting onto each other.
    const labelSlots = new Map<string, number>();
    return frame.flows.map((cue) => {
      const home = placementsByEmployee.get(cue.employeeId) ?? {
        x: defaultEmployeeZone.cx,
        z: defaultEmployeeZone.cz,
      };
      const staging = actorById.get(cue.employeeId)?.staging;
      const fromX = staging?.x ?? home.x;
      const fromZ = staging?.z ?? home.z;
      const to = flowTarget3D(cue.target);
      const laneKey = `${cue.employeeId}|${cue.target}`;
      const slot = labelSlots.get(laneKey) ?? 0;
      labelSlots.set(laneKey, slot + 1);
      return {
        id: `${cue.employeeId}|${cue.target}|${cue.kind}`,
        from: [fromX, 0.12, fromZ] as const,
        to,
        color: INK_3D[cue.ink],
        label: flowCueText(cue),
        labelPosition: [(fromX + to[0]) / 2, 0.6 + slot * 0.34, (fromZ + to[2]) / 2] as const,
        lineWidth: 1.6 + bundleEmphasis(cue),
      };
    });
  }, [actorById, defaultEmployeeZone, placementsByEmployee, frame.flows]);

  // Purpose-distinct target anchors (I4): every target a live lane points at
  // gets a small labeled chip so lanes visibly go somewhere; the delivery
  // shelf is itself the delivery anchor whenever it renders.
  const activeFlowTargets = useMemo(() => {
    const targets = new Set<FlowCueTarget>();
    for (const cue of frame.flows) targets.add(cue.target);
    return [...targets].sort();
  }, [frame.flows]);

  // employeeId → typed resource strain for the six-kind marker glyphs.
  const resourceKindByEmployee = useMemo(
    () => new Map(frame.resources.map((res) => [res.employeeId, res.resourceKind])),
    [frame.resources],
  );
  const attentionEmployeeId =
    frame.attention?.target === 'employee' ? (frame.attention.employeeId ?? null) : null;
  const deliveryAttention = frame.attention?.target === 'delivery';

  // Artifact arrival (I5): a brief shelf highlight when recentCount increases —
  // a CSS transition on the shelf head; reduced motion renders it without
  // transition (statically) via the media query. Seeded with the mount count
  // so pre-existing claims never flash.
  const [deliveryArrived, setDeliveryArrived] = useState(false);
  const prevRecentCountRef = useRef(frame.delivery.recentCount);
  useEffect(() => {
    const previous = prevRecentCountRef.current;
    prevRecentCountRef.current = frame.delivery.recentCount;
    if (frame.delivery.recentCount < previous) {
      // Claim beats expired (3-4.5s TTL): clear any armed highlight — the
      // reset timer below was cancelled by this effect's own cleanup, so
      // without this the shelf would stay highlighted forever.
      setDeliveryArrived(false);
      return;
    }
    if (frame.delivery.recentCount === previous) return;
    setDeliveryArrived(true);
    const timer = window.setTimeout(() => setDeliveryArrived(false), 1500);
    return () => window.clearTimeout(timer);
  }, [frame.delivery.recentCount]);

  // Delivery history route (I5): the shelf surface / head / +N overflow opens
  // the latest claim owner's workload drilldown when resolvable, else opens
  // the claim — the shared owner-routing helper both scenes use.
  const handleDeliveryHistory = () =>
    openDeliveryHistory(frame.delivery.latest, { openWorkloadDrilldown, openStageView, projectId });

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
        // idle CPU but the character mixers advance in useFrame (GltfCharacter
        // RigView) and EmployeeUnit's glide lerp mutates positions via refs —
        // neither invalidates, so demand mode froze every employee's
        // animation. ServerRack LOD checks similarly run in useFrame without
        // setState. Re-enable demand only alongside an invalidate() in those
        // useFrame consumers.
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
              // map null to undefined so GltfCharacter's legacy action-driven
              // clip path (idle loop, talk loop) stays byte-identical.
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
                  resourceKind={resourceKindByEmployee.get(employee.id) ?? null}
                  reducedMotion={reducedMotion}
                  active={cue?.selected ?? false}
                  attention={attentionEmployeeId === employee.id}
                  dragging={cue?.dragging ?? false}
                  performance={performance}
                  zones={zoneDefs}
                  pathfinder={pathfinder}
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
          <EmployeeDragGhost
            employee={draggedEmployee}
            drag={employeeDrag}
            reducedMotion={reducedMotion}
          />
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
            {/* Lane density label — the shared flowCueText rule (`×N · label`
                for bundles), a compact pill at the line midpoint. */}
            <Html
              position={line.labelPosition}
              center
              distanceFactor={18}
              occlude={false}
              zIndexRange={[2, 0]}
              className="off-scene-html-passive"
            >
              <span className="off-scene-flow-label">{line.label}</span>
            </Html>
          </Fragment>
        ))}
        {/* Purpose-distinct target anchors — a small labeled node per active
            flow target (dense HUD, not decoration); the delivery shelf below
            is itself the delivery anchor when it renders. */}
        {activeFlowTargets.map((target) =>
          target === 'delivery' && deliveryLatest ? null : (
            <Html
              key={target}
              position={flowTarget3D(target)}
              center
              distanceFactor={18}
              occlude={false}
              zIndexRange={[2, 0]}
              className="off-scene-html-passive"
            >
              <span className="off-scene-flow-anchor">{FLOW_TARGET_LABELS[target]}</span>
            </Html>
          ),
        )}
        {deliveryLatest ? (
          <Html
            position={flowTarget3D('delivery')}
            center
            distanceFactor={18}
            occlude={false}
            zIndexRange={[3, 0]}
            className="off-scene-html-interactive"
          >
            {/* Delivery shelf (I5) — a claimable output surface: ×N total on
                the head, up to 3 claimable chips (kind tag + ellipsized title,
                newest emphasized), +N overflow to history/drilldown, and a
                brief arrival highlight when a new claim lands. Same click
                semantics as the 2D shelf: the WHOLE shelf surface (wrapper
                padding + inter-chip gaps included) routes to history like the
                old full-surface button; chips/head/overflow keep their own
                handlers and stop propagation. */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the wrapper click is a pointer convenience covering gaps between the real buttons; the head/chip/overflow buttons inside are keyboard-focusable and cover every action */}
            <div
              className={`off-scene-delivery${deliveryArrived ? ' is-arrived' : ''}${
                deliveryAttention ? ' is-attention' : ''
              }`}
              onClick={handleDeliveryHistory}
            >
              <button
                type="button"
                className="off-scene-delivery-shelf is-interactive"
                aria-label={`Delivery — ${frame.delivery.recentCount} artifacts, open history`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeliveryHistory();
                }}
              >
                <span>Delivery</span>
                <b>{frame.delivery.recentCount}</b>
              </button>
              <div className="off-scene-delivery-chips">
                {frame.delivery.chips.map((chip, index) => (
                  <button
                    key={`${chip.deliverableId ?? chip.path ?? chip.title}-${index}`}
                    type="button"
                    className={`off-scene-delivery-chip${
                      index === frame.delivery.chips.length - 1 ? ' is-new' : ''
                    }`}
                    title={chip.title}
                    aria-label={`Open ${chip.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void openArtifactClaim(chip, { openStageView, projectId });
                    }}
                  >
                    <i>{chip.kind.slice(0, 3).toUpperCase()}</i>
                    <span>{chip.title}</span>
                  </button>
                ))}
                {frame.delivery.overflowCount > 0 ? (
                  <button
                    type="button"
                    className="off-scene-delivery-overflow"
                    aria-label={`${frame.delivery.overflowCount} more artifacts — open history`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeliveryHistory();
                    }}
                  >
                    +{frame.delivery.overflowCount}
                  </button>
                ) : null}
              </div>
            </div>
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
                ref: {
                  source: 'browser',
                  sourceId: selectedWorkBenchEntry.id,
                  url: detail.url,
                  detail,
                },
                title: detail.title ?? selectedWorkBenchEntry.tool,
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
