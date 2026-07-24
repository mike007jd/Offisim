/**
 * DecorativeMesh3D — Decorative elements (plants, planters, etc.)
 *
 * Extracted from Office3DView.tsx Plant component.
 * The `template` prop selects which decorative variant to render.
 */

import {
  COFFEE_MACHINE_DIMENSIONS,
  FLOOR_LAMP_DIMENSIONS,
  FRIDGE_DIMENSIONS,
  MAGAZINE_RACK_DIMENSIONS,
  PANTRY_COUNTER_DIMENSIONS,
  PLANT_MEDIUM_DIMENSIONS,
  SNACK_SHELF_DIMENSIONS,
} from '@offisim/shared-types';
import { RoundedBox } from '@react-three/drei';
import { EmissiveMaterial, SceneMaterial } from '../scene-materials.js';
import {
  EmissiveDecalMaterial,
  SCENE_TRANSPARENT_RENDER_ORDER,
  SceneDecalMaterial,
  SceneGlassMaterial,
} from '../scene-surface-materials.js';
import { useSceneColors } from '../use-scene-colors.js';
import { OfficeChair } from './WorkstationMesh3D.js';

export interface PlantMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
  scale?: number;
}

const COFFEE_TABLE_STACK = {
  baseCenterY: 0.34,
  baseHeight: 0.08,
  glassThickness: 0.025,
  saucerHeight: 0.012,
  cupHeight: 0.08,
  baseBookHeight: 0.018,
  topBookHeight: 0.012,
} as const;

const COFFEE_TABLE_BASE_TOP = COFFEE_TABLE_STACK.baseCenterY + COFFEE_TABLE_STACK.baseHeight / 2;
const COFFEE_TABLE_GLASS_CENTER = COFFEE_TABLE_BASE_TOP + COFFEE_TABLE_STACK.glassThickness / 2;
const COFFEE_TABLE_SURFACE = COFFEE_TABLE_BASE_TOP + COFFEE_TABLE_STACK.glassThickness;

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

function CoffeeTableMesh3D({ position = [0, 0, 0], rotation = 0 }: PlantMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, COFFEE_TABLE_STACK.baseCenterY, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.25, COFFEE_TABLE_STACK.baseHeight, 0.72]} />
        <SceneMaterial
          materialClass="wood"
          color={sc.furnitureLight}
          overrides={{ roughness: 0.56 }}
        />
      </mesh>
      <mesh
        position={[0, COFFEE_TABLE_GLASS_CENTER, 0]}
        renderOrder={SCENE_TRANSPARENT_RENDER_ORDER.glass}
        castShadow={false}
      >
        <boxGeometry args={[1.08, COFFEE_TABLE_STACK.glassThickness, 0.56]} />
        <SceneGlassMaterial color={sc.partition} overrides={{ thickness: 0.04, roughness: 0.12 }} />
      </mesh>
      {[-0.48, 0.48].map((x) =>
        [-0.24, 0.24].map((z) => (
          <mesh key={`coffee-leg-${x}-${z}`} position={[x, 0.17, z]} castShadow>
            <cylinderGeometry args={[0.035, 0.035, 0.34, 8]} />
            <SceneMaterial materialClass="metal" color={sc.metal} />
          </mesh>
        )),
      )}
      <mesh
        position={[-0.28, COFFEE_TABLE_SURFACE + COFFEE_TABLE_STACK.saucerHeight / 2, 0.05]}
        castShadow
      >
        <cylinderGeometry args={[0.11, 0.11, COFFEE_TABLE_STACK.saucerHeight, 18]} />
        <SceneMaterial materialClass="ceramic" color={sc.furnitureDark} />
      </mesh>
      <mesh
        position={[
          -0.28,
          COFFEE_TABLE_SURFACE + COFFEE_TABLE_STACK.saucerHeight + COFFEE_TABLE_STACK.cupHeight / 2,
          0.05,
        ]}
        castShadow
      >
        <cylinderGeometry args={[0.08, 0.07, COFFEE_TABLE_STACK.cupHeight, 14]} />
        <SceneMaterial materialClass="ceramic" color={sc.whiteboardSurface} />
      </mesh>
      <mesh
        position={[0.18, COFFEE_TABLE_SURFACE + COFFEE_TABLE_STACK.baseBookHeight / 2, -0.05]}
        castShadow
      >
        <boxGeometry args={[0.42, COFFEE_TABLE_STACK.baseBookHeight, 0.28]} />
        <SceneMaterial materialClass="plastic" color={sc.furnitureDark} />
      </mesh>
      <mesh
        position={[
          0.18,
          COFFEE_TABLE_SURFACE +
            COFFEE_TABLE_STACK.baseBookHeight +
            COFFEE_TABLE_STACK.topBookHeight / 2,
          -0.05,
        ]}
        castShadow
      >
        <boxGeometry args={[0.38, COFFEE_TABLE_STACK.topBookHeight, 0.24]} />
        <SceneMaterial materialClass="fabric" color={sc.accentCool} />
      </mesh>
    </group>
  );
}

