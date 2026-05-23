/**
 * MeetingTableMesh3D — Conference table with chairs and whiteboard.
 *
 * Extracted from Office3DView.tsx MeetingRoomFurniture component.
 */

import { RoundedBox } from '@react-three/drei';
import { EmissiveMaterial, SceneMaterial } from '../../../theme/scene-materials.js';
import { useSceneColors } from '../../../theme/use-scene-colors.js';
import { OfficeChair } from './WorkstationMesh3D.js';

function MeetingTrestleLeg({
  x,
  topY,
  spanZ,
  frameColor,
  footColor,
  ringColor,
  showAdjustmentRing,
}: {
  x: number;
  topY: number;
  spanZ: number;
  frameColor: string;
  footColor: string;
  ringColor: string;
  showAdjustmentRing: boolean;
}) {
  const footY = 0.04;
  const postBottomY = footY + 0.02;
  const postCenterY = postBottomY + (topY - postBottomY) / 2;
  const postHeight = topY - postBottomY;
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, postCenterY, 0]} castShadow>
        <boxGeometry args={[0.085, postHeight, 0.085]} />
        <SceneMaterial materialClass="metal-brushed" color={frameColor} />
      </mesh>
      <mesh position={[0, topY - 0.015, 0]} castShadow>
        <boxGeometry args={[0.4, 0.03, spanZ * 0.6]} />
        <SceneMaterial materialClass="metal-brushed" color={frameColor} />
      </mesh>
      <mesh position={[0, footY, 0]} castShadow>
        <boxGeometry args={[0.46, 0.04, spanZ * 0.7]} />
        <SceneMaterial materialClass="metal-brushed" color={frameColor} />
      </mesh>
      {[-1, 1].map((zSide) => (
        <mesh key={`pad-${x}-${zSide}`} position={[0, 0.02, zSide * spanZ * 0.32]} castShadow>
          <cylinderGeometry args={[0.05, 0.055, 0.02, 10]} />
          <SceneMaterial materialClass="rubber" color={footColor} />
        </mesh>
      ))}
      {showAdjustmentRing && (
        <mesh position={[0, postBottomY + 0.06, 0]} castShadow>
          <cylinderGeometry args={[0.055, 0.055, 0.012, 12]} />
          <SceneMaterial materialClass="metal-chrome" color={ringColor} />
        </mesh>
      )}
    </group>
  );
}

function MeetingTrestleBase({
  topY,
  trestleX,
  spanZ,
  frameColor,
  footColor,
  ringColor,
  isStanding,
}: {
  topY: number;
  trestleX: number;
  spanZ: number;
  frameColor: string;
  footColor: string;
  ringColor: string;
  isStanding: boolean;
}) {
  return (
    <>
      <MeetingTrestleLeg
        x={-trestleX}
        topY={topY}
        spanZ={spanZ}
        frameColor={frameColor}
        footColor={footColor}
        ringColor={ringColor}
        showAdjustmentRing={isStanding}
      />
      <MeetingTrestleLeg
        x={trestleX}
        topY={topY}
        spanZ={spanZ}
        frameColor={frameColor}
        footColor={footColor}
        ringColor={ringColor}
        showAdjustmentRing={isStanding}
      />
      <mesh position={[0, topY * 0.45, 0]} castShadow>
        <boxGeometry args={[trestleX * 1.6, 0.08, 0.18]} />
        <SceneMaterial materialClass="metal-brushed" color={frameColor} />
      </mesh>
    </>
  );
}

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
  const topY = isStanding ? 1.02 : 0.75;
  const trestleX = (tableWidth / 2) * (isStanding ? 0.3 : 0.62);

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
      <MeetingTrestleBase
        topY={topY}
        trestleX={trestleX}
        spanZ={tableDepth * 0.78}
        frameColor={sc.deskEdge}
        footColor={sc.cableChannel}
        ringColor={sc.metal}
        isStanding={isStanding}
      />
      {isStanding ? (
        <>
          <mesh position={[-0.55, 1.12, 0.18]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.46, 0.24]} />
            <EmissiveMaterial color={sc.screen} tier="screen" />
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
            <EmissiveMaterial color={sc.screen} tier="screen" />
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
