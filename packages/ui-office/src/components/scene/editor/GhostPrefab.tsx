/**
 * GhostPrefab — Semi-transparent preview that follows the cursor during placement.
 *
 * Uses Three.js raycasting against the floor plane to track mouse position.
 * Snaps to a 0.5-unit grid for clean placement. Renders the Prefab3D component
 * with reduced opacity material override.
 *
 * Must be rendered inside R3F Canvas.
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Prefab3D } from '../prefabs/index.js';
import { useEditor } from './EditorMode.js';
import type { PrefabDefinition } from '@aics/shared-types';

// ── Constants ────────────────────────────────────────────────────

/** Grid snap increment (world units). */
const SNAP_SIZE = 0.5;

/** Floor plane for raycasting (y = 0). */
const _floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _intersectPoint = new THREE.Vector3();
const _pointer = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();

/** Snap a value to the nearest grid increment. */
function snap(v: number): number {
  return Math.round(v / SNAP_SIZE) * SNAP_SIZE;
}

// ── Component ────────────────────────────────────────────────────

export function GhostPrefab() {
  const { placingPrefab, activeTool, placePrefab, cancelPlacement } = useEditor();
  const { camera, gl } = useThree();
  const [worldPos, setWorldPos] = useState<[number, number, number]>([0, 0, 0]);
  const [visible, setVisible] = useState(false);
  const posRef = useRef<[number, number, number]>([0, 0, 0]);

  const isPlacing = activeTool === 'place' && placingPrefab !== null;

  // Raycast to floor plane
  const raycastToFloor = useCallback(
    (clientX: number, clientY: number): [number, number, number] | null => {
      const canvas = gl.domElement;
      const rect = canvas.getBoundingClientRect();
      _pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(_pointer, camera);
      const hit = _raycaster.ray.intersectPlane(_floorPlane, _intersectPoint);
      if (!hit) return null;
      return [snap(_intersectPoint.x), 0, snap(_intersectPoint.z)];
    },
    [camera, gl.domElement],
  );

  // Mouse move — update ghost position
  useEffect(() => {
    if (!isPlacing) {
      setVisible(false);
      return;
    }

    const canvas = gl.domElement;

    const handleMove = (e: PointerEvent) => {
      const pos = raycastToFloor(e.clientX, e.clientY);
      if (pos) {
        posRef.current = pos;
        setWorldPos(pos);
        setVisible(true);
      }
    };

    const handleClick = (e: MouseEvent) => {
      // Left click — place prefab
      if (e.button !== 0) return;
      const pos = posRef.current;
      if (pos && visible) {
        placePrefab(pos, 'editor');
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      // Right click — cancel placement
      e.preventDefault();
      cancelPlacement();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelPlacement();
      }
    };

    canvas.addEventListener('pointermove', handleMove);
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);

    // Set cursor to crosshair during placement
    canvas.style.cursor = 'crosshair';

    return () => {
      canvas.removeEventListener('pointermove', handleMove);
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
      canvas.style.cursor = 'default';
    };
  }, [isPlacing, gl.domElement, raycastToFloor, placePrefab, cancelPlacement, visible]);

  if (!isPlacing || !placingPrefab || !visible) return null;

  return (
    <GhostMesh
      definition={placingPrefab}
      position={worldPos}
    />
  );
}

// ── Ghost mesh with opacity override ─────────────────────────────

function GhostMesh({
  definition,
  position,
}: {
  definition: PrefabDefinition;
  position: [number, number, number];
}) {
  const groupRef = useRef<THREE.Group>(null);

  // Apply transparency to all materials in the group on every frame
  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.transparent !== true || mat.opacity > 0.45) {
          mat.transparent = true;
          mat.opacity = 0.4;
          mat.depthWrite = false;
        }
      }
    });
  });

  return (
    <group ref={groupRef}>
      {/* Placement ring on floor */}
      <mesh
        position={[position[0], 0.03, position[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[0.8, 1.0, 32]} />
        <meshBasicMaterial color="#10b981" transparent opacity={0.5} />
      </mesh>

      {/* Grid cell indicator */}
      <mesh
        position={[position[0], 0.02, position[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry
          args={[
            definition.gridSize[0] * SNAP_SIZE * 2,
            definition.gridSize[1] * SNAP_SIZE * 2,
          ]}
        />
        <meshBasicMaterial
          color="#10b981"
          transparent
          opacity={0.08}
        />
      </mesh>

      {/* Ghost prefab mesh */}
      <Prefab3D
        definition={definition}
        position={position}
        rotation={0}
      />
    </group>
  );
}
