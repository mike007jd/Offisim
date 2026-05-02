/**
 * ServerRackMesh3D — Server room with rack cabinets and LED indicators.
 *
 * Extracted from Office3DView.tsx ServerRoomFurniture component.
 */

import { RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { SceneMaterial } from '../../../theme/scene-materials.js';
import { useSceneColors } from '../../../theme/use-scene-colors.js';
import { buildServerRackBakedTexture } from '../server-rack-lod-texture.js';

export interface ServerRackMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
}

export interface ServerRackUnit3DProps {
  position?: [number, number, number];
  rotation?: number;
  heightScale?: number;
  state?: string;
}

export function ServerRackUnit3D({
  position = [0, 0, 0],
  rotation = 0,
  heightScale = 1,
  state: _state,
}: ServerRackUnit3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const height = 2.35 * heightScale;
  const centerY = height / 2;
  const ledRows =
    heightScale > 1 ? [0.36, 0.72, 1.08, 1.44, 1.8, 2.16, 2.52] : [0.4, 0.8, 1.2, 1.6, 2.0];
  const pickUnitLedColor = (i: number) => {
    switch (i % 3) {
      case 0:
        return sc.ledCyan;
      case 1:
        return sc.ledGreen;
      default:
        return sc.ledBlue;
    }
  };

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <RoundedBox
        args={[0.82, height, 0.76]}
        position={[0, centerY, 0]}
        radius={0.025}
        smoothness={4}
        castShadow
      >
        <SceneMaterial
          materialClass="metal"
          color={sc.serverBody}
          overrides={{ roughness: 0.32 }}
        />
      </RoundedBox>
      <mesh position={[0, centerY, 0.39]}>
        <planeGeometry args={[0.68, Math.max(1.9, height - 0.22)]} />
        <SceneMaterial materialClass="metal" color={sc.furniture} overrides={{ roughness: 0.42 }} />
      </mesh>
      {ledRows.map((y, rowIndex) => (
        <group key={`unit-led-row-${y}`}>
          {[-0.22, 0, 0.22].map((x, ledIndex) => (
            <mesh key={`unit-led-${y}-${x}`} position={[x, Math.min(y, height - 0.18), 0.405]}>
              <circleGeometry args={[0.026, 8]} />
              <meshBasicMaterial color={pickUnitLedColor(rowIndex + ledIndex)} />
            </mesh>
          ))}
        </group>
      ))}
      {[0.42, 1.18, 1.94].map((y) => (
        <mesh key={`unit-vent-${y}`} position={[0, Math.min(y, height - 0.22), 0.41]}>
          <planeGeometry args={[0.5, 0.045]} />
          <SceneMaterial
            materialClass="metal"
            color={sc.furnitureLight}
            overrides={{ roughness: 0.5 }}
          />
        </mesh>
      ))}
    </group>
  );
}

export function ServerRackMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
}: ServerRackMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const groupRef = useRef<THREE.Group>(null);
  const [lodLevel, setLodLevel] = useState<'live' | 'baked'>('live');
  const bakedTexture = useMemo(() => buildServerRackBakedTexture(sc), [sc]);
  // Reusable scratch vector — getWorldPosition allocates if no out-arg is passed.
  const worldPosRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const pickRackLedColor = (i: number) => {
    switch (i % 3) {
      case 0:
        return sc.ledCyan;
      case 1:
        return sc.leafPrimary;
      default:
        return sc.ledBlue;
    }
  };

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    const distance = state.camera.position.distanceTo(group.getWorldPosition(worldPosRef.current));
    setLodLevel((current) => {
      if (current === 'live' && distance > 20) return 'baked';
      if (current === 'baked' && distance < 16) return 'live';
      return current;
    });
  });

  return (
    <group ref={groupRef} position={position} rotation={[0, rotY, 0]}>
      {/* Server racks */}
      {[-4, -1.5, 1, 3.5].map((x) => (
        <group key={`rack-${x}`} position={[x, 0, -0.5]}>
          {/* Rack cabinet */}
          <RoundedBox
            args={[1.6, 2.8, 1]}
            position={[0, 1.4, 0]}
            radius={0.03}
            smoothness={4}
            castShadow
          >
            <SceneMaterial
              materialClass="metal"
              color={sc.serverBody}
              overrides={{ roughness: 0.3 }}
            />
          </RoundedBox>
          {/* Front panel */}
          <mesh position={[0, 1.4, 0.51]}>
            <planeGeometry args={[1.4, 2.6]} />
            <SceneMaterial
              materialClass="metal"
              color={sc.furniture}
              overrides={{ roughness: 0.4 }}
            />
          </mesh>
          {lodLevel === 'live' ? (
            <>
              {[0.4, 0.7, 1.0, 1.3, 1.6, 1.9, 2.2, 2.5].map((y, rowIndex) => (
                <group key={`led-row-${x}-${y}`}>
                  {[-0.4, -0.2, 0, 0.2, 0.4].map((lx, ledIndex) => (
                    <mesh key={`led-${x}-${y}-${lx}`} position={[lx, y, 0.52]}>
                      <circleGeometry args={[0.03, 8]} />
                      <meshBasicMaterial color={pickRackLedColor(rowIndex + ledIndex)} />
                    </mesh>
                  ))}
                </group>
              ))}
              {[0.3, 1.2, 2.1].map((y) => (
                <group key={`vent-${x}-${y}`}>
                  {[-0.5, -0.3, -0.1, 0.1, 0.3, 0.5].map((vx) => (
                    <mesh key={`vline-${x}-${y}-${vx}`} position={[vx, y, 0.515]}>
                      <planeGeometry args={[0.08, 0.04]} />
                      <SceneMaterial
                        materialClass="metal"
                        color={sc.furnitureLight}
                        overrides={{ roughness: 0.5 }}
                      />
                    </mesh>
                  ))}
                </group>
              ))}
            </>
          ) : (
            <mesh position={[0, 1.4, 0.525]}>
              <planeGeometry args={[1.35, 2.5]} />
              <meshBasicMaterial map={bakedTexture} transparent />
            </mesh>
          )}
        </group>
      ))}
      {/* Floor cable channels */}
      {[-3, 0, 3].map((x) => (
        <mesh key={`cable-${x}`} position={[x, 0.02, 1.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.3, 2]} />
          <SceneMaterial materialClass="plastic" color={sc.cableChannel} />
        </mesh>
      ))}
    </group>
  );
}