function VendingMachineMesh3D({ position = [0, 0, 0], rotation = 0 }: PlantMesh3DProps) {
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
        <SceneDecalMaterial materialClass="metal" color={sc.furnitureDark} />
      </mesh>
      <mesh position={[-0.1, 1.12, 0.335]}>
        <planeGeometry args={[0.42, 1.18]} />
        <SceneDecalMaterial
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
        <EmissiveDecalMaterial color={sc.vendingScreen} tier="signage" />
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

function WaterCoolerMesh3D({ position = [0, 0, 0], rotation = 0 }: PlantMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.45, 0]} castShadow>
        <cylinderGeometry args={[0.23, 0.26, 0.9, 18]} />
        <SceneMaterial materialClass="metal" color={sc.furnitureLight} />
      </mesh>
      <mesh
        position={[0, 1.08, 0]}
        renderOrder={SCENE_TRANSPARENT_RENDER_ORDER.glass}
        castShadow={false}
      >
        <cylinderGeometry args={[0.2, 0.26, 0.42, 18]} />
        <SceneGlassMaterial color={sc.accentCool} overrides={{ opacity: 0.48, thickness: 0.06 }} />
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

function StatusBoardMesh3D({ position = [0, 0, 0], rotation = 0 }: PlantMesh3DProps) {
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
        <EmissiveDecalMaterial color={sc.screen} tier="screen" />
      </mesh>
      {[-0.45, 0, 0.45].map((x, index) => (
        <mesh key={`status-bar-${x}`} position={[x, 1.08 + index * 0.11, 0.052]}>
          <planeGeometry args={[0.28, 0.05]} />
          <EmissiveDecalMaterial
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

// ── Rest & dining small appliances ──────────────────────────────
// Dimensions come from rest-prefab-dimensions.ts (shared-types) — the same
// constants that drive footprints and dramaturgy anchors.

function CoffeeMachineMesh3D({ position = [0, 0, 0], rotation = 0 }: PlantMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const d = COFFEE_MACHINE_DIMENSIONS;
  const bodyCenterY = d.standHeight + d.bodyHeight / 2;
  const bodyFrontZ = d.bodyDepth / 2;
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <RoundedBox
        args={[d.standWidth, d.standHeight, d.standDepth]}
        position={[0, d.standHeight / 2, 0]}
        radius={0.04}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="plastic" color={sc.furnitureLight} />
      </RoundedBox>
      <mesh position={[0, 0.03, 0]} castShadow>
        <boxGeometry args={[d.standWidth - 0.08, 0.06, d.standDepth - 0.08]} />
        <SceneMaterial materialClass="rubber" color={sc.furnitureDark} />
      </mesh>
      <RoundedBox
        args={[d.bodyWidth, d.bodyHeight, d.bodyDepth]}
        position={[0, bodyCenterY, -0.02]}
        radius={0.045}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="metal" color={sc.furniture} overrides={{ roughness: 0.4 }} />
      </RoundedBox>
      {/* Drip tray (出杯台) projecting from the body front. */}
      <mesh position={[0, d.standHeight + 0.01, bodyFrontZ - 0.06]} castShadow>
        <boxGeometry args={[0.3, 0.02, 0.18]} />
        <SceneMaterial materialClass="metal" color={sc.metal} />
      </mesh>
      <mesh position={[0, d.standHeight + 0.06, bodyFrontZ - 0.06]} castShadow>
        <cylinderGeometry args={[0.045, 0.04, 0.08, 12]} />
        <SceneMaterial materialClass="ceramic" color={sc.whiteboardSurface} />
      </mesh>
      {/* Brew head above the tray. */}
      <mesh position={[0, d.standHeight + 0.2, bodyFrontZ - 0.08]} castShadow>
        <boxGeometry args={[0.18, 0.1, 0.12]} />
        <SceneMaterial materialClass="metal" color={sc.furnitureDark} />
      </mesh>
      {/* Teal ready indicator. */}
      <mesh position={[0.16, d.standHeight + d.bodyHeight - 0.08, bodyFrontZ - 0.015]}>
        <planeGeometry args={[0.05, 0.025]} />
        <EmissiveDecalMaterial color={sc.ledCyan} tier="led" />
      </mesh>
    </group>
  );
}

function PantryCounterMesh3D({ position = [0, 0, 0], rotation = 0 }: PlantMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const d = PANTRY_COUNTER_DIMENSIONS;
  const topCenterY = d.counterHeight + d.topThickness / 2;
  const surfaceY = d.counterHeight + d.topThickness;
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <RoundedBox
        args={[d.counterWidth, d.counterHeight, d.counterDepth]}
        position={[0, d.counterHeight / 2, 0]}
        radius={0.05}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="plastic" color={sc.furnitureLight} />
      </RoundedBox>
      <mesh position={[0, 0.04, 0]} castShadow>
        <boxGeometry args={[d.counterWidth - 0.16, 0.08, d.counterDepth - 0.12]} />
        <SceneMaterial materialClass="rubber" color={sc.furnitureDark} />
      </mesh>
      <RoundedBox
        args={[
          d.counterWidth + d.topOverhang * 2,
          d.topThickness,
          d.counterDepth + d.topOverhang * 2,
        ]}
        position={[0, topCenterY, 0]}
        radius={d.topThickness / 2}
        smoothness={3}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="wood" color={sc.desk} />
      </RoundedBox>
      {/* Kettle */}
      <mesh position={[-0.72, surfaceY + 0.08, 0]} castShadow>
        <cylinderGeometry args={[0.085, 0.1, 0.16, 16]} />
        <SceneMaterial materialClass="metal" color={sc.metal} overrides={{ roughness: 0.3 }} />
      </mesh>
      <mesh position={[-0.62, surfaceY + 0.12, 0]} rotation={[0, 0, -0.5]} castShadow>
        <boxGeometry args={[0.06, 0.03, 0.03]} />
        <SceneMaterial materialClass="metal" color={sc.metal} />
      </mesh>
      <mesh position={[-0.72, surfaceY + 0.19, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.02, 12]} />
        <SceneMaterial materialClass="plastic" color={sc.furnitureDark} />
      </mesh>
      {/* Cup rack: rail plus three hanging cups. */}
      <mesh position={[0, surfaceY + 0.14, 0]} castShadow>
        <boxGeometry args={[0.4, 0.02, 0.02]} />
        <SceneMaterial materialClass="metal-brushed" color={sc.metal} />
      </mesh>
      {[-0.14, 0, 0.14].map((x) => (
        <mesh key={`cup-${x}`} position={[x, surfaceY + 0.06, 0]} castShadow>
          <cylinderGeometry args={[0.045, 0.04, 0.09, 12]} />
          <SceneMaterial materialClass="ceramic" color={sc.whiteboardSurface} />
        </mesh>
      ))}
      {/* Fruit bowl with three low-saturation fruits. */}
      <mesh position={[0.78, surfaceY + 0.03, 0]} scale={[1, 0.45, 1]} castShadow>
        <sphereGeometry args={[0.13, 18, 12]} />
        <SceneMaterial materialClass="ceramic" color={sc.furnitureLight} />
      </mesh>
      {(
        [
          [0.74, sc.ledAmber],
          [0.82, sc.ledGreen],
          [0.78, sc.accentWarm],
        ] as const
      ).map(([x, color], index) => (
        <mesh
          key={`fruit-${x}`}
          position={[x, surfaceY + 0.075 + (index === 2 ? 0.03 : 0), index === 2 ? 0.04 : -0.01]}
          castShadow
        >
          <sphereGeometry args={[0.035, 12, 10]} />
          <SceneMaterial materialClass="plastic" color={color} overrides={{ roughness: 0.6 }} />
        </mesh>
      ))}
    </group>
  );
}

function SnackShelfMesh3D({ position = [0, 0, 0], rotation = 0 }: PlantMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const d = SNACK_SHELF_DIMENSIONS;
  const snackColors = [sc.ledAmber, sc.ledCyan, sc.ledGreen, sc.accentWarm];
  const tierYs = [0.16, 0.52, 0.88, 1.24];
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {[-1, 1].map((side) => (
        <RoundedBox
          key={`shelf-side-${side}`}
          args={[d.panelThickness, d.shelfHeight, d.shelfDepth]}
          position={[side * (d.shelfWidth / 2 - d.panelThickness / 2), d.shelfHeight / 2, 0]}
          radius={d.panelThickness / 2}
          smoothness={3}
          castShadow
          receiveShadow
        >
          <SceneMaterial materialClass="wood" color={sc.desk} />
        </RoundedBox>
      ))}
      <mesh position={[0, d.shelfHeight / 2, -d.shelfDepth / 2 + 0.015]} castShadow>
        <boxGeometry args={[d.shelfWidth, d.shelfHeight, 0.03]} />
        <SceneMaterial materialClass="wood" color={sc.deskEdge} />
      </mesh>
      {tierYs.map((y) => (
        <mesh key={`shelf-tier-${y}`} position={[0, y, 0]} castShadow receiveShadow>
          <boxGeometry args={[d.shelfWidth - d.panelThickness * 2, 0.03, d.shelfDepth - 0.04]} />
          <SceneMaterial materialClass="wood" color={sc.desk} />
        </mesh>
      ))}
      {/* Colorful snack boxes — the one small-area accent on this prefab. */}
      {tierYs.map((tierY, tier) =>
        [-0.26, -0.02, 0.22].map((x, col) => {
          const height = 0.16 + ((tier + col) % 3) * 0.04;
          return (
            <RoundedBox
              key={`snack-${tierY}-${x}`}
              args={[0.18, height, 0.12]}
              position={[x, tierY + 0.015 + height / 2, 0.06]}
              radius={0.015}
              smoothness={3}
              castShadow
            >
              <SceneMaterial
                materialClass="plastic"
                color={snackColors[(tier + col) % snackColors.length] ?? sc.ledAmber}
                overrides={{ roughness: 0.62 }}
              />
            </RoundedBox>
          );
        }),
      )}
    </group>
  );
}

function FridgeMesh3D({ position = [0, 0, 0], rotation = 0 }: PlantMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const d = FRIDGE_DIMENSIONS;
  const doorFrontZ = d.bodyDepth / 2 + d.doorThickness / 2;
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <RoundedBox
        args={[d.bodyWidth, d.bodyHeight, d.bodyDepth]}
        position={[0, d.bodyHeight / 2, 0]}
        radius={0.06}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="metal" color={sc.furnitureLight} />
      </RoundedBox>
      <RoundedBox
        args={[d.bodyWidth - 0.06, d.bodyHeight - 0.12, d.doorThickness]}
        position={[0, d.bodyHeight / 2 + 0.01, doorFrontZ]}
        radius={d.doorThickness / 2}
        smoothness={3}
        castShadow
      >
        <SceneMaterial materialClass="metal" color={sc.furniture} overrides={{ roughness: 0.38 }} />
      </RoundedBox>
      {/* Handle */}
      <RoundedBox
        args={[0.04, 0.5, 0.05]}
        position={[d.bodyWidth / 2 - 0.1, d.bodyHeight * 0.58, doorFrontZ + 0.035]}
        radius={0.02}
        smoothness={3}
        castShadow
      >
        <SceneMaterial materialClass="metal-brushed" color={sc.metal} />
      </RoundedBox>
      {/* Toe vent */}
      <mesh position={[0, 0.09, d.bodyDepth / 2 + 0.002]}>
        <planeGeometry args={[d.bodyWidth - 0.2, 0.08]} />
        <SceneDecalMaterial materialClass="rubber" color={sc.furnitureDark} />
      </mesh>
    </group>
  );
}

