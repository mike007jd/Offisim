/**
 * StudioGhost -- Ghost preview with placement validation feedback.
 *
 * Shows a semi-transparent prefab following the mouse during placement.
 * Green ground indicator = valid placement.
 * Red ground indicator = overlapping with existing prefab (blocked).
 *
 * Collision detection uses AABB overlap on grid-snapped positions.
 */

import { useRef, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useStudioStore } from './StudioState.js';
import { Prefab3D } from '../scene/prefabs/Prefab3D.js';
import { getBuiltinPrefab } from '@aics/renderer';
import { STUDIO_COLORS } from './studio-tokens.js';

function snap(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

const SNAP = 0.5;

// Colors for placement feedback — sourced from design tokens
const COLOR_VALID = new THREE.Color(STUDIO_COLORS.ghostValid);
const COLOR_BLOCKED = new THREE.Color(STUDIO_COLORS.ghostBlocked);

/**
 * Check if a new prefab at [x, z] with given grid size overlaps any existing instance.
 * Uses AABB overlap on the XZ plane.
 */
function checkOverlap(
  x: number,
  z: number,
  gridW: number,
  gridD: number,
  instances: { position: [number, number, number]; prefabId: string }[],
): boolean {
  const halfW = gridW * 0.9; // each grid unit ≈ 2 3D units, half = gridW, with slight margin
  const halfD = gridD * 0.9;

  for (const inst of instances) {
    const def = getBuiltinPrefab(inst.prefabId);
    if (!def) continue;
    const iHalfW = def.gridSize[0] * 0.9;
    const iHalfD = def.gridSize[1] * 0.9;

    const ix = inst.position[0];
    const iz = inst.position[2];

    // AABB overlap test
    if (
      Math.abs(x - ix) < halfW + iHalfW &&
      Math.abs(z - iz) < halfD + iHalfD
    ) {
      return true; // overlapping
    }
  }
  return false;
}

export function StudioGhost() {
  const groupRef = useRef<THREE.Group>(null!);
  const ringRef = useRef<THREE.Mesh>(null!);
  const blockedRef = useRef(false);
  const { invalidate } = useThree();

  const placingPrefab = useStudioStore((s) => s.placingPrefab);
  const plotSize = useStudioStore((s) => s.plotSize);
  const placeInstance = useStudioStore((s) => s.placeInstance);
  const cancelPlacement = useStudioStore((s) => s.cancelPlacement);
  const gridSnap = useStudioStore((s) => s.gridSnap);
  const instances = useStudioStore((s) => s.instances);

  const halfW = plotSize.width / 2;
  const halfD = plotSize.depth / 2;

  // Ring geometry for ground indicator (shared)
  const ringGeo = useMemo(() => {
    const geo = new THREE.RingGeometry(0.6, 0.8, 32);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  // Pulse animation for the ring
  useFrame(({ clock }) => {
    if (!ringRef.current || !placingPrefab) return;
    const t = clock.getElapsedTime();
    const mat = ringRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.5 + Math.sin(t * 4) * 0.15;
    mat.color = blockedRef.current ? COLOR_BLOCKED : COLOR_VALID;
    invalidate();
  });

  if (!placingPrefab) return null;

  const gridW = placingPrefab.gridSize[0];
  const gridD = placingPrefab.gridSize[1];

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

          // Check collision
          const isBlocked = checkOverlap(x, z, gridW, gridD, instances);
          blockedRef.current = isBlocked;

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

          // Block placement if overlapping
          if (checkOverlap(x, z, gridW, gridD, instances)) {
            return; // don't place
          }

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

      {/* Ghost mesh group */}
      <group ref={groupRef} visible={false}>
        {/* The prefab preview */}
        <Prefab3D definition={placingPrefab} />

        {/* Ground placement indicator ring */}
        <mesh
          ref={ringRef}
          geometry={ringGeo}
          position={[0, 0.02, 0]}
        >
          <meshBasicMaterial
            color={COLOR_VALID}
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Grid footprint — filled area (each grid unit ≈ 2 3D units) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <planeGeometry args={[gridW * 2.5, gridD * 2.5]} />
          <meshBasicMaterial
            color={COLOR_VALID}
            transparent
            opacity={0.15}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Grid footprint — wireframe border (rotated to XZ plane) */}
        <lineSegments rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <edgesGeometry args={[new THREE.PlaneGeometry(gridW * 2.5, gridD * 2.5)]} />
          <lineBasicMaterial color={COLOR_VALID} transparent opacity={0.8} />
        </lineSegments>

        {/* Size label (e.g., "2x2") */}
        <Html
          position={[0, 0.5, 0]}
          center
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <div style={{
            background: 'rgba(0,0,0,0.7)',
            color: '#22c55e',
            padding: '2px 6px',
            borderRadius: 3,
            fontSize: 11,
            fontFamily: 'monospace',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            border: '1px solid rgba(34,197,94,0.3)',
          }}>
            {gridW}x{gridD}
          </div>
        </Html>
      </group>
    </>
  );
}
