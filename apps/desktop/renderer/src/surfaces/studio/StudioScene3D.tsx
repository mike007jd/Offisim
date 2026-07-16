import { RoomShell } from '@/surfaces/office/scene/r3d/RoomShell.js';
import { SceneAnnotationScheduler } from '@/surfaces/office/scene/r3d/SceneAnnotation.js';
import { SceneEnvironment } from '@/surfaces/office/scene/r3d/SceneEnvironment.js';
import { SceneLighting } from '@/surfaces/office/scene/r3d/SceneLighting.js';
import { ScenePostFx } from '@/surfaces/office/scene/r3d/ScenePostFx.js';
import { ZoneCeilingLight, ZoneRug } from '@/surfaces/office/scene/r3d/ZoneDressing.js';
import { Prefab3D } from '@/surfaces/office/scene/r3d/prefabs/Prefab3D.js';
import {
  OFFICE_CAMERA_DEPTH,
  OFFICE_CAMERA_PRESET,
  SCENE_CONTENT_SCALE,
} from '@/surfaces/office/scene/r3d/scene-art-direction.js';
import { LIGHT_SCENE_3D } from '@/surfaces/office/scene/r3d/scene-colors.js';
import { groundPointFromClient, snapToGrid } from '@/surfaces/office/scene/scene-ground.js';
import { type ZoneDef, zoneDefsFromLayout } from '@/surfaces/office/scene/scene-layout.js';
import { getBuiltinPrefab } from '@offisim/renderer';
import {
  type PrefabDefinition,
  type PrefabInstanceRow,
  type PrefabPlacementObstacle,
  evaluatePrefabPlacement,
  findOverlaps,
  findZonePreset,
  prefabBoundsToRect,
  prefabPlacementBounds,
} from '@offisim/shared-types';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ACESFilmicToneMapping, Vector3 } from 'three';
import { useStudioStore } from './studio-store.js';

export interface StudioPrefabVM {
  readonly instance: PrefabInstanceRow;
  readonly definition: PrefabDefinition;
}

export interface StudioObjectMove {
  readonly instanceId: string;
  readonly x: number;
  readonly z: number;
  readonly zoneId: string;
}

export interface StudioZoneDrag {
  readonly zoneId: string;
  readonly dx: number;
  readonly dz: number;
}

export interface StudioPlacementCommit {
  readonly x: number;
  readonly z: number;
}

interface StudioScene3DProps {
  readonly layout: Parameters<typeof zoneDefsFromLayout>[0];
  readonly prefabs: readonly StudioPrefabVM[];
  readonly editable: boolean;
  readonly onCommitPlacement: (point: StudioPlacementCommit) => void;
  readonly onMoveObject: (move: StudioObjectMove) => void;
  readonly onMoveZone: (move: StudioZoneDrag) => void;
  readonly onEnterFocus: (zoneId: string) => void;
  /** A drag/placement landed somewhere the object can't go — surface the reason
   *  (the gesture itself reverts; nothing is persisted). */
  readonly onMoveRejected: (reason: string) => void;
  readonly onPlacementRejected: (reason: string) => void;
}

const FRAME_THICKNESS = 0.07;
const FRAME_Y = 0.055;
const DRAG_MOVED_THRESHOLD_PX = 5;

/** Shared window-level drag lifecycle for viewport gestures: 5px moved
 *  threshold, grabbing cursor, pointercancel cleanup. Returns its cleanup so
 *  callers can stash it in a ref for unmount. */
function beginGroundDrag(
  event: PointerEvent,
  handlers: {
    onDragMove?: (e: PointerEvent) => void;
    onDrop: (e: PointerEvent, moved: boolean) => void;
    onCleanup: () => void;
  },
): () => void {
  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;
  let complete = false;

  const cleanup = () => {
    if (complete) return;
    complete = true;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    document.body.style.cursor = '';
    handlers.onCleanup();
  };

  const onPointerMove = (e: PointerEvent) => {
    e.preventDefault();
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_MOVED_THRESHOLD_PX) moved = true;
    if (moved) handlers.onDragMove?.(e);
  };
  const onPointerUp = (e: PointerEvent) => {
    e.preventDefault();
    handlers.onDrop(e, moved);
    cleanup();
  };
  const onPointerCancel = () => cleanup();

  document.body.style.cursor = 'grabbing';
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  return cleanup;
}

