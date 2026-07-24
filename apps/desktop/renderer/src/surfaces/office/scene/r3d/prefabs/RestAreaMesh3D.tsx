/**
 * RestAreaMesh3D — Rest area with sofas, coffee table, and vending machine.
 *
 * Extracted from Office3DView.tsx RestAreaFurniture component.
 */

import { LOUNGE_BENCH_DIMENSIONS, SOFA_SINGLE_DIMENSIONS } from '@offisim/shared-types';
import { RoundedBox } from '@react-three/drei';
import { EmissiveMaterial, SceneMaterial } from '../scene-materials.js';
import { useSceneColors } from '../use-scene-colors.js';

const SEAT_CUSHION_THICKNESS = 0.1;
const SEAT_CUSHION_RADIUS = 0.04;

export interface RestAreaMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
  template?: 'sofa-set' | 'sofa-single' | 'lounge-bench';
}

/**
 * Single-seat armchair in the sofa-set visual language (leather body, fabric
 * cushion). Seat top honors the 0.42 chair-top contract.
 */
function SofaSingleMesh3D({ position = [0, 0, 0], rotation = 0 }: RestAreaMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const d = SOFA_SINGLE_DIMENSIONS;
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <RoundedBox
        args={[d.seatWidth, d.seatHeight, d.seatDepth]}
        position={[0, d.seatHeight / 2, 0]}
        radius={0.08}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="leather" color={sc.accentWarm} />
      </RoundedBox>
      <RoundedBox
        args={[d.seatWidth, d.backHeight, d.backDepth]}
        position={[0, d.seatHeight + d.backHeight / 2, -d.seatDepth / 2 + d.backDepth / 2]}
        radius={0.07}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="leather" color={sc.accentWarm} />
      </RoundedBox>
      {[-1, 1].map((side) => (
        <RoundedBox
          key={`armrest-${side}`}
          args={[d.armWidth, d.armHeight, d.seatDepth]}
          position={[side * (d.seatWidth / 2 - d.armWidth / 2), d.seatHeight + d.armHeight / 2, 0]}
          radius={0.05}
          smoothness={4}
          castShadow
          receiveShadow
        >
          <SceneMaterial materialClass="leather" color={sc.accentWarm} />
        </RoundedBox>
      ))}
      <RoundedBox
        args={[d.seatWidth - d.armWidth * 2 - 0.04, SEAT_CUSHION_THICKNESS, d.seatDepth - 0.24]}
        position={[0, d.seatHeight + SEAT_CUSHION_THICKNESS / 2, 0.04]}
        radius={SEAT_CUSHION_RADIUS}
        smoothness={4}
        castShadow
      >
        <SceneMaterial materialClass="fabric" color={sc.furnitureLight} />
      </RoundedBox>
    </group>
  );
}

/** Padded two-seat bench — low plinth base on small feet, fabric cushion. */
function LoungeBenchMesh3D({ position = [0, 0, 0], rotation = 0 }: RestAreaMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const d = LOUNGE_BENCH_DIMENSIONS;
  const baseCenterY = d.footHeight + d.baseHeight / 2;
  const cushionCenterY = d.footHeight + d.baseHeight + d.cushionThickness / 2;
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <RoundedBox
        args={[d.benchWidth, d.baseHeight, d.benchDepth]}
        position={[0, baseCenterY, 0]}
        radius={0.06}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="wood" color={sc.deskEdge} />
      </RoundedBox>
      <RoundedBox
        args={[d.benchWidth - 0.08, d.cushionThickness, d.benchDepth - 0.06]}
        position={[0, cushionCenterY, 0]}
        radius={SEAT_CUSHION_RADIUS}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="fabric" color={sc.furnitureLight} />
      </RoundedBox>
      {[-1, 1].map((xSide) =>
        [-1, 1].map((zSide) => (
          <mesh
            key={`bench-foot-${xSide}-${zSide}`}
            position={[
              xSide * (d.benchWidth / 2 - 0.08),
              d.footHeight / 2,
              zSide * (d.benchDepth / 2 - 0.08),
            ]}
            castShadow
          >
            <cylinderGeometry args={[0.03, 0.035, d.footHeight, 10]} />
            <SceneMaterial materialClass="metal" color={sc.metal} />
          </mesh>
        )),
      )}
    </group>
  );
}

