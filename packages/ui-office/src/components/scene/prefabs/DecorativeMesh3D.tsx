/**
 * DecorativeMesh3D — Decorative elements (plants, planters, etc.)
 *
 * Extracted from Office3DView.tsx Plant component.
 * The `template` prop selects which decorative variant to render.
 */

import { EmissiveMaterial, SceneMaterial } from '../../../theme/scene-materials.js';
import { useSceneColors } from '../../../theme/use-scene-colors.js';
import { OfficeChair } from './WorkstationMesh3D.js';

export interface PlantMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
  scale?: number;
}

/** Standalone plant mesh — pot + foliage. */
export function PlantMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
  scale = 1,
}: PlantMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;

  return (
    <group position={position} rotation={[0, rotY, 0]} scale={[scale, scale, scale]}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.15, 0.5, 16]} />
        <SceneMaterial materialClass="plastic" color={sc.desk} overrides={{ roughness: 0.85 }} />
      </mesh>
      <mesh position={[0, 0.55, 0]} castShadow>
        <icosahedronGeometry args={[0.32, 1]} />
        <SceneMaterial
          materialClass="plastic"
          color={sc.leafPrimary}
          overrides={{ roughness: 0.65 }}
        />
      </mesh>
      <mesh position={[-0.12, 0.5, 0.08]} castShadow>
        <icosahedronGeometry args={[0.22, 1]} />
        <SceneMaterial
          materialClass="plastic"
          color={sc.leafSecondary}
          overrides={{ roughness: 0.65 }}
        />
      </mesh>
      <mesh position={[0.14, 0.48, -0.08]} castShadow>
        <icosahedronGeometry args={[0.2, 1]} />
        <SceneMaterial
          materialClass="plastic"
          color={sc.leafTertiary}
          overrides={{ roughness: 0.65 }}
        />
      </mesh>
      {(
        [
          [-0.28, 0.52, 0.0, -0.4],
          [0.3, 0.5, 0.1, 0.35],
          [0.0, 0.62, 0.22, 0.0],
          [-0.1, 0.56, -0.24, -0.2],
          [0.22, 0.46, -0.18, 0.6],
        ] as const
      ).map(([lx, ly, lz, rot]) => (
        <mesh
          key={`plant-blade-${lx}-${lz}`}
          position={[lx, ly, lz]}
          rotation={[0.5, rot, 0.15]}
          castShadow
        >
          <boxGeometry args={[0.04, 0.18, 0.012]} />
          <SceneMaterial
            materialClass="plastic"
            color={sc.leafSecondary}
            overrides={{ roughness: 0.7 }}
          />
        </mesh>
      ))}
    </group>
  );
}

export function CoffeeTableMesh3D({ position = [0, 0, 0], rotation = 0 }: PlantMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.34, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.25, 0.08, 0.72]} />
        <SceneMaterial
          materialClass="wood"
          color={sc.furnitureLight}
          overrides={{ roughness: 0.56 }}
        />
      </mesh>
      <mesh position={[0, 0.395, 0]} castShadow>
        <boxGeometry args={[1.08, 0.025, 0.56]} />
        <SceneMaterial
          materialClass="glass"
          color={sc.partition}
          overrides={{ thickness: 0.04, roughness: 0.12 }}
        />
      </mesh>
      {[-0.48, 0.48].map((x) =>
        [-0.24, 0.24].map((z) => (
          <mesh key={`coffee-leg-${x}-${z}`} position={[x, 0.17, z]} castShadow>
            <cylinderGeometry args={[0.035, 0.035, 0.34, 8]} />
            <SceneMaterial materialClass="metal" color={sc.metal} />
          </mesh>
        )),
      )}
      <mesh position={[-0.28, 0.396, 0.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.05, 0.11, 18]} />
        <SceneMaterial
          materialClass="plastic"
          color={sc.furnitureDark}
          overrides={{ transparent: true, opacity: 0.32 }}
        />
      </mesh>
      <mesh position={[-0.28, 0.44, 0.05]} castShadow>
        <cylinderGeometry args={[0.08, 0.07, 0.08, 14]} />
        <SceneMaterial materialClass="ceramic" color={sc.whiteboardSurface} />
      </mesh>
      <mesh position={[0.18, 0.397, -0.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.42, 0.28]} />
        <SceneMaterial
          materialClass="plastic"
          color={sc.furnitureDark}
          overrides={{ transparent: true, opacity: 0.22 }}
        />
      </mesh>
      <mesh position={[0.18, 0.4, -0.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.38, 0.24]} />
        <SceneMaterial
          materialClass="fabric"
          color={sc.accentCool}
          overrides={{ transparent: true, opacity: 0.42 }}
        />
      </mesh>
    </group>
  );
}

