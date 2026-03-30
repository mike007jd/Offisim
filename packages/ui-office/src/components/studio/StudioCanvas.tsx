import { Grid, Html, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Zone } from '@offisim/shared-types';
import { computeOverlapMap } from '@offisim/shared-types';
import { useStudioStore } from './StudioState.js';
import { STUDIO_COLORS } from './studio-tokens.js';

type OrbitControlsRef = React.ComponentRef<typeof OrbitControls>;

/** Rendering-relevant store fields — changes to these require a canvas invalidate.
 *  `tool` affects TransformControls mode/enabled/visible in the 3D scene. */
function pickRenderFields(s: ReturnType<typeof useStudioStore.getState>) {
  return {
    instances: s.instances,
    selectedInstanceId: s.selectedInstanceId,
    placingPrefab: s.placingPrefab,
    ghostRotation: s.ghostRotation,
    plotSize: s.plotSize,
    gridSnap: s.gridSnap,
    tool: s.tool,
    zones: s.zones,
    focusedZoneId: s.focusedZoneId,
    selectedZoneId: s.selectedZoneId,
    isEditingZone: s.isEditingZone,
  };
}

/** Subscribes to rendering-relevant Zustand store fields and triggers R3F invalidate.
 *  Required because frameloop="demand" won't re-render on state changes automatically.
 *  Only invalidates when fields that affect 3D rendering actually change (PERF-1). */
function InvalidateBridge() {
  const { invalidate } = useThree();
  useEffect(() => {
    let prev = pickRenderFields(useStudioStore.getState());
    return useStudioStore.subscribe((state) => {
      const next = pickRenderFields(state);
      // Shallow compare — only invalidate when a rendering-relevant field changed
      for (const key of Object.keys(next) as Array<keyof typeof next>) {
        if (next[key] !== prev[key]) {
          prev = next;
          invalidate();
          return;
        }
      }
    });
  }, [invalidate]);
  return null;
}

/** Plot boundary wireframe box */
function PlotBoundary() {
  const plotSize = useStudioStore((s) => s.plotSize);
  const geo = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(plotSize.width, 0.02, plotSize.depth)),
    [plotSize.width, plotSize.depth],
  );
  useEffect(
    () => () => {
      geo.dispose();
    },
    [geo],
  );
  return (
    <lineSegments position={[0, 0.01, 0]} geometry={geo}>
      <lineBasicMaterial color={STUDIO_COLORS.plotBorder} transparent opacity={0.6} />
    </lineSegments>
  );
}

