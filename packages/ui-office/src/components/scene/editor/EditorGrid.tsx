/**
 * EditorGrid — Enhanced floor grid visible only in edit mode.
 *
 * Renders a brighter, more visible grid overlay on the floor plane
 * to aid in furniture placement. Fades in/out with edit mode toggle.
 *
 * Must be rendered inside R3F Canvas.
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditor } from './EditorMode.js';
import { useSceneColors } from '../../../theme/use-scene-colors.js';

const ROOM_W = 40;
const GRID_DIVISIONS = 80; // 0.5 unit grid

export function EditorGrid() {
  const { mode } = useEditor();
  const sc = useSceneColors();
  const matRef = useRef<THREE.LineBasicMaterial>(null);
  const matRef2 = useRef<THREE.LineBasicMaterial>(null);

  const isEdit = mode === 'edit';
  const targetOpacity = isEdit ? 0.25 : 0;

  useFrame(() => {
    if (matRef.current) {
      matRef.current.opacity = THREE.MathUtils.lerp(
        matRef.current.opacity,
        targetOpacity,
        0.08,
      );
    }
    if (matRef2.current) {
      matRef2.current.opacity = THREE.MathUtils.lerp(
        matRef2.current.opacity,
        isEdit ? 0.12 : 0,
        0.08,
      );
    }
  });

  return (
    <group position={[0, 0.015, 0]}>
      {/* Major grid (every 2 units) */}
      <gridHelper args={[ROOM_W, ROOM_W / 2, sc.selectionRing, sc.selectionRing]}>
        <lineBasicMaterial
          ref={matRef}
          attach="material"
          color={sc.selectionRing}
          transparent
          opacity={0}
        />
      </gridHelper>
      {/* Minor grid (every 0.5 units) */}
      <gridHelper args={[ROOM_W, GRID_DIVISIONS, sc.selectionRing, sc.selectionRing]}>
        <lineBasicMaterial
          ref={matRef2}
          attach="material"
          color={sc.selectionRing}
          transparent
          opacity={0}
        />
      </gridHelper>
    </group>
  );
}
