import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { useCallback, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useStudioStore } from './StudioState.js';

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
      <lineBasicMaterial color="#6366f1" transparent opacity={0.6} />
    </lineSegments>
  );
}

const ORIGIN = [0, 0, 0] as const;

/** The 3D scene contents (inside Canvas) */
function StudioScene() {
  const plotSize = useStudioStore((s) => s.plotSize);
  const maxDim = Math.max(plotSize.width, plotSize.depth);

  return (
    <>
      <InvalidateBridge />

      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 15, 10]} intensity={0.8} castShadow={false} />

      {/* Camera controls */}
      <OrbitControls
        makeDefault
        target={ORIGIN as unknown as THREE.Vector3}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={5}
        maxDistance={maxDim * 2}
      />

      {/* Grid */}
      <Grid
        infiniteGrid
        cellSize={0.5}
        sectionSize={2}
        cellColor="#333"
        sectionColor="#555"
        fadeDistance={maxDim * 1.5}
        fadeStrength={1.5}
        position={[0, -0.01, 0]}
      />

      {/* Plot boundary */}
      <PlotBoundary />
    </>
  );
}

interface StudioCanvasProps {
  children?: React.ReactNode;
}

export function StudioCanvas({ children }: StudioCanvasProps) {
  const onPointerMissed = useCallback(() => {
    useStudioStore.getState().selectInstance(null);
  }, []);

  return (
    <Canvas
      frameloop="demand"
      camera={{ position: [20, 20, 20], fov: 50, near: 0.1, far: 500 }}
      onPointerMissed={onPointerMissed}
      style={{ background: '#111' }}
    >
      <StudioScene />
      {children}
    </Canvas>
  );
}