/** The 3D scene contents (inside Canvas) */
function StudioScene({
  focusRef,
}: { focusRef?: React.MutableRefObject<((pos: [number, number, number]) => void) | null> }) {
  const plotSize = useStudioStore((s) => s.plotSize);
  const maxDim = Math.max(plotSize.width, plotSize.depth);
  const orbitRef = useRef<OrbitControlsRef | null>(null);
  const { camera, invalidate } = useThree();

  // Expose focus callback via ref so StudioPage can call it on F/Home key
  useEffect(() => {
    if (focusRef) {
      focusRef.current = (pos) => {
        if (orbitRef.current) {
          orbitRef.current.target.set(pos[0], 0, pos[2]);
          camera.position.set(pos[0] + 10, 10, pos[2] + 10);
          orbitRef.current.update();
          invalidate();
        }
      };
    }
  }, [focusRef, camera, invalidate]);

  // Auto-fly camera when a zone is focused / unfocused
  const focusedZoneId = useStudioStore((s) => s.focusedZoneId);
  const zones = useStudioStore((s) => s.zones);

  // Derive target coords from focused zone — only these values should restart the animation
  const focusedZone = focusedZoneId ? zones.find((z) => z.zoneId === focusedZoneId) : null;
  const camTargetCx = focusedZone?.cx ?? 0;
  const camTargetCz = focusedZone?.cz ?? 0;
  const camTargetDist = focusedZone
    ? Math.max(focusedZone.w, focusedZone.d) * 1.2
    : maxDim * 0.8;

  useEffect(() => {
    const orbit = orbitRef.current;
    if (!orbit) return;

    const startTarget = orbit.target.clone();
    const startPos = camera.position.clone();
    const endTarget = new THREE.Vector3(camTargetCx, 0, camTargetCz);
    const endPos = new THREE.Vector3(
      camTargetCx + camTargetDist * 0.6,
      camTargetDist * 0.7,
      camTargetCz + camTargetDist * 0.6,
    );

    let frame = 0;
    let cancelled = false;
    const totalFrames = 20;
    const animate = () => {
      if (cancelled) return;
      frame++;
      const t = frame / totalFrames;
      const ease = 1 - (1 - t) ** 3;

      orbit.target.lerpVectors(startTarget, endTarget, ease);
      camera.position.lerpVectors(startPos, endPos, ease);
      orbit.update();
      invalidate();

      if (frame < totalFrames) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);

    return () => { cancelled = true; };
  }, [focusedZoneId, camTargetCx, camTargetCz, camTargetDist, camera, invalidate]);

  return (
    <>
      <InvalidateBridge />

      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 15, 10]} intensity={0.8} castShadow={false} />

      {/* Camera controls */}
      <OrbitControls
        ref={orbitRef}
        makeDefault
        target={[0, 0, 0]}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={5}
        maxDistance={maxDim * 2}
      />

      {/* Grid */}
      <Grid
        infiniteGrid
        cellSize={0.5}
        sectionSize={2}
        cellColor={STUDIO_COLORS.gridMinor}
        sectionColor={STUDIO_COLORS.gridMajor}
        fadeDistance={maxDim * 1.5}
        fadeStrength={1.5}
        position={[0, -0.01, 0]}
      />

      {/* Plot boundary */}
      <PlotBoundary />

      {/* Zone overlays */}
      <ZoneOverlays />
    </>
  );
}

// ── Zone floor overlays ─────────────────────────────────────────────

const _zonePlaneRotation = new THREE.Euler(-Math.PI / 2, 0, 0);

function ZoneOverlays() {
  const zones = useStudioStore((s) => s.zones);
  const focusedZoneId = useStudioStore((s) => s.focusedZoneId);
  const selectedZoneId = useStudioStore((s) => s.selectedZoneId);
  const overlapMap = useMemo(
    () => computeOverlapMap(zones.map((z) => ({ ...z, id: z.zoneId }))),
    [zones],
  );
  if (zones.length === 0) return null;
  return (
    <>
      {zones.map((zone) => (
        <ZoneFloor
          key={zone.zoneId}
          zone={zone}
          isFocused={focusedZoneId === zone.zoneId}
          isDimmed={focusedZoneId !== null && focusedZoneId !== zone.zoneId}
          isSelected={selectedZoneId === zone.zoneId}
          hasOverlap={overlapMap.has(zone.zoneId)}
        />
      ))}
    </>
  );
}

/** Reusable y=0 ground plane for raycasting pointer position during zone drag. */
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Snap value to a 0.5 grid. */
function snapToGrid(v: number): number {
  return Math.round(v * 2) / 2;
}

