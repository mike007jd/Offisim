import { Grid, Html, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Zone } from '@aics/shared-types';
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
  if (zones.length === 0) return null;
  return (
    <>
      {zones.map((zone) => (
        <ZoneFloor key={zone.zoneId} zone={zone} />
      ))}
    </>
  );
}

function ZoneFloor({ zone }: { zone: Zone }) {
  const color = useMemo(() => new THREE.Color(zone.accentColor), [zone.accentColor]);

  // Border geometry: 4 thin boxes forming the rectangle outline
  const borderThickness = 0.05;
  const bh = 0.02; // border height

  return (
    <group position={[zone.cx, 0.005, zone.cz]}>
      {/* Floor fill */}
      <mesh rotation={_zonePlaneRotation}>
        <planeGeometry args={[zone.w, zone.d]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} depthWrite={false} />
      </mesh>

      {/* Border edges (4 thin boxes) */}
      {/* Top edge */}
      <mesh position={[0, bh / 2, -zone.d / 2]}>
        <boxGeometry args={[zone.w, bh, borderThickness]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} />
      </mesh>
      {/* Bottom edge */}
      <mesh position={[0, bh / 2, zone.d / 2]}>
        <boxGeometry args={[zone.w, bh, borderThickness]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} />
      </mesh>
      {/* Left edge */}
      <mesh position={[-zone.w / 2, bh / 2, 0]}>
        <boxGeometry args={[borderThickness, bh, zone.d]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} />
      </mesh>
      {/* Right edge */}
      <mesh position={[zone.w / 2, bh / 2, 0]}>
        <boxGeometry args={[borderThickness, bh, zone.d]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} />
      </mesh>

      {/* Zone label pill */}
      <Html position={[0, 0.3, -zone.d / 2 + 0.5]} center distanceFactor={30}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.05em',
            color: '#fff',
            background: zone.accentColor,
            padding: '2px 8px',
            borderRadius: 4,
            opacity: 0.85,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            userSelect: 'none',
            textShadow: '0 1px 2px rgba(0,0,0,0.3)',
          }}
        >
          {zone.label}
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
  const onPointerMissed = useCallback(() => {
    useStudioStore.getState().selectInstance(null);
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
