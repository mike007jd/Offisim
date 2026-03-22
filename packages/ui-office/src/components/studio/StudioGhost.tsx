/**
 * StudioGhost -- Ghost preview that follows the mouse during prefab placement.
 *
 * Uses R3F's event system (NOT DOM events) for raycast-based positioning.
 * An invisible floor mesh captures pointer events, the ghost group follows
 * with grid snapping and plot boundary clamping.
 */

import { useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { useStudioStore } from './StudioState.js';
import { Prefab3D } from '../scene/prefabs/Prefab3D.js';

function snap(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

export function StudioGhost() {
  const groupRef = useRef<THREE.Group>(null!);
  const { invalidate } = useThree();

  const placingPrefab = useStudioStore((s) => s.placingPrefab);
  const plotSize = useStudioStore((s) => s.plotSize);
  const placeInstance = useStudioStore((s) => s.placeInstance);
  const cancelPlacement = useStudioStore((s) => s.cancelPlacement);
  const gridSnap = useStudioStore((s) => s.gridSnap);

  const SNAP = 0.5;
  const halfW = plotSize.width / 2;
  const halfD = plotSize.depth / 2;

  if (!placingPrefab) return null;

  return (
    <>
      {/* Invisible floor for raycast */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onPointerMove={(e) => {
          e.stopPropagation();
          const pos = e.point;
          let x = gridSnap ? snap(pos.x, SNAP) : pos.x;
          let z = gridSnap ? snap(pos.z, SNAP) : pos.z;
          x = Math.max(-halfW, Math.min(halfW, x));
          z = Math.max(-halfD, Math.min(halfD, z));
          if (groupRef.current) {
            groupRef.current.position.set(x, 0, z);
            groupRef.current.visible = true;
          }
          invalidate();
        }}
        onClick={(e) => {
          e.stopPropagation();
          const pos = e.point;
          let x = gridSnap ? snap(pos.x, SNAP) : pos.x;
          let z = gridSnap ? snap(pos.z, SNAP) : pos.z;
          x = Math.max(-halfW, Math.min(halfW, x));
          z = Math.max(-halfD, Math.min(halfD, z));
          placeInstance([x, 0, z], 'editor');
          invalidate();
        }}
        onContextMenu={(e) => {
          e.stopPropagation();
          cancelPlacement();
          invalidate();
        }}
      >
        <planeGeometry args={[plotSize.width * 2, plotSize.depth * 2]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* Ghost mesh */}
      <group ref={groupRef} visible={false}>
        <Prefab3D definition={placingPrefab} />
      </group>
    </>
  );
}