/** Godot-style rectangular selection frame: four edges + chunkier corners,
 *  sized to the actual bounds of whatever is selected. No more giant rings. */
function SelectionFrame({
  cx,
  cz,
  w,
  d,
  color,
  fill = 0,
  y = FRAME_Y,
}: {
  cx: number;
  cz: number;
  w: number;
  d: number;
  color: string;
  fill?: number;
  y?: number;
}) {
  const corner = Math.min(0.42, Math.min(w, d) * 0.28);
  const edges: [number, number, number, number][] = [
    [0, -d / 2, w, FRAME_THICKNESS],
    [0, d / 2, w, FRAME_THICKNESS],
    [-w / 2, 0, FRAME_THICKNESS, d],
    [w / 2, 0, FRAME_THICKNESS, d],
  ];
  const corners: [number, number][] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [-w / 2, d / 2],
    [w / 2, d / 2],
  ];
  return (
    <group position={[cx, y, cz]}>
      {fill > 0 ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0]}>
          <planeGeometry args={[w, d]} />
          <meshBasicMaterial color={color} transparent opacity={fill} depthWrite={false} />
        </mesh>
      ) : null}
      {edges.map(([x, z, ew, ed]) => (
        <mesh key={`edge-${x}-${z}`} position={[x, 0, z]}>
          <boxGeometry args={[ew, 0.045, ed]} />
          <meshBasicMaterial color={color} transparent opacity={0.92} depthWrite={false} />
        </mesh>
      ))}
      {corners.map(([x, z]) => (
        <mesh key={`corner-${x}-${z}`} position={[x, 0.015, z]}>
          <boxGeometry args={[corner, 0.09, corner]} />
          <meshBasicMaterial color={color} transparent opacity={0.95} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Eased camera fly-to for zone focus (and back to the overview preset). */
function CameraFocusRig({ focusZone }: { focusZone: ZoneDef | null }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {
    target: Vector3;
    update: () => void;
  } | null;
  const flight = useRef<{
    fromPos: Vector3;
    toPos: Vector3;
    fromTarget: Vector3;
    toTarget: Vector3;
    t: number;
  } | null>(null);

  useEffect(() => {
    if (!controls) return;
    let toTarget: Vector3;
    let toPos: Vector3;
    if (focusZone) {
      toTarget = new Vector3(focusZone.cx, 0, focusZone.cz);
      const direction = camera.position.clone().sub(controls.target);
      direction.y = Math.max(direction.y, 1);
      direction.normalize();
      const distance = Math.max(Math.max(focusZone.w, focusZone.d) * 1.05, 9);
      toPos = toTarget.clone().add(direction.multiplyScalar(distance));
      toPos.y = Math.max(toPos.y, distance * 0.62);
    } else {
      const [px, py, pz] = OFFICE_CAMERA_PRESET.position;
      const [tx, ty, tz] = OFFICE_CAMERA_PRESET.target;
      toTarget = new Vector3(tx, ty, tz);
      toPos = new Vector3(px, py, pz);
    }
    flight.current = {
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls.target.clone(),
      toTarget,
      t: 0,
    };
  }, [camera, controls, focusZone]);

  useFrame((_, delta) => {
    const leg = flight.current;
    if (!leg || !controls) return;
    leg.t = Math.min(1, leg.t + delta / 0.45);
    const eased = 1 - (1 - leg.t) ** 3;
    camera.position.lerpVectors(leg.fromPos, leg.toPos, eased);
    controls.target.lerpVectors(leg.fromTarget, leg.toTarget, eased);
    controls.update();
    if (leg.t >= 1) flight.current = null;
  });
  return null;
}

/** Overview-mode zone hit plane: click selects, double-click enters focus,
 *  drag moves the whole zone (committed once on drop, objects travel along). */
function ZoneHitPlane({
  zone,
  onSelect,
  onEnterFocus,
  onMove,
  onDragState,
}: {
  zone: ZoneDef;
  onSelect: () => void;
  onEnterFocus: () => void;
  onMove?: (move: StudioZoneDrag) => void;
  onDragState: (dragging: boolean) => void;
}) {
  const { camera, gl } = useThree();
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cleanupRef.current?.();
    },
    [],
  );

  const beginDrag = (event: PointerEvent) => {
    if (!onMove) return;
    cleanupRef.current?.();
    const startGround = groundPointFromClient(event.clientX, event.clientY, gl.domElement, camera, [
      zone,
    ]);
    if (!startGround) return;

    onSelect();
    onDragState(true);
    cleanupRef.current = beginGroundDrag(event, {
      onDrop: (e, moved) => {
        if (!moved) return;
        const end = groundPointFromClient(e.clientX, e.clientY, gl.domElement, camera, [zone]);
        if (end) {
          const dx = end.x - startGround.x;
          const dz = end.z - startGround.z;
          if (Math.hypot(dx, dz) > 0.05) onMove({ zoneId: zone.id, dx, dz });
        }
      },
      onCleanup: () => {
        onDragState(false);
        cleanupRef.current = null;
      },
    });
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: r3f raycaster plane; zones are also reachable through the scene tree
    <mesh
      position={[zone.cx, 0.04, zone.cz]}
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEnterFocus();
      }}
      onPointerDown={(e) => {
        if (!onMove) return;
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        e.nativeEvent.preventDefault();
        beginDrag(e.nativeEvent);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = onMove ? 'grab' : 'pointer';
      }}
      onPointerOut={() => {
        if (!cleanupRef.current) document.body.style.cursor = '';
      }}
    >
      <planeGeometry args={[zone.w, zone.d]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** Focus-mode editable prefab: the object tracks the cursor 1:1 (no clamp — it
 *  never jumps to a "nearby" cell), the bbox frame turns red the instant the
 *  live spot leaves the zone or overlaps another object, and an invalid release
 *  reverts without persisting. Display-only outside the focused zone. */
function EditablePrefab({
  vm,
  zone,
  obstacles,
  selected,
  editable,
  onSelect,
  onMove,
  onMoveRejected,
  onDragState,
}: {
  vm: StudioPrefabVM;
  zone: ZoneDef | null;
  obstacles: readonly PrefabPlacementObstacle[];
  selected: boolean;
  editable: boolean;
  onSelect: () => void;
  onMove: (move: StudioObjectMove) => void;
  onMoveRejected: (reason: string) => void;
  onDragState: (dragging: boolean) => void;
}) {
  const { camera, gl } = useThree();
  const cleanupRef = useRef<(() => void) | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; z: number } | null>(null);
  // null = not dragging; true/false = live drop validity (drives frame color).
  const [dragValid, setDragValid] = useState<boolean | null>(null);
  const { instance, definition } = vm;

  useEffect(
    () => () => {
      cleanupRef.current?.();
    },
    [],
  );

  const x = dragPos?.x ?? instance.position_x;
  const z = dragPos?.z ?? instance.position_y;
  const frameBounds = useMemo(() => {
    if (!selected && dragValid === null) return null;
    return prefabBoundsToRect(
      prefabPlacementBounds({
        prefabId: definition.prefabId,
        x,
        z,
        rotation: instance.rotation,
        gridSize: definition.gridSize,
      }),
    );
  }, [selected, dragValid, definition, x, z, instance.rotation]);

  const beginDrag = (event: PointerEvent) => {
    if (!editable || !zone) return;
    cleanupRef.current?.();
    let last: { x: number; z: number } | null = null;

    // One probe = floor hit → grid snap → shared collision verdict. Returns null
    // only when the pointer is off-canvas / the ray misses the floor plane.
    const probe = (e: PointerEvent) => {
      const point = groundPointFromClient(e.clientX, e.clientY, gl.domElement, camera, [zone]);
      if (!point) return null;
      // Snap to grid but DON'T clamp into the zone — the object follows the
      // cursor 1:1 so it never feels like it teleports to an empty cell.
      const x = snapToGrid(point.x);
      const z = snapToGrid(point.z);
      const verdict = evaluatePrefabPlacement(
        {
          id: instance.instance_id,
          prefabId: definition.prefabId,
          x,
          z,
          rotation: instance.rotation,
          gridSize: definition.gridSize,
        },
        zone,
        obstacles,
      );
      return { x, z, valid: verdict.valid, reason: verdict.reason };
    };

    const trackLive = (e: PointerEvent) => {
      const next = probe(e);
      if (!next) return; // off-canvas: hold the last on-floor spot (no teleport)
      if (last && last.x === next.x && last.z === next.z) return;
      last = { x: next.x, z: next.z };
      setDragPos({ x: next.x, z: next.z });
      setDragValid(next.valid);
    };

    onSelect();
    onDragState(true);
    cleanupRef.current = beginGroundDrag(event, {
      onDragMove: trackLive,
      onDrop: (e, moved) => {
        if (!moved) return;
        // Evaluate the ACTUAL release point — never a stale tracked value. An
        // off-canvas release (null) just reverts, mirroring the placement ghost.
        const release = probe(e);
        if (!release) return;
        if (release.valid) {
          onMove({ instanceId: instance.instance_id, zoneId: zone.id, x: release.x, z: release.z });
        } else {
          onMoveRejected(release.reason ?? "Can't move the object here");
        }
      },
      onCleanup: () => {
        onDragState(false);
        setDragPos(null);
        setDragValid(null);
        cleanupRef.current = null;
      },
    });
  };

  const frameColor =
    dragValid === false
      ? LIGHT_SCENE_3D.ghostBlocked
      : dragValid === true
        ? LIGHT_SCENE_3D.ghostValid
        : LIGHT_SCENE_3D.selectionRing;

  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: r3f raycaster on a 3D prefab; objects are also reachable through the scene tree */}
      <group
        position={[x, 0, z]}
        rotation={[0, (instance.rotation * Math.PI) / 180, 0]}
        scale={SCENE_CONTENT_SCALE}
        onClick={(e) => {
          if (!editable) return;
          e.stopPropagation();
          onSelect();
        }}
        onPointerDown={(e) => {
          if (!editable) return;
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          e.nativeEvent.preventDefault();
          beginDrag(e.nativeEvent);
        }}
        onPointerOver={(e) => {
          if (!editable) return;
          e.stopPropagation();
          document.body.style.cursor = 'grab';
        }}
        onPointerOut={() => {
          if (!cleanupRef.current) document.body.style.cursor = '';
        }}
      >
        <Prefab3D definition={definition} />
      </group>
      {frameBounds ? <SelectionFrame {...frameBounds} color={frameColor} /> : null}
    </>
  );
}