function ZoneFloor({
  zone,
  isFocused,
  isDimmed,
  isSelected,
  hasOverlap,
}: {
  zone: Zone;
  isFocused: boolean;
  isDimmed: boolean;
  hasOverlap: boolean;
  isSelected: boolean;
}) {
  const color = useMemo(() => new THREE.Color(zone.accentColor), [zone.accentColor]);
  const focusZone = useStudioStore((s) => s.focusZone);
  const unfocusZone = useStudioStore((s) => s.unfocusZone);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startPointerX: number;
    startPointerZ: number;
    startCx: number;
    startCz: number;
  } | null>(null);
  const { invalidate } = useThree();
  // Access OrbitControls set by `makeDefault` via the R3F store
  const getControls = useThree((s) => s.controls);

  const fillOpacity = isDimmed ? 0.04 : isFocused ? 0.2 : 0.12;
  const borderOpacity = isDimmed ? 0.15 : isFocused ? 0.8 : 0.5;
  const labelOpacity = isDimmed ? 0.3 : 0.85;

  // Selection highlight: brighten border when selected
  const effectiveBorderOpacity = isSelected ? Math.min(borderOpacity + 0.3, 1) : borderOpacity;

  // Border geometry
  const borderThickness = isFocused ? 0.08 : isSelected ? 0.07 : 0.05;
  const bh = 0.02;

  // Lift zone slightly when dragging for visual feedback
  // Zone floor sits below prefabs (y=-0.005) so prefab clicks take raycaster priority.
  // During drag, lift slightly for visual feedback.
  const groupY = isDragging ? 0.05 : -0.005;

  /** Project the pointer ray onto the y=0 ground plane. */
  const getGroundPoint = useCallback(
    (e: { ray: THREE.Ray }) => {
      const target = new THREE.Vector3();
      e.ray.intersectPlane(_groundPlane, target);
      return target;
    },
    [],
  );

  const onPointerDown = useCallback(
    (e: { stopPropagation: () => void; ray: THREE.Ray }) => {
      const { tool, selectedZoneId, isEditingZone, focusedZoneId } = useStudioStore.getState();
      if (tool !== 'select' && tool !== 'move') return;

      // In Edit Zone mode: block all zone interaction (no select, no drag)
      if (isEditingZone) {
        // Allow clicking the focused zone floor to deselect prefabs, but no drag
        if (zone.zoneId === focusedZoneId) {
          useStudioStore.getState().selectInstance(null);
        }
        return;
      }

      // First click on a zone = just select it (don't block prefab clicks).
      // Only start drag if the zone is ALREADY selected (second interaction).
      if (selectedZoneId !== zone.zoneId) {
        useStudioStore.getState().selectZone(zone.zoneId);
        return;
      }

      // Zone is already selected — start drag
      e.stopPropagation();

      const pt = getGroundPoint(e);
      const currentZone = useStudioStore.getState().zones.find((z) => z.zoneId === zone.zoneId);
      if (!currentZone) return;

      dragRef.current = {
        startPointerX: pt.x,
        startPointerZ: pt.z,
        startCx: currentZone.cx,
        startCz: currentZone.cz,
      };

      setIsDragging(true);

      if (getControls) {
        (getControls as unknown as { enabled: boolean }).enabled = false;
      }
    },
    [zone.zoneId, getGroundPoint, getControls],
  );

  const onPointerMove = useCallback(
    (e: { stopPropagation: () => void; ray: THREE.Ray }) => {
      if (!dragRef.current) return;
      e.stopPropagation();

      const pt = getGroundPoint(e);
      const { startPointerX, startPointerZ, startCx, startCz } = dragRef.current;
      const dx = pt.x - startPointerX;
      const dz = pt.z - startPointerZ;

      let newCx = startCx + dx;
      let newCz = startCz + dz;

      // Snap to 0.5 grid if enabled
      if (useStudioStore.getState().gridSnap) {
        newCx = snapToGrid(newCx);
        newCz = snapToGrid(newCz);
      }

      useStudioStore.getState().moveZone(zone.zoneId, newCx, newCz);
      invalidate();
    },
    [zone.zoneId, getGroundPoint, invalidate],
  );

  const onPointerUp = useCallback(
    () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setIsDragging(false);

      // Re-enable orbit controls
      if (getControls) {
        (getControls as unknown as { enabled: boolean }).enabled = true;
      }
      invalidate();
    },
    [getControls, invalidate],
  );

  return (
    <group position={[zone.cx, groupY, zone.cz]}>
      {/* Floor fill — receives drag pointer events */}
      <mesh
        rotation={_zonePlaneRotation}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <planeGeometry args={[zone.w, zone.d]} />
        <meshBasicMaterial color={color} transparent opacity={fillOpacity} depthWrite={false} />
      </mesh>

      {/* Overlap warning tint */}
      {hasOverlap && (
        <mesh position={[0, 0.005, 0]} rotation={_zonePlaneRotation}>
          <planeGeometry args={[zone.w, zone.d]} />
          <meshBasicMaterial color="#ef4444" transparent opacity={0.1} depthWrite={false} />
        </mesh>
      )}

      {/* Invisible drag surface — larger than the zone, only visible during drag.
          Ensures pointer events continue even if the cursor leaves the zone floor. */}
      {isDragging && (
        <mesh
          rotation={_zonePlaneRotation}
          position={[0, -0.001, 0]}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <planeGeometry args={[zone.w * 10, zone.d * 10]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}

      {/* Border edges */}
      <mesh position={[0, bh / 2, -zone.d / 2]}>
        <boxGeometry args={[zone.w, bh, borderThickness]} />
        <meshBasicMaterial color={color} transparent opacity={effectiveBorderOpacity} />
      </mesh>
      <mesh position={[0, bh / 2, zone.d / 2]}>
        <boxGeometry args={[zone.w, bh, borderThickness]} />
        <meshBasicMaterial color={color} transparent opacity={effectiveBorderOpacity} />
      </mesh>
      <mesh position={[-zone.w / 2, bh / 2, 0]}>
        <boxGeometry args={[borderThickness, bh, zone.d]} />
        <meshBasicMaterial color={color} transparent opacity={effectiveBorderOpacity} />
      </mesh>
      <mesh position={[zone.w / 2, bh / 2, 0]}>
        <boxGeometry args={[borderThickness, bh, zone.d]} />
        <meshBasicMaterial color={color} transparent opacity={effectiveBorderOpacity} />
      </mesh>

      {/* Zone label pill — clickable to focus/unfocus */}
      <Html position={[0, 0.3, -zone.d / 2 + 0.5]} center distanceFactor={30}>
        <div
          className="studio-zone-label"
          onClick={(e) => {
            e.stopPropagation(); // Prevent Canvas onPointerMissed from clearing selection
            if (isFocused) unfocusZone();
            else focusZone(zone.zoneId);
          }}
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.05em',
            color: '#fff',
            background: zone.accentColor,
            padding: isFocused ? '3px 10px' : '2px 8px',
            borderRadius: 4,
            border: isFocused ? '2px solid #fff' : '2px solid transparent',
            opacity: labelOpacity,
            whiteSpace: 'nowrap',
            cursor: isDragging ? 'grabbing' : 'pointer',
            userSelect: 'none',
            textShadow: '0 1px 2px rgba(0,0,0,0.3)',
            transition: 'all 0.15s ease',
          }}
        >
          {isFocused ? `✦ ${zone.label}` : zone.label}
        </div>
      </Html>
    </group>
  );
}

export interface StudioCanvasProps {
  children?: React.ReactNode;
  focusRef?: React.MutableRefObject<((pos: [number, number, number]) => void) | null>;
}

export function StudioCanvas({ children, focusRef }: StudioCanvasProps) {
  const onPointerMissed = useCallback((e: MouseEvent) => {
    // Html overlay clicks (zone labels) fire as DOM events that miss the R3F scene.
    // If the click target is inside an Html overlay, don't clear selection.
    const target = e.target as HTMLElement | null;
    if (target && target.closest?.('.studio-zone-label')) return;

    const s = useStudioStore.getState();
    s.selectInstance(null);
    s.selectZone(null);
  }, []);

  return (
    <Canvas
      frameloop="demand"
      camera={{ position: [20, 20, 20], fov: 50, near: 0.1, far: 500 }}
      onPointerMissed={onPointerMissed}
      style={{ background: STUDIO_COLORS.canvasBg }}
    >
      <StudioScene focusRef={focusRef} />
      {children}
    </Canvas>
  );
}