function SofaSetMesh3D({ position = [0, 0, 0], rotation = 0 }: RestAreaMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <RoundedBox
        args={[3.9, 0.42, 1.12]}
        position={[-0.9, 0.24, -1.45]}
        radius={0.12}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="leather" color={sc.accentWarm} />
      </RoundedBox>
      <RoundedBox
        args={[3.9, 0.72, 0.28]}
        position={[-0.9, 0.58, -1.94]}
        radius={0.1}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="leather" color={sc.accentWarm} />
      </RoundedBox>
      <RoundedBox
        args={[1.1, 0.42, 2.6]}
        position={[-2.3, 0.24, -0.16]}
        radius={0.12}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="leather" color={sc.accentWarm} />
      </RoundedBox>
      <RoundedBox
        args={[0.28, 0.68, 2.6]}
        position={[-2.82, 0.56, -0.16]}
        radius={0.1}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="leather" color={sc.accentWarm} />
      </RoundedBox>

      {[-2.1, -1.05, 0.0].map((x) => (
        <RoundedBox
          key={`sofa-seat-${x}`}
          args={[0.78, SEAT_CUSHION_THICKNESS, 0.58]}
          position={[x, 0.49, -1.38]}
          radius={SEAT_CUSHION_RADIUS}
          smoothness={4}
          castShadow
        >
          <SceneMaterial materialClass="fabric" color={sc.furnitureLight} />
        </RoundedBox>
      ))}
      {[-0.9, 0.15].map((z) => (
        <RoundedBox
          key={`chaise-seat-${z}`}
          args={[0.58, SEAT_CUSHION_THICKNESS, 0.82]}
          position={[-2.28, 0.49, z]}
          radius={SEAT_CUSHION_RADIUS}
          smoothness={4}
          castShadow
        >
          <SceneMaterial materialClass="fabric" color={sc.furnitureLight} />
        </RoundedBox>
      ))}

      <RoundedBox
        args={[0.72, 0.18, 0.72]}
        position={[2.0, 0.2, 1.3]}
        radius={0.08}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="fabric" color={sc.furnitureLight} />
      </RoundedBox>
      <group position={[2.55, 0, -1.5]}>
        <mesh position={[0, 0.82, 0]} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 1.64, 10]} />
          <SceneMaterial materialClass="metal-brushed" color={sc.deskEdge} />
        </mesh>
        <mesh position={[0, 0.06, 0]} castShadow>
          <cylinderGeometry args={[0.28, 0.32, 0.06, 18]} />
          <SceneMaterial materialClass="metal" color={sc.deskEdge} />
        </mesh>
        <mesh position={[0, 1.68, 0]} castShadow>
          <coneGeometry args={[0.34, 0.34, 18, 1, true]} />
          <SceneMaterial materialClass="fabric" color={sc.furnitureLight} />
        </mesh>
        <mesh position={[0, 1.55, 0]}>
          <sphereGeometry args={[0.09, 14, 10]} />
          <EmissiveMaterial color={sc.whiteboardSurface} tier="accent" intensity={0.34} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * Renders a rest-area seating mesh based on the `template` name.
 * Falls back to the full sofa set if the template is unknown.
 */
export function RestAreaMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
  template = 'sofa-set',
}: RestAreaMesh3DProps) {
  switch (template) {
    case 'sofa-single':
      return <SofaSingleMesh3D position={position} rotation={rotation} />;
    case 'lounge-bench':
      return <LoungeBenchMesh3D position={position} rotation={rotation} />;
    default:
      return <SofaSetMesh3D position={position} rotation={rotation} />;
  }
}