/** Ghost state computed from the active placement + live pointer. */
interface GhostState {
  readonly x: number;
  readonly z: number;
  readonly valid: boolean;
  /** Why the current spot is blocked (toasted on commit, not on hover). */
  readonly reason: string | null;
  readonly overCanvas: boolean;
}

export function StudioScene3D({
  layout,
  prefabs,
  editable,
  onCommitPlacement,
  onMoveObject,
  onMoveZone,
  onEnterFocus,
  onMoveRejected,
  onPlacementRejected,
}: StudioScene3DProps) {
  const focusZoneId = useStudioStore((s) => s.focusZoneId);
  const selection = useStudioStore((s) => s.selection);
  const placement = useStudioStore((s) => s.placement);
  const select = useStudioStore((s) => s.select);
  const endPlacement = useStudioStore((s) => s.endPlacement);

  const zoneDefs = useMemo(() => zoneDefsFromLayout(layout), [layout]);
  const focusZone = useMemo(
    () => zoneDefs.find((zone) => zone.id === focusZoneId) ?? null,
    [zoneDefs, focusZoneId],
  );
  // Every other object in the focused zone, as collision obstacles. Drag and
  // placement both probe against this so the live preview and the commit gate
  // share one verdict.
  const focusZoneObstacles = useMemo<PrefabPlacementObstacle[]>(() => {
    if (!focusZoneId) return [];
    return prefabs
      .filter((vm) => vm.instance.zone_id === focusZoneId)
      .map((vm) => ({
        id: vm.instance.instance_id,
        prefabId: vm.definition.prefabId,
        x: vm.instance.position_x,
        z: vm.instance.position_y,
        rotation: vm.instance.rotation,
        gridSize: vm.definition.gridSize,
        label: vm.definition.name,
      }));
  }, [prefabs, focusZoneId]);
  const [dragging, setDragging] = useState(false);

  return (
    <Canvas
      shadows="soft"
      dpr={[1, 2]}
      camera={{
        position: OFFICE_CAMERA_PRESET.position,
        fov: OFFICE_CAMERA_PRESET.fov,
        near: OFFICE_CAMERA_DEPTH.near,
        far: OFFICE_CAMERA_DEPTH.far,
      }}
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.02 }}
      className="off-scene-canvas"
    >
      <SceneAnnotationScheduler />
      <color attach="background" args={[LIGHT_SCENE_3D.sceneBackground]} />
      <SceneLighting />
      <SceneEnvironment />
      <RoomShell />

      {zoneDefs.map((zone) => {
        const isFocused = zone.id === focusZoneId;
        const zoneSelected = !focusZoneId && selection?.kind === 'zone' && selection.id === zone.id;
        return (
          <Fragment key={zone.id}>
            <ZoneRug zone={zone} dimmed={Boolean(focusZoneId && !isFocused)} />
            <ZoneCeilingLight zone={zone} />
            {zoneSelected ? (
              <SelectionFrame
                cx={zone.cx}
                cz={zone.cz}
                w={zone.w}
                d={zone.d}
                color={LIGHT_SCENE_3D.selectionRing}
                fill={0.07}
              />
            ) : null}
            {editable && !focusZoneId && !placement ? (
              <ZoneHitPlane
                zone={zone}
                onSelect={() => select({ kind: 'zone', id: zone.id })}
                onEnterFocus={() => onEnterFocus(zone.id)}
                onMove={onMoveZone}
                onDragState={setDragging}
              />
            ) : null}
          </Fragment>
        );
      })}

      {prefabs.map((vm) => {
        const inFocusZone = vm.instance.zone_id === focusZoneId;
        return (
          <EditablePrefab
            key={vm.instance.instance_id}
            vm={vm}
            zone={inFocusZone ? focusZone : null}
            obstacles={focusZoneObstacles}
            selected={selection?.kind === 'object' && selection.id === vm.instance.instance_id}
            editable={editable && inFocusZone && !placement}
            onSelect={() => select({ kind: 'object', id: vm.instance.instance_id })}
            onMove={onMoveObject}
            onMoveRejected={onMoveRejected}
            onDragState={setDragging}
          />
        );
      })}

      {placement ? (
        <PlacementGhostController
          zoneDefs={zoneDefs}
          focusZone={focusZone}
          obstacles={focusZoneObstacles}
          onCommit={onCommitPlacement}
          onReject={onPlacementRejected}
          onEnd={endPlacement}
        />
      ) : null}

      <CameraFocusRig focusZone={focusZone} />
      <OrbitControls
        makeDefault
        target={OFFICE_CAMERA_PRESET.target}
        enabled={!dragging && !placement}
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

