import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useStudioStore } from './StudioState.js';
import { STUDIO_COLORS } from './studio-tokens.js';

type OrbitControlsRef = React.ComponentRef<typeof OrbitControls>;

/** Subscribes to Zustand store changes and triggers R3F invalidate.
 *  Required because frameloop="demand" won't re-render on state changes automatically. */
function InvalidateBridge() {
  const { invalidate } = useThree();
  useEffect(() => useStudioStore.subscribe(() => invalidate()), [invalidate]);
  return null;
}

/** Plot boundary wireframe box */
function PlotBoundary() {
  const plotSize = useStudioStore((s) => s.plotSize);
  const geo = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(plotSize.width, 0.02, plotSize.depth)),
    [plotSize.width, plotSize.depth],
  );
  return (
    <lineSegments position={[0, 0.01, 0]} geometry={geo}>
      <lineBasicMaterial color={STUDIO_COLORS.plotBorder} transparent opacity={0.6} />
    </lineSegments>
  );
}

/** The 3D scene contents (inside Canvas) */
function StudioScene({ focusRef }: { focusRef?: React.MutableRefObject<((pos: [number, number, number]) => void) | null> }) {
  const plotSize = useStudioStore((s) => s.plotSize);
  const maxDim = Math.max(plotSize.width, plotSize.depth);
  const orbitRef = useRef<OrbitControlsRef>(null!);
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
    </>
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
