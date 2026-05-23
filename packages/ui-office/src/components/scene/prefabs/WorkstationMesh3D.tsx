/**
 * WorkstationMesh3D — 4-seat desk cluster with laptops and glass dividers.
 *
 * Extracted from Office3DView.tsx DeskCluster component.
 * Renders a complete workstation prefab with desk surface, legs,
 * glass dividers, laptops, and office chairs.
 */

import { RoundedBox } from '@react-three/drei';
import { hashStringToInt } from '../../../lib/scene-hash.js';
import { EmissiveMaterial, SceneMaterial } from '../../../theme/scene-materials.js';
import { useSceneColors } from '../../../theme/use-scene-colors.js';

// ── Sub-components (shared with other prefabs) ────────────────────

const CHAIR_SPOKE_COUNT = 5;
const CHAIR_SPOKE_RADIUS = 0.32;
const CHAIR_CASTER_RADIUS = 0.04;

function ChairBase({
  spokeColor,
  hubColor,
  casterColor,
}: {
  spokeColor: string;
  hubColor: string;
  casterColor: string;
}) {
  return (
    <group position={[0, CHAIR_CASTER_RADIUS, 0]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.08, 0.1, 0.06, 16]} />
        <SceneMaterial materialClass="metal-brushed" color={hubColor} />
      </mesh>
      {Array.from({ length: CHAIR_SPOKE_COUNT }, (_, i) => i).map((i) => {
        const angle = (i / CHAIR_SPOKE_COUNT) * Math.PI * 2;
        const cx = Math.cos(angle) * (CHAIR_SPOKE_RADIUS * 0.55);
        const cz = Math.sin(angle) * (CHAIR_SPOKE_RADIUS * 0.55);
        return (
          <group key={`chair-spoke-${angle.toFixed(3)}`}>
            <mesh position={[cx, 0.0, cz]} rotation={[0, -angle, 0]} castShadow>
              <boxGeometry args={[CHAIR_SPOKE_RADIUS * 1.1, 0.045, 0.08]} />
              <SceneMaterial materialClass="metal-brushed" color={spokeColor} />
            </mesh>
            <mesh
              position={[
                Math.cos(angle) * CHAIR_SPOKE_RADIUS,
                -0.018,
                Math.sin(angle) * CHAIR_SPOKE_RADIUS,
              ]}
              castShadow
            >
              <sphereGeometry args={[CHAIR_CASTER_RADIUS, 10, 8]} />
              <SceneMaterial materialClass="rubber" color={casterColor} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function ChairPneumaticColumn({ color }: { color: string }) {
  return (
    <group position={[0, 0.32, 0]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.045, 0.05, 0.24, 14]} />
        <SceneMaterial materialClass="metal-chrome" color={color} />
      </mesh>
      <mesh position={[0, 0.13, 0]} castShadow>
        <cylinderGeometry args={[0.052, 0.052, 0.022, 14]} />
        <SceneMaterial materialClass="metal-chrome" color={color} />
      </mesh>
      <mesh position={[0, 0.18, 0]} castShadow>
        <cylinderGeometry args={[0.032, 0.032, 0.08, 12]} />
        <SceneMaterial materialClass="metal-chrome" color={color} />
      </mesh>
    </group>
  );
}

function ChairTiltMechanism({ color }: { color: string }) {
  return (
    <mesh position={[0, 0.5, 0]} castShadow>
      <boxGeometry args={[0.22, 0.06, 0.18]} />
      <SceneMaterial materialClass="plastic" color={color} overrides={{ roughness: 0.5 }} />
    </mesh>
  );
}

function ChairArmrest({
  side,
  upholsteryColor,
  frameColor,
}: {
  side: 1 | -1;
  upholsteryColor: string;
  frameColor: string;
}) {
  const x = side * 0.28;
  return (
    <group position={[x, 0.6, -0.02]}>
      <mesh position={[0, 0.12, 0]} castShadow>
        <boxGeometry args={[0.04, 0.24, 0.05]} />
        <SceneMaterial materialClass="metal" color={frameColor} overrides={{ roughness: 0.38 }} />
      </mesh>
      <RoundedBox
        args={[0.085, 0.04, 0.28]}
        position={[0, 0.255, 0.06]}
        radius={0.018}
        smoothness={3}
        castShadow
      >
        <SceneMaterial materialClass="leather" color={upholsteryColor} />
      </RoundedBox>
    </group>
  );
}

function ChairBackrest({
  upholsteryColor,
  frameColor,
}: {
  upholsteryColor: string;
  frameColor: string;
}) {
  return (
    <group position={[0, 0.85, 0.22]}>
      <mesh position={[0, -0.06, -0.012]} castShadow>
        <boxGeometry args={[0.04, 0.22, 0.03]} />
        <SceneMaterial materialClass="metal" color={frameColor} overrides={{ roughness: 0.36 }} />
      </mesh>
      <RoundedBox
        args={[0.42, 0.2, 0.06]}
        position={[0, 0.02, 0]}
        radius={0.04}
        smoothness={4}
        castShadow
      >
        <SceneMaterial materialClass="leather" color={upholsteryColor} />
      </RoundedBox>
      <RoundedBox
        args={[0.38, 0.18, 0.06]}
        position={[0, 0.22, 0.018]}
        radius={0.05}
        smoothness={4}
        castShadow
      >
        <SceneMaterial materialClass="leather" color={upholsteryColor} />
      </RoundedBox>
    </group>
  );
}

export function OfficeChair({
  position,
  rotation = [0, 0, 0],
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  const sc = useSceneColors();
  return (
    <group position={position} rotation={rotation}>
      <ChairBase
        spokeColor={sc.furnitureDark}
        hubColor={sc.furnitureLight}
        casterColor={sc.furnitureDark}
      />
      <ChairPneumaticColumn color={sc.furnitureLight} />
      <ChairTiltMechanism color={sc.furnitureDark} />
      <RoundedBox
        args={[0.5, 0.08, 0.48]}
        position={[0, 0.56, 0]}
        radius={0.04}
        smoothness={4}
        castShadow
      >
        <SceneMaterial materialClass="leather" color={sc.furniture} />
      </RoundedBox>
      <ChairArmrest side={-1} upholsteryColor={sc.furnitureDark} frameColor={sc.furnitureLight} />
      <ChairArmrest side={1} upholsteryColor={sc.furnitureDark} frameColor={sc.furnitureLight} />
      <ChairBackrest upholsteryColor={sc.furniture} frameColor={sc.furnitureLight} />
    </group>
  );
}

export function Laptop({
  position,
  rotation = [0, 0, 0],
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  const sc = useSceneColors();
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.01, 0]} castShadow>
        <boxGeometry args={[0.4, 0.02, 0.3]} />
        <SceneMaterial materialClass="metal" color={sc.metal} overrides={{ roughness: 0.25 }} />
      </mesh>
      <group position={[0, 0.02, -0.15]} rotation={[-0.2, 0, 0]}>
        <mesh position={[0, 0.15, 0]} castShadow>
          <boxGeometry args={[0.4, 0.3, 0.02]} />
          <SceneMaterial materialClass="metal" color={sc.metal} overrides={{ roughness: 0.25 }} />
        </mesh>
        <mesh position={[0, 0.15, 0.011]}>
          <planeGeometry args={[0.38, 0.28]} />
          <EmissiveMaterial color={sc.screen} tier="screen" />
        </mesh>
      </group>
    </group>
  );
}

export function WorkSurfaceAccent3D({
  width,
  depth,
  opacity = 0.76,
}: {
  width: number;
  depth: number;
  opacity?: number;
}) {
  const sc = useSceneColors();
  return (
    <group position={[0, 0.006, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <SceneMaterial
          materialClass="fabric"
          color={sc.workMat}
          overrides={{ transparent: true, opacity }}
        />
      </mesh>
      <mesh position={[0, 0.006, -depth / 2 + 0.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[Math.min(width * 0.72, 0.62), 0.035]} />
        <meshBasicMaterial color={sc.cableAccent} transparent opacity={0.55} />
      </mesh>
    </group>
  );
}

export interface WorkstationUnit3DProps {
  position?: [number, number, number];
  rotation?: number;
  variant?: 'standard' | 'compact' | 'dual';
  state?: string;
}

export function WorkstationUnit3D({
  position = [0, 0, 0],
  rotation = 0,
  variant = 'standard',
  state: _state,
}: WorkstationUnit3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const isCompact = variant === 'compact';
  const isDual = variant === 'dual';
  const deskWidth = isCompact ? 1.45 : 2.1;
  const deskDepth = isCompact ? 1.05 : 1.25;
  const laptopPositions = isDual
    ? ([
        [-0.35, -0.2, Math.PI + 0.1],
        [0.35, -0.2, Math.PI - 0.1],
      ] as [number, number, number][])
    : ([[0, -0.2, Math.PI]] as [number, number, number][]);

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <RoundedBox
        args={[deskWidth, 0.055, deskDepth]}
        position={[0, 0.74, 0]}
        radius={0.02}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <SceneMaterial
          materialClass="wood"
          color={sc.desk}
          overrides={{ useProceduralNormal: true, normalScale: 0.06 }}
        />
      </RoundedBox>
      <group position={[0, 0.775, 0.16]}>
        <WorkSurfaceAccent3D width={deskWidth * 0.62} depth={deskDepth * 0.46} opacity={0.78} />
      </group>
      {[-1, 1].map((xSign) =>
        [-1, 1].map((zSign) => (
          <mesh
            key={`unit-leg-${xSign}-${zSign}`}
            position={[xSign * (deskWidth / 2 - 0.12), 0.37, zSign * (deskDepth / 2 - 0.12)]}
            castShadow
          >
            <cylinderGeometry args={[0.035, 0.035, 0.72, 8]} />
            <SceneMaterial
              materialClass="metal"
              color={sc.deskEdge}
              overrides={{ roughness: 0.3 }}
            />
          </mesh>
        )),
      )}
      <mesh position={[0, 1.05, -deskDepth / 2 + 0.06]} castShadow>
        <boxGeometry args={[deskWidth * 0.82, 0.48, 0.045]} />
        <SceneMaterial materialClass="glass" color={sc.partition} overrides={{ thickness: 0.04 }} />
      </mesh>
      {laptopPositions.map(([x, z, rot]) => (
        <Laptop key={`unit-laptop-${x}`} position={[x, 0.78, z]} rotation={[0, rot, 0]} />
      ))}
      {!isCompact && <OfficeChair position={[0, 0, deskDepth / 2 + 0.5]} />}
    </group>
  );
}

// ── Main component ────────────────────────────────────────────────

export interface WorkstationMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
}

// L-shaped corner partition framing each seat.
function CornerPartition({
  position,
  rotation,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
}) {
  const sc = useSceneColors();
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow>
        <boxGeometry args={[1.1, 1.1, 0.05]} />
        <SceneMaterial materialClass="glass" color={sc.partition} overrides={{ thickness: 0.05 }} />
      </mesh>
      <mesh position={[0.55, 0, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[1.1, 1.1, 0.05]} />
        <SceneMaterial materialClass="glass" color={sc.partition} overrides={{ thickness: 0.05 }} />
      </mesh>
      {/* Valance: wood cap along top edge */}
      <mesh position={[0, 0.58, 0]} castShadow>
        <boxGeometry args={[1.15, 0.06, 0.07]} />
        <SceneMaterial materialClass="wood" color={sc.deskEdge} />
      </mesh>
      <mesh position={[0.55, 0.58, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[1.15, 0.06, 0.07]} />
        <SceneMaterial materialClass="wood" color={sc.deskEdge} />
      </mesh>
    </group>
  );
}

// ── Desk props per workstation seat (seed-driven, asymmetric) ─────────────

type PropKind = 'mug' | 'paperStack' | 'lamp' | 'notes' | 'monitor';

const PROP_KINDS: ReadonlyArray<PropKind> = ['mug', 'paperStack', 'lamp', 'notes', 'monitor'];

function pickPropsForSeat(seed: number, index: number): PropKind[] {
  // Simple deterministic prop set from seed + index — 1 or 2 props per seat,
  // with one slot guaranteed empty to keep the table breathable.
  const hash = (seed * 9301 + index * 49297 + 233280) % 233280;
  const slotA = PROP_KINDS[Math.floor((hash / 53) % PROP_KINDS.length)] ?? 'mug';
  const slotB = PROP_KINDS[Math.floor((hash / 197) % PROP_KINDS.length)] ?? 'notes';
  const showSecond = hash % 7 < 4;
  return showSecond && slotB !== slotA ? [slotA, slotB] : [slotA];
}

const PROP_MUG_COLOR = '#d97757'; // raw-hex-allowed: terracotta mug
const PROP_NOTE_COLOR = '#f5c161'; // raw-hex-allowed: sticky note amber

function DeskProp({ kind, x, z }: { kind: PropKind; x: number; z: number }) {
  const sc = useSceneColors();
  if (kind === 'mug') {
    return (
      <group position={[x, 0.78, z]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.045, 0.05, 0.085, 14]} />
          <SceneMaterial materialClass="ceramic" color={PROP_MUG_COLOR} />
        </mesh>
        <mesh position={[0.055, 0.005, 0]} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.022, 0.008, 6, 14, Math.PI]} />
          <SceneMaterial materialClass="ceramic" color={PROP_MUG_COLOR} />
        </mesh>
      </group>
    );
  }
  if (kind === 'paperStack') {
    return (
      <mesh position={[x, 0.79, z]} castShadow>
        <boxGeometry args={[0.16, 0.06, 0.22]} />
        <SceneMaterial
          materialClass="plastic"
          color={sc.wallPanel}
          overrides={{ roughness: 0.88 }}
        />
      </mesh>
    );
  }
  if (kind === 'lamp') {
    return (
      <group position={[x, 0.78, z]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.06, 0.08, 0.03, 14]} />
          <SceneMaterial materialClass="metal-brushed" color={sc.furnitureLight} />
        </mesh>
        <mesh position={[0, 0.13, 0]} castShadow>
          <cylinderGeometry args={[0.008, 0.008, 0.22, 6]} />
          <SceneMaterial materialClass="metal-brushed" color={sc.furnitureLight} />
        </mesh>
        <mesh position={[0.04, 0.24, 0]} rotation={[0, 0, 0.3]} castShadow>
          <coneGeometry args={[0.07, 0.1, 12, 1, true]} />
          <SceneMaterial materialClass="metal-brushed" color={sc.furniture} />
        </mesh>
      </group>
    );
  }
  if (kind === 'notes') {
    return (
      <mesh position={[x, 0.787, z]} rotation={[-Math.PI / 2, 0, 0.08]} castShadow>
        <planeGeometry args={[0.1, 0.1]} />
        <SceneMaterial materialClass="fabric" color={PROP_NOTE_COLOR} />
      </mesh>
    );
  }
  // monitor (small external display next to laptop)
  return (
    <group position={[x, 0.78, z]}>
      <mesh position={[0, 0.18, 0]} castShadow>
        <boxGeometry args={[0.36, 0.22, 0.02]} />
        <SceneMaterial materialClass="plastic" color={sc.furnitureDark} />
      </mesh>
      <mesh position={[0, 0.18, 0.011]}>
        <planeGeometry args={[0.34, 0.2]} />
        <EmissiveMaterial color={sc.screen} tier="screen" />
      </mesh>
      <mesh position={[0, 0.05, 0]} castShadow>
        <boxGeometry args={[0.025, 0.1, 0.025]} />
        <SceneMaterial materialClass="metal-brushed" color={sc.furniture} />
      </mesh>
      <mesh position={[0, 0.005, 0]} castShadow>
        <boxGeometry args={[0.18, 0.012, 0.12]} />
        <SceneMaterial materialClass="metal-brushed" color={sc.furniture} />
      </mesh>
    </group>
  );
}

function DeskGrommet({ x, z }: { x: number; z: number }) {
  const sc = useSceneColors();
  return (
    <mesh position={[x, 0.778, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.025, 0.038, 16]} />
      <SceneMaterial materialClass="plastic" color={sc.furnitureDark} />
    </mesh>
  );
}

function TrestleLeg({ side, deskHalfWidth }: { side: 1 | -1; deskHalfWidth: number }) {
  const sc = useSceneColors();
  return (
    <group position={[side * (deskHalfWidth - 0.45), 0, 0]}>
      {/* Two vertical posts forming the trestle */}
      {[-1, 1].map((zSide) => (
        <mesh key={`trestle-post-${zSide}`} position={[0, 0.37, zSide * 1.3]} castShadow>
          <boxGeometry args={[0.07, 0.74, 0.07]} />
          <SceneMaterial materialClass="metal-brushed" color={sc.deskEdge} />
        </mesh>
      ))}
      {/* Horizontal cross beam */}
      <mesh position={[0, 0.15, 0]} castShadow>
        <boxGeometry args={[0.05, 0.05, 2.6]} />
        <SceneMaterial materialClass="metal-brushed" color={sc.deskEdge} />
      </mesh>
      {/* Foot flange */}
      {[-1, 1].map((zSide) => (
        <mesh key={`trestle-foot-${zSide}`} position={[0, 0.02, zSide * 1.3]} castShadow>
          <boxGeometry args={[0.34, 0.035, 0.18]} />
          <SceneMaterial materialClass="metal-brushed" color={sc.deskEdge} />
        </mesh>
      ))}
    </group>
  );
}

const WORKSTATION_SEAT_LAYOUT: ReadonlyArray<{
  x: number;
  z: number;
  laptopRot: number;
  chairZ: number;
  chairRot: number;
}> = [
  { x: -0.8, z: -0.8, laptopRot: Math.PI + 0.2, chairZ: -0.8, chairRot: Math.PI },
  { x: 0.8, z: -0.8, laptopRot: Math.PI - 0.2, chairZ: -0.8, chairRot: Math.PI },
  { x: -0.8, z: 0.8, laptopRot: -0.2, chairZ: 0.8, chairRot: 0 },
  { x: 0.8, z: 0.8, laptopRot: 0.2, chairZ: 0.8, chairRot: 0 },
] as const;

export function WorkstationMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
}: WorkstationMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  // Position-derived seed: each placed workstation gets a stable prop layout.
  const seed = hashStringToInt(`${position[0].toFixed(2)}:${position[2].toFixed(2)}`);

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {/* Desk surface */}
      <RoundedBox
        args={[3.2, 0.05, 3.2]}
        position={[0, 0.75, 0]}
        radius={0.02}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <SceneMaterial
          materialClass="wood"
          color={sc.desk}
          overrides={{ useProceduralNormal: true, normalScale: 0.18 }}
        />
      </RoundedBox>
      {/* Per-seat mat */}
      {(
        [
          [-0.8, -0.9, Math.PI],
          [0.8, -0.9, Math.PI],
          [-0.8, 0.9, 0],
          [0.8, 0.9, 0],
        ] as [number, number, number][]
      ).map(([x, z, rot]) => (
        <group key={`mat-${x}-${z}`} position={[x, 0.785, z]} rotation={[0, rot, 0]}>
          <WorkSurfaceAccent3D width={0.76} depth={0.46} opacity={0.82} />
        </group>
      ))}
      {/* Cable grommets at quadrant centres */}
      {(
        [
          [-0.55, -0.55],
          [0.55, -0.55],
          [-0.55, 0.55],
          [0.55, 0.55],
        ] as [number, number][]
      ).map(([gx, gz]) => (
        <DeskGrommet key={`grommet-${gx}-${gz}`} x={gx} z={gz} />
      ))}

      <TrestleLeg side={-1} deskHalfWidth={1.6} />
      <TrestleLeg side={1} deskHalfWidth={1.6} />

      <CornerPartition position={[-0.05, 1.05, -0.05]} rotation={[0, 0, 0]} />
      <CornerPartition position={[0.05, 1.05, -0.05]} rotation={[0, Math.PI * 1.5, 0]} />
      <CornerPartition position={[-0.05, 1.05, 0.05]} rotation={[0, Math.PI / 2, 0]} />
      <CornerPartition position={[0.05, 1.05, 0.05]} rotation={[0, Math.PI, 0]} />

      {/* Per-seat workstation: laptop + props seed-driven */}
      {WORKSTATION_SEAT_LAYOUT.map((seat, index) => (
        <group key={`ws-${seat.x}-${seat.z}`} position={[seat.x, 0, seat.z]}>
          <Laptop position={[0, 0.775, 0]} rotation={[0, seat.laptopRot, 0]} />
          {pickPropsForSeat(seed, index).map((kind, propIndex) => {
            // place props slightly to one side of the laptop based on seat side
            const offsetX = propIndex === 0 ? -0.22 : 0.22;
            const offsetZ = 0.12 * (seat.z < 0 ? 1 : -1);
            return (
              <DeskProp
                key={`prop-${index}-${propIndex}-${kind}`}
                kind={kind}
                x={offsetX}
                z={offsetZ}
              />
            );
          })}
          <OfficeChair
            position={[0, 0, seat.chairZ < 0 ? -0.8 : 0.8]}
            rotation={[0, seat.chairRot, 0]}
          />
        </group>
      ))}
    </group>
  );
}
