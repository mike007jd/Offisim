/**
 * SelectionOutline — Visual highlight for selected editor prefabs.
 *
 * Renders a glowing ring at the base and a wireframe bounding box
 * around the selected prefab. Uses basic Three.js primitives to
 * avoid adding new dependencies.
 *
 * Must be rendered inside R3F Canvas.
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface SelectionOutlineProps {
  /** World position of the selected prefab. */
  position: [number, number, number];
  /** Approximate bounding size [width, depth] for the wireframe box. */
  size?: [number, number];
}

export function SelectionOutline({
  position,
  size = [2, 2],
}: SelectionOutlineProps) {
  const ringRef = useRef<THREE.Mesh>(null);
  const boxRef = useRef<THREE.LineSegments>(null);

  // Animate the selection ring opacity
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (ringRef.current) {
      const mat = ringRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.4 + Math.sin(t * 3) * 0.15;
    }
    if (boxRef.current) {
      const mat = boxRef.current.material as THREE.LineBasicMaterial;
      mat.opacity = 0.3 + Math.sin(t * 3 + 1) * 0.1;
    }
  });

  const boxH = 2.5; // Height of the selection wireframe

  return (
    <group position={position}>
      {/* Glowing selection ring at base */}
      <mesh
        ref={ringRef}
        position={[0, 0.04, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[
          Math.max(size[0], size[1]) * 0.6,
          Math.max(size[0], size[1]) * 0.75,
          32,
        ]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.5} />
      </mesh>

      {/* Wireframe bounding box */}
      <lineSegments ref={boxRef} position={[0, boxH / 2, 0]}>
        <edgesGeometry
          args={[new THREE.BoxGeometry(size[0], boxH, size[1])]}
        />
        <lineBasicMaterial color="#60a5fa" transparent opacity={0.35} />
      </lineSegments>

      {/* Corner markers — four dots at the base */}
      {([
        [-size[0] / 2, 0.05, -size[1] / 2],
        [size[0] / 2, 0.05, -size[1] / 2],
        [-size[0] / 2, 0.05, size[1] / 2],
        [size[0] / 2, 0.05, size[1] / 2],
      ] as [number, number, number][]).map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.08, 8, 8]} />
          <meshBasicMaterial color="#93c5fd" />
        </mesh>
      ))}
    </group>
  );
}
