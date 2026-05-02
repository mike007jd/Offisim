/**
 * MeetingTableMesh3D — Conference table with chairs and whiteboard.
 *
 * Extracted from Office3DView.tsx MeetingRoomFurniture component.
 */

import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { SceneMaterial } from '../../../theme/scene-materials.js';
import { useSceneColors } from '../../../theme/use-scene-colors.js';
import { OfficeChair } from './WorkstationMesh3D.js';

export interface MeetingTableMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
  capacity?: 4 | 8;
}

export function MeetingTableMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
  capacity = 8,
}: MeetingTableMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const tableWidth = capacity === 4 ? 3.2 : 6;
  const tableDepth = capacity === 4 ? 1.65 : 2.2;
  const chairXs = capacity === 4 ? [-0.95, 0.95] : [-2, -0.7, 0.7, 2];

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {/* Conference table */}
      <RoundedBox
        args={[tableWidth, 0.08, tableDepth]}
        position={[0, 0.75, 0]}
        radius={0.1}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="wood" color={sc.furniture} />
      </RoundedBox>
      <mesh position={[0, 0.815, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[tableWidth * 0.72, tableDepth * 0.56]} />
        <SceneMaterial
          materialClass="fabric"
          color={sc.workMat}
          overrides={{ transparent: true, opacity: 0.72 }}
        />
      </mesh>
      <mesh position={[0, 0.9, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[capacity === 4 ? 0.64 : 0.9, capacity === 4 ? 0.38 : 0.5]} />
        <meshBasicMaterial color={sc.screen} transparent opacity={0.78} />
      </mesh>
      {/* Table base */}
      <mesh position={[0, 0.375, 0]} castShadow>
        <boxGeometry args={[tableWidth * 0.66, 0.75, tableDepth * 0.28]} />
        <SceneMaterial materialClass="plastic" color={sc.furnitureDark} />
      </mesh>
      {/* Chairs around table */}
      {chairXs.map((x) => (
        <group key={`mchair-${x}`}>
          <OfficeChair position={[x, 0, -tableDepth / 2 - 0.7]} />
          <OfficeChair position={[x, 0, tableDepth / 2 + 0.7]} rotation={[0, Math.PI, 0]} />
        </group>
      ))}
      {/* Whiteboard on wall */}
      <group position={[-5.5, 0, 0]}>
        <mesh position={[0, 1.8, 0]} castShadow>
          <boxGeometry args={[0.1, 1.5, 2.5]} />
          <SceneMaterial materialClass="plastic" color={sc.whiteboardSurface} />
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
