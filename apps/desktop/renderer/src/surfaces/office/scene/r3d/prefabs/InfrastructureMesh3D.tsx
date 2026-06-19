/**
 * InfrastructureMesh3D — Network switches, cable trays, etc.
 *
 * New component for infrastructure-category prefabs that don't have
 * a full server-room–scale representation.
 */

import { SceneMaterial } from '../scene-materials.js';
import { useSceneColors } from '../use-scene-colors.js';

export interface InfrastructureMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
  template?: string;
}

/** Flat 1U network switch box with indicator LEDs and port holes. */
function NetworkSwitchMesh3D({
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
        <SceneMaterial materialClass="metal" color={sc.furniture} overrides={{ roughness: 0.3 }} />
      </mesh>
      {/* Front panel */}
      <mesh position={[0, 0.06, 0.21]}>
        <planeGeometry args={[1.1, 0.06]} />
        <SceneMaterial materialClass="plastic" color={sc.furnitureDark} />
      </mesh>
      {/* Port indicators */}
      {[-0.4, -0.2, 0, 0.2, 0.4].map((x, i) => (
        <mesh key={`port-${x}`} position={[x, 0.06, 0.215]}>
          <circleGeometry args={[0.015, 6]} />
          <meshBasicMaterial color={i % 2 === 0 ? sc.leafPrimary : sc.ledCyan} />
        </mesh>
      ))}
    </group>
  );
}

/** Horizontal cable tray / cable channel on the floor. */
function CableTrayMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
}: InfrastructureMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.34, 3.4]} />
        <meshBasicMaterial color={sc.cableChannel} transparent opacity={0.82} />
      </mesh>
      {[-0.08, 0.08].map((x) => (
        <mesh key={`cable-run-${x}`} position={[x, 0.055, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.045, 3.2]} />
          <meshBasicMaterial color={sc.cableAccent} transparent opacity={0.56} />
        </mesh>
      ))}
    </group>
  );
}

function PatchPanelMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
}: InfrastructureMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.68, 0]} castShadow>
        <boxGeometry args={[1.45, 1.08, 0.32]} />
        <SceneMaterial materialClass="metal" color={sc.serverBody} />
      </mesh>
      <mesh position={[0, 0.68, 0.17]}>
        <planeGeometry args={[1.28, 0.92]} />
        <SceneMaterial materialClass="metal" color={sc.furniture} />
      </mesh>
      {[-0.45, -0.15, 0.15, 0.45].map((x) =>
        [0.44, 0.68, 0.92].map((y) => (
          <mesh key={`patch-port-${x}-${y}`} position={[x, y, 0.18]}>
            <boxGeometry args={[0.11, 0.055, 0.025]} />
            <SceneMaterial materialClass="plastic" color={sc.furnitureDark} />
          </mesh>
        )),
      )}
      <mesh position={[0, 0.05, -0.02]} castShadow>
        <boxGeometry args={[1.2, 0.08, 0.42]} />
        <SceneMaterial materialClass="metal" color={sc.metal} />
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
  template = 'network-switch',
}: InfrastructureMesh3DProps) {
  if (template === 'cable-tray') {
    return <CableTrayMesh3D position={position} rotation={rotation} state={state} />;
  }
  if (template === 'patch-panel') {
    return <PatchPanelMesh3D position={position} rotation={rotation} state={state} />;
  }
  return <NetworkSwitchMesh3D position={position} rotation={rotation} state={state} />;
}
