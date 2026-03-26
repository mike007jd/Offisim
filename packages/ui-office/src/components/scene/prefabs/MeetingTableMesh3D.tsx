/**
 * MeetingTableMesh3D — Conference table with chairs and whiteboard.
 *
 * Extracted from Office3DView.tsx MeetingRoomFurniture component.
 */

import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { useSceneColors } from '../../../theme/use-scene-colors.js';
import { OfficeChair } from './WorkstationMesh3D.js';

export interface MeetingTableMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
}

export function MeetingTableMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
}: MeetingTableMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {/* Conference table */}
      <RoundedBox
        args={[6, 0.08, 2.2]}
        position={[0, 0.75, 0]}
        radius={0.1}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={sc.furniture} roughness={0.3} />
      </RoundedBox>
      {/* Table base */}
      <mesh position={[0, 0.375, 0]} castShadow>
        <boxGeometry args={[4, 0.75, 0.6]} />
        <meshStandardMaterial color={sc.furnitureDark} />
      </mesh>
      {/* Chairs around table */}
      {[-2, -0.7, 0.7, 2].map((x) => (
        <group key={`mchair-${x}`}>
          <OfficeChair position={[x, 0, -1.8]} />
          <OfficeChair position={[x, 0, 1.8]} rotation={[0, Math.PI, 0]} />
        </group>
      ))}
      {/* Whiteboard on wall */}
      <group position={[-5.5, 0, 0]}>
        <mesh position={[0, 1.8, 0]} castShadow>
          <boxGeometry args={[0.1, 1.5, 2.5]} />
          <meshStandardMaterial color={sc.desk} roughness={0.3} />
        </mesh>
        {/* Whiteboard frame */}
        <lineSegments position={[0.06, 1.8, 0]}>
          <edgesGeometry args={[new THREE.PlaneGeometry(2.5, 1.5)]} />
          <lineBasicMaterial color={sc.metal} />
        </lineSegments>
      </group>
    </group>
  );
}