function MagazineRackMesh3D({ position = [0, 0, 0], rotation = 0 }: PlantMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const d = MAGAZINE_RACK_DIMENSIONS;
  const tierYs = [0.36, 0.7, 1.04];
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <RoundedBox
        args={[d.rackWidth, d.rackHeight, d.panelThickness]}
        position={[0, d.rackHeight / 2, -d.rackDepth / 2 + d.panelThickness / 2]}
        radius={d.panelThickness / 2}
        smoothness={3}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="wood" color={sc.deskEdge} />
      </RoundedBox>
      {[-1, 1].map((side) => (
        <RoundedBox
          key={`rack-side-${side}`}
          args={[d.panelThickness, d.rackHeight, d.rackDepth]}
          position={[side * (d.rackWidth / 2 - d.panelThickness / 2), d.rackHeight / 2, 0]}
          radius={d.panelThickness / 2}
          smoothness={3}
          castShadow
        >
          <SceneMaterial materialClass="wood" color={sc.desk} />
        </RoundedBox>
      ))}
      <mesh position={[0, 0.03, 0]} castShadow>
        <boxGeometry args={[d.rackWidth, 0.06, d.rackDepth]} />
        <SceneMaterial materialClass="wood" color={sc.desk} />
      </mesh>
      {/* Slanted display shelves with leaning magazines. */}
      {tierYs.map((y, tier) => (
        <group key={`rack-tier-${y}`} position={[0, y, 0.02]} rotation={[-0.38, 0, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[d.rackWidth - d.panelThickness * 2, 0.02, 0.3]} />
            <SceneMaterial materialClass="wood" color={sc.desk} />
          </mesh>
          {[-0.13, 0.09].map((x, col) => (
            <mesh
              key={`mag-${y}-${x}`}
              position={[x, 0.09, 0.02]}
              rotation={[0.12, 0, (col === 0 ? -1 : 1) * 0.05]}
              castShadow
            >
              <boxGeometry args={[0.2, 0.16, 0.015]} />
              <SceneMaterial
                materialClass="plastic"
                color={sc.bookSpine[(tier * 2 + col) % sc.bookSpine.length] ?? sc.bookSpine[0]}
                overrides={{ roughness: 0.7 }}
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function FloorLampMesh3D({ position = [0, 0, 0], rotation = 0 }: PlantMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const d = FLOOR_LAMP_DIMENSIONS;
  const shadeCenterY = d.baseHeight + d.poleHeight + d.shadeHeight / 2 - 0.06;
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, d.baseHeight / 2, 0]} castShadow>
        <cylinderGeometry args={[d.baseRadius, d.baseRadius + 0.04, d.baseHeight, 18]} />
        <SceneMaterial materialClass="metal" color={sc.deskEdge} />
      </mesh>
      <mesh position={[0, d.baseHeight + d.poleHeight / 2, 0]} castShadow>
        <cylinderGeometry args={[d.poleRadius, d.poleRadius, d.poleHeight, 10]} />
        <SceneMaterial materialClass="metal-brushed" color={sc.deskEdge} />
      </mesh>
      <mesh position={[0, shadeCenterY, 0]} castShadow>
        <coneGeometry args={[d.shadeRadius, d.shadeHeight, 18, 1, true]} />
        <SceneMaterial materialClass="fabric" color={sc.furnitureLight} />
      </mesh>
      <mesh position={[0, shadeCenterY - d.shadeHeight / 2 + 0.04, 0]}>
        <sphereGeometry args={[0.08, 14, 10]} />
        <EmissiveMaterial color={sc.whiteboardSurface} tier="accent" intensity={0.34} />
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
    case 'coffee-machine':
      return <CoffeeMachineMesh3D position={position} rotation={rotation} state={state} />;
    case 'pantry-counter':
      return <PantryCounterMesh3D position={position} rotation={rotation} state={state} />;
    case 'snack-shelf':
      return <SnackShelfMesh3D position={position} rotation={rotation} state={state} />;
    case 'fridge':
      return <FridgeMesh3D position={position} rotation={rotation} state={state} />;
    case 'magazine-rack':
      return <MagazineRackMesh3D position={position} rotation={rotation} state={state} />;
    case 'floor-lamp':
      return <FloorLampMesh3D position={position} rotation={rotation} state={state} />;
    case 'plant-medium':
      return (
        <PlantMesh3D
          position={position}
          rotation={rotation}
          state={state}
          scale={PLANT_MEDIUM_DIMENSIONS.plantScale}
        />
      );
    default:
      return <PlantMesh3D position={position} rotation={rotation} state={state} />;
  }
}