/** Drives the placement ghost: window-level pointer tracking (so drags that
 *  started on a browser card work), validity coloring, and commit routing.
 *  Drag mode commits on pointer-up; click mode commits per click and stays on. */
function PlacementGhostController({
  zoneDefs,
  focusZone,
  obstacles,
  onCommit,
  onReject,
  onEnd,
}: {
  zoneDefs: readonly ZoneDef[];
  focusZone: ZoneDef | null;
  obstacles: readonly PrefabPlacementObstacle[];
  onCommit: (point: StudioPlacementCommit) => void;
  onReject: (reason: string) => void;
  onEnd: () => void;
}) {
  const placement = useStudioStore((s) => s.placement);
  const { camera, gl } = useThree();
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const ghostRef = useRef<GhostState | null>(null);

  const ghostShape = useMemo(() => {
    if (!placement) return null;
    if (placement.kind === 'prefab') {
      const definition = getBuiltinPrefab(placement.prefabId);
      if (!definition) return null;
      const rect = prefabBoundsToRect(
        prefabPlacementBounds({
          prefabId: placement.prefabId,
          x: 0,
          z: 0,
          rotation: placement.rotation,
          gridSize: definition.gridSize,
        }),
      );
      return {
        kind: 'prefab' as const,
        definition,
        rotation: placement.rotation,
        offsetX: rect.cx,
        offsetZ: rect.cz,
        w: rect.w,
        d: rect.d,
      };
    }
    const preset = findZonePreset(placement.presetId);
    if (!preset) return null;
    return { kind: 'zone' as const, w: preset.w, d: preset.d, label: preset.label };
  }, [placement]);

  useEffect(() => {
    if (!placement || !ghostShape) return;

    const evaluate = (clientX: number, clientY: number): GhostState | null => {
      const point = groundPointFromClient(clientX, clientY, gl.domElement, camera, zoneDefs);
      if (!point) return null;
      const x = snapToGrid(point.x);
      const z = snapToGrid(point.z);
      let valid: boolean;
      let reason: string | null;
      if (ghostShape.kind === 'prefab') {
        // Same evaluator the focused-zone drag uses: zone fit + overlap, so a
        // green ghost can never become a silently-rejected commit.
        const verdict = evaluatePrefabPlacement(
          {
            prefabId: ghostShape.definition.prefabId,
            x,
            z,
            rotation: ghostShape.rotation,
            gridSize: ghostShape.definition.gridSize,
          },
          focusZone,
          obstacles,
        );
        valid = verdict.valid;
        reason = verdict.reason;
      } else {
        const hits = findOverlaps(
          { id: 'zone-ghost', cx: x, cz: z, w: ghostShape.w, d: ghostShape.d },
          zoneDefs.map((zone) => ({
            id: zone.id,
            label: zone.label,
            cx: zone.cx,
            cz: zone.cz,
            w: zone.w,
            d: zone.d,
          })),
        );
        valid = hits.length === 0;
        reason = valid
          ? null
          : `Overlaps ${hits.map((other) => other.label ?? other.id).join(', ')}`;
      }
      return { x, z, valid, reason, overCanvas: true };
    };

    const onPointerMove = (e: PointerEvent) => {
      const next = evaluate(e.clientX, e.clientY);
      const prev = ghostRef.current;
      // Grid snap makes consecutive events mostly identical — skip re-renders.
      if (prev && next && prev.x === next.x && prev.z === next.z && prev.valid === next.valid) {
        return;
      }
      ghostRef.current = next;
      setGhost(next);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (placement.mode !== 'drag') return;
      const state = evaluate(e.clientX, e.clientY);
      if (state?.valid) onCommit({ x: state.x, z: state.z });
      else if (state?.reason) onReject(state.reason);
      onEnd();
    };
    const onClick = (e: MouseEvent) => {
      if (placement.mode !== 'click') return;
      const state = evaluate(e.clientX, e.clientY);
      if (state?.valid) onCommit({ x: state.x, z: state.z });
      else if (state?.reason) onReject(state.reason);
    };
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      onEnd();
    };

    document.body.style.cursor = 'crosshair';
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    gl.domElement.addEventListener('click', onClick);
    gl.domElement.addEventListener('contextmenu', onContextMenu);
    return () => {
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      gl.domElement.removeEventListener('click', onClick);
      gl.domElement.removeEventListener('contextmenu', onContextMenu);
    };
  }, [
    placement,
    ghostShape,
    zoneDefs,
    focusZone,
    obstacles,
    camera,
    gl,
    onCommit,
    onReject,
    onEnd,
  ]);

  if (!ghost || !ghostShape) return null;
  const color = ghost.valid ? LIGHT_SCENE_3D.ghostValid : LIGHT_SCENE_3D.ghostBlocked;

  if (ghostShape.kind === 'zone') {
    return (
      <SelectionFrame
        cx={ghost.x}
        cz={ghost.z}
        w={ghostShape.w}
        d={ghostShape.d}
        color={color}
        fill={0.16}
      />
    );
  }
  return (
    <>
      <group
        position={[ghost.x, 0, ghost.z]}
        rotation={[0, (ghostShape.rotation * Math.PI) / 180, 0]}
        scale={SCENE_CONTENT_SCALE}
      >
        <Prefab3D definition={ghostShape.definition} />
      </group>
      <SelectionFrame
        cx={ghost.x + ghostShape.offsetX}
        cz={ghost.z + ghostShape.offsetZ}
        w={ghostShape.w}
        d={ghostShape.d}
        color={color}
        fill={0.18}
      />
    </>
  );
}
