/**
 * RestDiningMesh3D — Warm-wood dining furniture for the rest area.
 *
 * dining-table-4: square table with four chairs (one per side).
 * cafe-table-2: small round pedestal table with two facing chairs.
 *
 * All dimensions come from `rest-prefab-dimensions.ts` in shared-types — the
 * same constants that drive the pathfinding footprints and the dramaturgy
 * seat anchors — so the rendered geometry can never drift from staging.
 * Table surfaces honor the 0.768 desk-top contract, chair seats the 0.42
 * chair-top contract.
 */

import {
  CAFE_TABLE_2_DIMENSIONS,
  DINING_TABLE_4_DIMENSIONS,
  REST_SEAT_TOP_Y,
  REST_TABLE_SURFACE_Y,
} from '@offisim/shared-types';
import { RoundedBox } from '@react-three/drei';
import { SceneMaterial } from '../scene-materials.js';
import { useSceneColors } from '../use-scene-colors.js';

export interface RestDiningMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
  template?: 'dining-table-4' | 'cafe-table-2';
}

interface DiningChairProps {
  position: [number, number, number];
  /** Y rotation in radians; 0 faces +z (backrest on the -z side). */
  rotationY?: number;
  seatWidth: number;
  seatDepth: number;
  seatThickness: number;
  backHeight: number;
  backThickness: number;
}

/** Simple warm-wood dining chair — no casters, unlike the office chair. */
function DiningChair({
  position,
  rotationY = 0,
  seatWidth,
  seatDepth,
  seatThickness,
  backHeight,
  backThickness,
}: DiningChairProps) {
  const sc = useSceneColors();
  const seatCenterY = REST_SEAT_TOP_Y - seatThickness / 2;
  const legHeight = REST_SEAT_TOP_Y - seatThickness;
  const legInsetX = seatWidth / 2 - 0.05;
  const legInsetZ = seatDepth / 2 - 0.05;
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <RoundedBox
        args={[seatWidth, seatThickness, seatDepth]}
        position={[0, seatCenterY, 0]}
        radius={seatThickness / 2}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="wood" color={sc.desk} />
      </RoundedBox>
      <RoundedBox
        args={[seatWidth, backHeight, backThickness]}
        position={[0, REST_SEAT_TOP_Y + backHeight / 2, -seatDepth / 2 + backThickness / 2]}
        radius={backThickness / 2}
        smoothness={4}
        castShadow
      >
        <SceneMaterial materialClass="wood" color={sc.desk} />
      </RoundedBox>
      {[-legInsetX, legInsetX].map((x) =>
        [-legInsetZ, legInsetZ].map((z) => (
          <mesh key={`dchair-leg-${x}-${z}`} position={[x, legHeight / 2, z]} castShadow>
            <cylinderGeometry args={[0.024, 0.028, legHeight, 8]} />
            <SceneMaterial materialClass="wood" color={sc.deskEdge} />
          </mesh>
        )),
      )}
    </group>
  );
}

function DiningTable4Mesh3D({ position = [0, 0, 0], rotation = 0 }: RestDiningMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const d = DINING_TABLE_4_DIMENSIONS;
  const topCenterY = REST_TABLE_SURFACE_Y - d.topThickness / 2;
  const legHeight = topCenterY - d.topThickness / 2;
  const legInset = d.topSize / 2 - 0.12;
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <RoundedBox
        args={[d.topSize, d.topThickness, d.topSize]}
        position={[0, topCenterY, 0]}
        radius={d.topThickness * 0.4}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="wood" color={sc.desk} />
      </RoundedBox>
      {[-legInset, legInset].map((x) =>
        [-legInset, legInset].map((z) => (
          <mesh key={`dtable-leg-${x}-${z}`} position={[x, legHeight / 2, z]} castShadow>
            <boxGeometry args={[d.legThickness, legHeight, d.legThickness]} />
            <SceneMaterial materialClass="wood" color={sc.deskEdge} />
          </mesh>
        )),
      )}
      <DiningChair
        position={[0, 0, d.chairOffset]}
        rotationY={Math.PI}
        seatWidth={d.chairSeatWidth}
        seatDepth={d.chairSeatDepth}
        seatThickness={d.chairSeatThickness}
        backHeight={d.chairBackHeight}
        backThickness={d.chairBackThickness}
      />
      <DiningChair
        position={[0, 0, -d.chairOffset]}
        seatWidth={d.chairSeatWidth}
        seatDepth={d.chairSeatDepth}
        seatThickness={d.chairSeatThickness}
        backHeight={d.chairBackHeight}
        backThickness={d.chairBackThickness}
      />
      <DiningChair
        position={[d.chairOffset, 0, 0]}
        rotationY={-Math.PI / 2}
        seatWidth={d.chairSeatWidth}
        seatDepth={d.chairSeatDepth}
        seatThickness={d.chairSeatThickness}
        backHeight={d.chairBackHeight}
        backThickness={d.chairBackThickness}
      />
      <DiningChair
        position={[-d.chairOffset, 0, 0]}
        rotationY={Math.PI / 2}
        seatWidth={d.chairSeatWidth}
        seatDepth={d.chairSeatDepth}
        seatThickness={d.chairSeatThickness}
        backHeight={d.chairBackHeight}
        backThickness={d.chairBackThickness}
      />
    </group>
  );
}

function CafeTable2Mesh3D({ position = [0, 0, 0], rotation = 0 }: RestDiningMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const d = CAFE_TABLE_2_DIMENSIONS;
  const topCenterY = REST_TABLE_SURFACE_Y - d.topThickness / 2;
  const columnHeight = topCenterY - d.topThickness / 2 - 0.04;
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, topCenterY, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[d.topRadius, d.topRadius, d.topThickness, 28]} />
        <SceneMaterial materialClass="wood" color={sc.desk} />
      </mesh>
      <mesh position={[0, 0.04 + columnHeight / 2, 0]} castShadow>
        <cylinderGeometry args={[d.columnRadius, d.columnRadius, columnHeight, 12]} />
        <SceneMaterial materialClass="metal-brushed" color={sc.deskEdge} />
      </mesh>
      <mesh position={[0, 0.02, 0]} castShadow>
        <cylinderGeometry args={[d.baseRadius, d.baseRadius + 0.03, 0.04, 24]} />
        <SceneMaterial materialClass="metal" color={sc.deskEdge} />
      </mesh>
      <DiningChair
        position={[0, 0, d.chairOffset]}
        rotationY={Math.PI}
        seatWidth={d.chairSeatWidth}
        seatDepth={d.chairSeatDepth}
        seatThickness={d.chairSeatThickness}
        backHeight={d.chairBackHeight}
        backThickness={d.chairBackThickness}
      />
      <DiningChair
        position={[0, 0, -d.chairOffset]}
        seatWidth={d.chairSeatWidth}
        seatDepth={d.chairSeatDepth}
        seatThickness={d.chairSeatThickness}
        backHeight={d.chairBackHeight}
        backThickness={d.chairBackThickness}
      />
    </group>
  );
}

/** Renders a rest-area dining mesh based on the `template` name. */
export function RestDiningMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
  template = 'dining-table-4',
}: RestDiningMesh3DProps) {
  switch (template) {
    case 'cafe-table-2':
      return <CafeTable2Mesh3D position={position} rotation={rotation} />;
    default:
      return <DiningTable4Mesh3D position={position} rotation={rotation} />;
  }
}
