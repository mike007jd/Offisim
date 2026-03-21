// ── Lobster3D ─────────────────────────────────────────────────────────
// Procedural 3D lobster model for OpenClaw agents.
// Uses React Three Fiber + drei primitives — no GLTF required.
// Matches the same animation states as LowPolyCharacter so it drops
// into EmployeeMarker without any changes to the host component.

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

// ── Color palette ─────────────────────────────────────────────────────

interface LobsterColors {
  base: THREE.Color;
  dark: THREE.Color;
  darker: THREE.Color;
  belly: THREE.Color;
}

function lobsterColors(brandHex: string): LobsterColors {
  const base = new THREE.Color(brandHex);
  const dark = base.clone().multiplyScalar(0.7);
  const darker = base.clone().multiplyScalar(0.5);
  const belly = base.clone().lerp(new THREE.Color('#ffffff'), 0.3);
  return { base, dark, darker, belly };
}

// ── Sub-components ────────────────────────────────────────────────────

/** Single eye: stalk + white ball + black pupil dot */
function LobsterEye({ side, colors }: { side: -1 | 1; colors: LobsterColors }) {
  // Stalk
  const stalkX = side * 0.11;
  return (
    <group position={[stalkX, 0.52, -0.28]}>
      {/* Stalk */}
      <mesh castShadow>
        <cylinderGeometry args={[0.025, 0.025, 0.1, 6]} />
        <meshStandardMaterial color={colors.dark} roughness={0.6} />
      </mesh>
      {/* Eyeball */}
      <mesh position={[0, 0.075, 0]} castShadow>
        <sphereGeometry args={[0.055, 8, 8]} />
        <meshStandardMaterial color="#ffffff" roughness={0.3} />
      </mesh>
      {/* Pupil */}
      <mesh position={[side * 0.02, 0.075, 0.045]}>
        <sphereGeometry args={[0.025, 6, 6]} />
        <meshBasicMaterial color="#111111" />
      </mesh>
    </group>
  );
}

/** Single antenna: thin cylinder angled outward and forward */
function LobsterAntenna({
  side,
  colors,
  antennaRef,
}: {
  side: -1 | 1;
  colors: LobsterColors;
  antennaRef: React.RefObject<THREE.Group | null>;
}) {
  return (
    <group
      ref={antennaRef}
      position={[side * 0.08, 0.52, -0.32]}
      rotation={[0.3, side * -0.55, side * 0.35]}
    >
      <mesh castShadow>
        <cylinderGeometry args={[0.012, 0.006, 0.55, 5]} />
        <meshStandardMaterial color={colors.darker} roughness={0.8} />
      </mesh>
    </group>
  );
}

/** Single claw: upper arm cylinder + two pincer boxes */
function LobsterClaw({
  side,
  colors,
  clawRef,
}: {
  side: -1 | 1;
  colors: LobsterColors;
  clawRef: React.RefObject<THREE.Group | null>;
}) {
  const armX = side * 0.52;
  return (
    <group ref={clawRef} position={[armX, 0.28, -0.12]}>
      {/* Arm */}
      <mesh castShadow rotation={[0, 0, side * 0.35]}>
        <cylinderGeometry args={[0.055, 0.045, 0.32, 8]} />
        <meshStandardMaterial color={colors.dark} metalness={0.3} roughness={0.6} />
      </mesh>
      {/* Pincer top finger */}
      <mesh
        position={[side * 0.12, 0.08, 0]}
        rotation={[0, 0, side * -0.55]}
        castShadow
      >
        <boxGeometry args={[0.18, 0.055, 0.07]} />
        <meshStandardMaterial color={colors.darker} metalness={0.2} roughness={0.7} />
      </mesh>
      {/* Pincer bottom finger */}
      <mesh
        position={[side * 0.12, -0.02, 0]}
        rotation={[0, 0, side * 0.45]}
        castShadow
      >
        <boxGeometry args={[0.14, 0.045, 0.065]} />
        <meshStandardMaterial color={colors.darker} metalness={0.2} roughness={0.7} />
      </mesh>
    </group>
  );
}