export function VendingMachineMesh3D({ position = [0, 0, 0], rotation = 0 }: PlantMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const productColors = [sc.ledCyan, sc.ledGreen, sc.ledAmber, sc.accentWarm];
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 1.12, 0]} castShadow>
        <boxGeometry args={[0.86, 2.08, 0.62]} />
        <SceneMaterial materialClass="metal" color={sc.furniture} overrides={{ roughness: 0.32 }} />
      </mesh>
      {/* Toe-kick recess: darker narrower base reads as ground contact. */}
      <mesh position={[0, 0.06, 0.02]} castShadow>
        <boxGeometry args={[0.78, 0.12, 0.56]} />
        <SceneMaterial
          materialClass="rubber"
          color={sc.furnitureDark}
          overrides={{ roughness: 0.85 }}
        />
      </mesh>
      <mesh position={[0, 1.08, 0.325]}>
        <planeGeometry args={[0.74, 1.94]} />
        <SceneMaterial materialClass="metal" color={sc.furnitureDark} />
      </mesh>
      <mesh position={[-0.1, 1.12, 0.335]}>
        <planeGeometry args={[0.42, 1.18]} />
        <SceneMaterial
          materialClass="glass"
          color={sc.partition}
          overrides={{ thickness: 0.05, transparent: true, opacity: 0.62 }}
        />
      </mesh>
      {[0.75, 1.05, 1.35].map((y, row) =>
        [-0.22, -0.08, 0.06].map((x, col) => (
          <mesh key={`vending-item-${x}-${y}`} position={[x, y, 0.35]} castShadow>
            <boxGeometry args={[0.09, 0.18, 0.025]} />
            <SceneMaterial
              materialClass="plastic"
              color={productColors[(row + col) % productColors.length] ?? sc.ledCyan}
            />
          </mesh>
        )),
      )}
      <mesh position={[0.29, 1.48, 0.34]}>
        <planeGeometry args={[0.2, 0.28]} />
        <EmissiveMaterial color={sc.vendingScreen} tier="signage" />
      </mesh>
      <mesh position={[0.29, 0.8, 0.34]}>
        <boxGeometry args={[0.22, 0.08, 0.035]} />
        <SceneMaterial materialClass="metal" color={sc.metal} />
      </mesh>
      <mesh position={[0, 0.08, 0.33]} castShadow>
        <boxGeometry args={[0.72, 0.08, 0.08]} />
        <SceneMaterial materialClass="plastic" color={sc.furnitureDark} />
      </mesh>
    </group>
  );
}

