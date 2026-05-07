/**
 * MeetingTableMesh3D — Conference table with chairs and whiteboard.
 *
 * Extracted from Office3DView.tsx MeetingRoomFurniture component.
 */

import { RoundedBox } from '@react-three/drei';
import { SceneMaterial } from '../../../theme/scene-materials.js';
import { useSceneColors } from '../../../theme/use-scene-colors.js';
import { OfficeChair } from './WorkstationMesh3D.js';

export interface MeetingTableMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
  capacity?: 4 | 8;
  variant?: 'meeting' | 'standing';
}

export function MeetingTableMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
  capacity = 8,
  variant = 'meeting',
}: MeetingTableMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const isStanding = variant === 'standing';
  const tableWidth = capacity === 4 ? 3.2 : 6;
  const tableDepth = isStanding ? 1.05 : capacity === 4 ? 1.65 : 2.2;
  const chairXs = capacity === 4 ? [-0.95, 0.95] : [-2, -0.7, 0.7, 2];

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <RoundedBox
        args={[isStanding ? 2.2 : tableWidth, 0.08, tableDepth]}
        position={[0, isStanding ? 1.02 : 0.75, 0]}
        radius={0.1}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="wood" color={sc.furniture} />
      </RoundedBox>
      <mesh
        position={[0, isStanding ? 1.085 : 0.815, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[isStanding ? 1.45 : tableWidth * 0.72, tableDepth * 0.56]} />
        <SceneMaterial
          materialClass="fabric"
          color={sc.workMat}
          overrides={{ transparent: true, opacity: 0.72 }}
        />
      </mesh>
      <mesh position={[0, isStanding ? 0.53 : 0.375, 0]} castShadow>
        <boxGeometry
          args={[
            isStanding ? 0.52 : tableWidth * 0.66,
            isStanding ? 1.04 : 0.75,
            isStanding ? 0.42 : tableDepth * 0.28,
          ]}
        />
        <SceneMaterial materialClass="plastic" color={sc.furnitureDark} />
      </mesh>
      {isStanding ? (
        <>
          <mesh position={[-0.55, 1.12, 0.18]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.46, 0.24]} />
            <meshBasicMaterial color={sc.screen} transparent opacity={0.72} />
          </mesh>
          <mesh position={[0.5, 1.12, -0.14]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.38, 0.22]} />
            <SceneMaterial materialClass="fabric" color={sc.accentWarm} />
          </mesh>
        </>
      ) : (
        <>
          <mesh position={[0, 0.9, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[capacity === 4 ? 0.64 : 0.9, capacity === 4 ? 0.38 : 0.5]} />
            <meshBasicMaterial color={sc.screen} transparent opacity={0.78} />
          </mesh>
          {chairXs.map((x) => (
            <group key={`mchair-${x}`}>
              <OfficeChair position={[x, 0, -tableDepth / 2 - 0.7]} rotation={[0, Math.PI, 0]} />
              <OfficeChair position={[x, 0, tableDepth / 2 + 0.7]} />
            </group>
          ))}
        </>
      )}
    </group>
  );
}
