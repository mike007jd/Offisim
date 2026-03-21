/**
 * InfrastructureMesh3D — Network switches, cable trays, etc.
 *
 * New component for infrastructure-category prefabs that don't have
 * a full server-room–scale representation.
 */

import { useSceneColors } from '../../../theme/use-scene-colors.js';

export interface InfrastructureMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
}

/** Flat 1U network switch box with indicator LEDs and port holes. */
export function NetworkSwitchMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
}: InfrastructureMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {/* Switch body */}
      <mesh position={[0, 0.06, 0]} castShadow>
        <boxGeometry args={[1.2, 0.08, 0.4]} />
        <meshStandardMaterial color={sc.furniture} metalness={0.6} roughness={0.3} />
      </mesh>
      {/* Front panel */}
      <mesh position={[0, 0.06, 0.21]}>
        <planeGeometry args={[1.1, 0.06]} />
        <meshStandardMaterial color={sc.furnitureDark} />
      </mesh>
      {/* Port indicators */}
      {[-0.4, -0.2, 0, 0.2, 0.4].map((x, i) => (
        <mesh key={`port-${i}`} position={[x, 0.06, 0.215]}>
          <circleGeometry args={[0.015, 6]} />
          <meshBasicMaterial color={i % 2 === 0 ? sc.leafPrimary : sc.ledCyan} />
        </mesh>
      ))}
    </group>
  );
}

/** Horizontal cable tray / cable channel on the floor. */
export function CableTrayMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
}: InfrastructureMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.3, 3]} />
        <meshStandardMaterial color={sc.furnitureDark} />
      </mesh>
    </group>
  );
}

/**
 * Generic infrastructure dispatcher based on template name.
 */
export function InfrastructureMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state,
}: InfrastructureMesh3DProps) {
  return <NetworkSwitchMesh3D position={position} rotation={rotation} state={state} />;
}