export function WaterCoolerMesh3D({ position = [0, 0, 0], rotation = 0 }: PlantMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.45, 0]} castShadow>
        <cylinderGeometry args={[0.23, 0.26, 0.9, 18]} />
        <SceneMaterial materialClass="metal" color={sc.furnitureLight} />
      </mesh>
      <mesh position={[0, 1.08, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.26, 0.42, 18]} />
        <SceneMaterial
          materialClass="glass"
          color={sc.accentCool}
          overrides={{ transparent: true, opacity: 0.48, thickness: 0.06 }}
        />
      </mesh>
      <mesh position={[0, 0.82, 0.25]} castShadow>
        <boxGeometry args={[0.34, 0.1, 0.08]} />
        <SceneMaterial materialClass="plastic" color={sc.furnitureDark} />
      </mesh>
      {[-0.08, 0.08].map((x) => (
        <mesh key={`cooler-spout-${x}`} position={[x, 0.73, 0.31]} castShadow>
          <boxGeometry args={[0.035, 0.08, 0.08]} />
          <SceneMaterial materialClass="metal" color={sc.metal} />
        </mesh>
      ))}
    </group>
  );
}

export function StatusBoardMesh3D({ position = [0, 0, 0], rotation = 0 }: PlantMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 1.22, 0]} castShadow>
        <boxGeometry args={[1.75, 1.02, 0.08]} />
        <SceneMaterial materialClass="plastic" color={sc.furnitureDark} />
      </mesh>
      <mesh position={[0, 1.22, 0.045]}>
        <planeGeometry args={[1.55, 0.82]} />
        <EmissiveMaterial color={sc.screen} tier="screen" />
      </mesh>
      {[-0.45, 0, 0.45].map((x, index) => (
        <mesh key={`status-bar-${x}`} position={[x, 1.08 + index * 0.11, 0.052]}>
          <planeGeometry args={[0.28, 0.05]} />
          <EmissiveMaterial
            color={[sc.ledGreen, sc.ledAmber, sc.ledCyan][index] ?? sc.ledCyan}
            tier="led"
          />
        </mesh>
      ))}
      <mesh position={[0, 0.44, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 0.88, 12]} />
        <SceneMaterial materialClass="metal-brushed" color={sc.metal} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={`statusboard-leg-${side}`}
          position={[side * 0.22, 0.22, 0]}
          rotation={[0, 0, side * 0.32]}
          castShadow
        >
          <boxGeometry args={[0.04, 0.42, 0.05]} />
          <SceneMaterial materialClass="metal-brushed" color={sc.metal} />
        </mesh>
      ))}
      <mesh position={[0, 0.05, 0]} castShadow>
        <boxGeometry args={[0.9, 0.08, 0.48]} />
        <SceneMaterial materialClass="metal-brushed" color={sc.metal} />
      </mesh>
      <mesh position={[0, 0.11, 0]} castShadow>
        <boxGeometry args={[0.7, 0.05, 0.38]} />
        <SceneMaterial materialClass="metal-brushed" color={sc.furnitureDark} />
      </mesh>
    </group>
  );
}

// ── Template-driven decorative dispatcher ─────────────────────────

export interface DecorativeMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
  template?: string;
}

/**
 * Renders a decorative mesh based on the `template` name.
 * Falls back to a plant if the template is unknown.
 */
export function DecorativeMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state,
  template = 'plant',
}: DecorativeMesh3DProps) {
  switch (template) {
    case 'plant':
      return <PlantMesh3D position={position} rotation={rotation} state={state} />;
    case 'plant-small':
      return <PlantMesh3D position={position} rotation={rotation} state={state} scale={0.72} />;
    case 'plant-large':
      return <PlantMesh3D position={position} rotation={rotation} state={state} scale={1.35} />;
    case 'coffee-table':
      return <CoffeeTableMesh3D position={position} rotation={rotation} state={state} />;
    case 'vending-machine':
      return <VendingMachineMesh3D position={position} rotation={rotation} state={state} />;
    case 'water-cooler':
      return <WaterCoolerMesh3D position={position} rotation={rotation} state={state} />;
    case 'chair-standalone':
      return <OfficeChair position={position} rotation={[0, (rotation * Math.PI) / 180, 0]} />;
    case 'status-board':
      return <StatusBoardMesh3D position={position} rotation={rotation} state={state} />;
    default:
      return <PlantMesh3D position={position} rotation={rotation} state={state} />;
  }
}