/** 3 legs on one side */
function LobsterLegs({ side, colors }: { side: -1 | 1; colors: LobsterColors }) {
  const positions: [number, number, number][] = [
    [side * 0.42, 0.12, -0.22],
    [side * 0.42, 0.12, 0.0],
    [side * 0.42, 0.12, 0.2],
  ];
  const rotations: [number, number, number][] = [
    [0.4, 0, side * 0.7],
    [0.2, 0, side * 0.8],
    [-0.1, 0, side * 0.75],
  ];
  return (
    <>
      {positions.map((pos, i) => (
        <mesh
          key={i}
          position={pos}
          rotation={rotations[i]}
          castShadow
        >
          <cylinderGeometry args={[0.018, 0.012, 0.22, 5]} />
          <meshStandardMaterial color={colors.dark} roughness={0.8} />
        </mesh>
      ))}
    </>
  );
}

/** 3-segment tail fan trailing behind the carapace */
function LobsterTail({ colors }: { colors: LobsterColors }) {
  return (
    <group position={[0, 0.18, 0.45]}>
      {/* Central segment */}
      <mesh position={[0, 0, 0.0]} rotation={[0.3, 0, 0]} castShadow>
        <boxGeometry args={[0.16, 0.09, 0.18]} />
        <meshStandardMaterial color={colors.dark} metalness={0.2} roughness={0.65} />
      </mesh>
      {/* Mid segment */}
      <mesh position={[0, -0.04, 0.17]} rotation={[0.55, 0, 0]} castShadow>
        <boxGeometry args={[0.14, 0.08, 0.16]} />
        <meshStandardMaterial color={colors.dark} metalness={0.2} roughness={0.65} />
      </mesh>
      {/* Tail fan — three flat panels */}
      <mesh position={[0, -0.06, 0.31]} rotation={[0.75, 0, 0]} castShadow>
        <boxGeometry args={[0.22, 0.05, 0.14]} />
        <meshStandardMaterial color={colors.darker} metalness={0.15} roughness={0.7} />
      </mesh>
      <mesh position={[-0.12, -0.07, 0.29]} rotation={[0.75, 0, -0.25]} castShadow>
        <boxGeometry args={[0.1, 0.04, 0.13]} />
        <meshStandardMaterial color={colors.darker} metalness={0.15} roughness={0.7} />
      </mesh>
      <mesh position={[0.12, -0.07, 0.29]} rotation={[0.75, 0, 0.25]} castShadow>
        <boxGeometry args={[0.1, 0.04, 0.13]} />
        <meshStandardMaterial color={colors.darker} metalness={0.15} roughness={0.7} />
      </mesh>
    </group>
  );
}

// ── Props ─────────────────────────────────────────────────────────────

export interface Lobster3DProps {
  brandColor?: string;
  state: string;
  name: string;
  isSelected?: boolean;
}

// ── Main component ────────────────────────────────────────────────────

export function Lobster3D({
  brandColor = '#e74c3c',
  state,
  name,
  isSelected = false,
}: Lobster3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const clawLRef = useRef<THREE.Group>(null);
  const clawRRef = useRef<THREE.Group>(null);
  const antennaLRef = useRef<THREE.Group>(null);
  const antennaRRef = useRef<THREE.Group>(null);
  const tailRef = useRef<THREE.Group>(null);

  // Memoize color palette — only recomputed when brandColor changes
  const colors = useMemo(() => lobsterColors(brandColor), [brandColor]);

  useFrame((frameState) => {
    const t = frameState.clock.elapsedTime;

    const body = groupRef.current;
    const clawL = clawLRef.current;
    const clawR = clawRRef.current;
    const antennaL = antennaLRef.current;
    const antennaR = antennaRRef.current;
    const tail = tailRef.current;

    if (!body) return;

    // Reset every frame to avoid drift between state switches
    body.position.y = 0;
    body.position.x = 0;
    body.rotation.z = 0;

    switch (state) {
      case 'idle': {
        // Gentle bob, slow antenna sway, micro claw wiggle
        body.position.y = Math.sin(t * 1.5) * 0.03;
        if (antennaL) antennaL.rotation.z = 0.35 + Math.sin(t * 1.2) * 0.08;
        if (antennaR) antennaR.rotation.z = -0.55 + Math.sin(t * 1.4 + 1) * 0.08;
        if (clawL) clawL.rotation.z = Math.sin(t * 1.0) * 0.04;
        if (clawR) clawR.rotation.z = Math.sin(t * 1.0 + 0.5) * 0.04;
        break;
      }

      case 'executing':
      case 'working': {
        // Fast claw clipping + excited body bob
        body.position.y = Math.sin(t * 6) * 0.025;
        if (clawL) clawL.rotation.x = Math.sin(t * 8) * 0.18;
        if (clawR) clawR.rotation.x = Math.sin(t * 8 + Math.PI) * 0.18;
        if (antennaL) antennaL.rotation.z = 0.35 + Math.sin(t * 4) * 0.12;
        if (antennaR) antennaR.rotation.z = -0.55 + Math.sin(t * 4 + 0.3) * 0.12;
        break;
      }

      case 'thinking': {
        // Left claw raised near chin, body tilts, antenna curls inward
        body.position.y = Math.sin(t * 1.2) * 0.04;
        body.rotation.z = Math.sin(t * 0.8) * 0.06;
        if (clawL) {
          clawL.rotation.z = Math.sin(t * 0.9) * 0.06;
          clawL.position.y = 0.28 + Math.sin(t * 1.1) * 0.08;
        }
        if (antennaL) antennaL.rotation.z = 0.22 + Math.sin(t * 1.0) * 0.1;
        if (antennaR) antennaR.rotation.z = -0.38 + Math.sin(t * 1.0 + 0.5) * 0.1;
        break;
      }

      case 'blocked':
      case 'failed': {
        // Defensive hunkered pose, rapid shake, claws forward
        body.position.y = -0.06 + Math.sin(t * 12) * 0.015;
        body.position.x = Math.sin(t * 14) * 0.025;
        if (clawL) {
          clawL.rotation.x = 0.3;
          clawL.rotation.z = -0.1;
        }
        if (clawR) {
          clawR.rotation.x = 0.3;
          clawR.rotation.z = 0.1;
        }
        if (antennaL) antennaL.rotation.z = 0.18;
        if (antennaR) antennaR.rotation.z = -0.38;
        break;
      }

      case 'meeting':
      case 'talking': {
        // Expressive claw gestures, antenna emphasize
        body.position.y = Math.sin(t * 2) * 0.02;
        body.rotation.z = Math.sin(t * 1.5) * 0.05;
        if (clawL) clawL.rotation.z = Math.sin(t * 2.5) * 0.22;
        if (clawR) clawR.rotation.z = Math.sin(t * 2.5 + 0.8) * 0.22;
        if (antennaL) antennaL.rotation.z = 0.35 + Math.sin(t * 2) * 0.18;
        if (antennaR) antennaR.rotation.z = -0.55 + Math.sin(t * 2 + 0.4) * 0.18;
        break;
      }

      case 'success':
      case 'excited': {
        // Jump with both claws spread wide, tail flick
        body.position.y = Math.abs(Math.sin(t * 4)) * 0.12;
        if (clawL) {
          clawL.rotation.z = Math.sin(t * 3) * 0.35;
          clawL.rotation.x = Math.sin(t * 4) * 0.2;
        }
        if (clawR) {
          clawR.rotation.z = Math.sin(t * 3 + 0.5) * 0.35;
          clawR.rotation.x = Math.sin(t * 4 + 0.3) * 0.2;
        }
        if (antennaL) antennaL.rotation.z = 0.35 + Math.sin(t * 3) * 0.25;
        if (antennaR) antennaR.rotation.z = -0.55 + Math.sin(t * 3 + 0.3) * 0.25;
        if (tail) tail.rotation.x = Math.sin(t * 5) * 0.22;
        break;
      }

      case 'resting': {
        // Body sinks, slow antenna droop
        body.position.y = -0.04 + Math.sin(t * 0.8) * 0.015;
        if (clawL) {
          clawL.rotation.x = 0.15;
          clawL.rotation.z = 0;
        }
        if (clawR) {
          clawR.rotation.x = 0.15;
          clawR.rotation.z = 0;
        }
        if (antennaL) antennaL.rotation.z = 0.2 + Math.sin(t * 0.6) * 0.05;
        if (antennaR) antennaR.rotation.z = -0.4 + Math.sin(t * 0.7) * 0.05;
        break;
      }

      case 'searching': {
        // Antenna sweep wide, body raised, eyes imply scan
        body.position.y = Math.sin(t * 2) * 0.035 + 0.02;
        if (antennaL) antennaL.rotation.z = 0.35 + Math.sin(t * 1.8) * 0.4;
        if (antennaR) antennaR.rotation.z = -0.55 + Math.sin(t * 1.8 + 0.6) * 0.4;
        if (clawL) clawL.rotation.z = Math.sin(t * 1.5) * 0.1;
        if (clawR) clawR.rotation.z = Math.sin(t * 1.5 + 0.4) * 0.1;
        break;
      }

      case 'reporting': {
        // Right claw raised and extended presenting
        body.position.y = Math.sin(t * 1.8) * 0.02;
        if (clawR) {
          clawR.rotation.z = 0.45 + Math.sin(t * 1.2) * 0.08;
          clawR.rotation.x = -0.25;
        }
        if (clawL) clawL.rotation.z = -0.05;
        if (antennaL) antennaL.rotation.z = 0.3 + Math.sin(t * 1.4) * 0.07;
        if (antennaR) antennaR.rotation.z = -0.48 + Math.sin(t * 1.4 + 0.4) * 0.07;
        break;
      }

      case 'paused': {
        // Still — slight droop
        body.position.y = -0.03;
        break;
      }

      default: {
        body.position.y = Math.sin(t * 1.5) * 0.02;
        break;
      }
    }
  });

  const baseHex = colors.base.getHexString();
  const darkHex = colors.dark.getHexString();
  const bellyHex = colors.belly.getHexString();

  return (
    <group ref={groupRef}>
      {/* ── Selection ring ── */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.7, 0.85, 32]} />
          <meshBasicMaterial color="#3b82f6" transparent opacity={0.8} />
        </mesh>
      )}

      {/* ── Status foot ring ── */}
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.45, 0.56, 32]} />
        <meshBasicMaterial color={`#${baseHex}`} transparent opacity={0.35} />
      </mesh>

      {/* ── Body (carapace) ── */}
      {/* Main shell — ellipsoid via scaled sphere */}
      <mesh position={[0, 0.3, 0]} scale={[1.0, 0.72, 1.35]} castShadow>
        <sphereGeometry args={[0.38, 16, 12]} />
        <meshStandardMaterial
          color={`#${baseHex}`}
          metalness={0.3}
          roughness={0.6}
        />
      </mesh>
      {/* Belly highlight */}
      <mesh position={[0, 0.22, 0.06]} scale={[0.65, 0.55, 1.1]} castShadow>
        <sphereGeometry args={[0.38, 14, 10]} />
        <meshStandardMaterial
          color={`#${bellyHex}`}
          metalness={0.15}
          roughness={0.7}
        />
      </mesh>
      {/* Head section — smaller ellipsoid at front */}
      <mesh position={[0, 0.38, -0.36]} scale={[0.8, 0.65, 0.7]} castShadow>
        <sphereGeometry args={[0.25, 12, 10]} />
        <meshStandardMaterial color={`#${darkHex}`} metalness={0.3} roughness={0.55} />
      </mesh>

      {/* ── Tail ── */}
      <group ref={tailRef}>
        <LobsterTail colors={colors} />
      </group>

      {/* ── Legs ── */}
      <LobsterLegs side={-1} colors={colors} />
      <LobsterLegs side={1} colors={colors} />

      {/* ── Claws ── */}
      <LobsterClaw side={-1} colors={colors} clawRef={clawLRef} />
      <LobsterClaw side={1} colors={colors} clawRef={clawRRef} />

      {/* ── Eyes ── */}
      <LobsterEye side={-1} colors={colors} />
      <LobsterEye side={1} colors={colors} />

      {/* ── Antennae ── */}
      <LobsterAntenna side={-1} colors={colors} antennaRef={antennaLRef} />
      <LobsterAntenna side={1} colors={colors} antennaRef={antennaRRef} />

      {/* ── Name label ── */}
      <Html position={[0, 1.05, 0]} center distanceFactor={12} style={{ pointerEvents: 'none' }}>
        <div style={{
          fontSize: '9px',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 700,
          color: 'rgba(255,255,255,0.85)',
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(4px)',
          borderRadius: '9999px',
          padding: '2px 7px',
          whiteSpace: 'nowrap',
        }}>
          {name}
        </div>
      </Html>

      {/* ── OpenClaw badge ── */}
      <Html position={[0, -0.3, 0]} center style={{ pointerEvents: 'none' }}>
        <span style={{
          fontSize: '7px',
          color: 'rgba(239,68,68,0.6)',
          fontFamily: 'monospace',
          userSelect: 'none',
        }}>
          OpenClaw 🦞
        </span>
      </Html>
    </group>
  );
}

export default Lobster3D;
