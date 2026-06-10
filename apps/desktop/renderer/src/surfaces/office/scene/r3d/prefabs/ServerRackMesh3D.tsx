/**
 * ServerRackMesh3D — Server room with rack cabinets and LED indicators.
 *
 * Extracted from Office3DView.tsx ServerRoomFurniture component.
 */

import { RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { EmissiveMaterial, SceneMaterial } from '../scene-materials.js';
import { buildServerRackBakedTexture } from '../server-rack-lod-texture.js';
import { useSceneColors } from '../use-scene-colors.js';

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
      <mesh position={[0, 0.075, 0.02]} castShadow>
        <boxGeometry args={[0.9, 0.15, 0.82]} />
        <SceneMaterial materialClass="rubber" color={sc.furnitureDark} />
      </mesh>
      {[-0.26, -0.13, 0, 0.13, 0.26].map((x) => (
        <mesh key={`unit-door-v-${x}`} position={[x, centerY, 0.412]}>
          <boxGeometry args={[0.012, Math.max(1.78, height - 0.34), 0.014]} />
          <SceneMaterial
            materialClass="metal-brushed"
            color={sc.furnitureDark}
            overrides={{ roughness: 0.68 }}
          />
        </mesh>
      ))}
      {Array.from({ length: heightScale > 1 ? 8 : 6 }, (_, i) => {
        const y = 0.34 + i * ((height - 0.62) / Math.max(1, (heightScale > 1 ? 8 : 6) - 1));
        return (
          <mesh key={`unit-door-h-${y.toFixed(2)}`} position={[0, y, 0.416]}>
            <boxGeometry args={[0.58, 0.012, 0.014]} />
            <SceneMaterial
              materialClass="metal-brushed"
              color={sc.furnitureDark}
              overrides={{ roughness: 0.68 }}
            />
          </mesh>
        );
      })}
      {ledRows.map((y, rowIndex) => (
        <group key={`unit-led-row-${y}`}>
          {[-0.22, 0, 0.22].map((x, ledIndex) => (
            <mesh key={`unit-led-${y}-${x}`} position={[x, Math.min(y, height - 0.18), 0.405]}>
              <circleGeometry args={[0.026, 8]} />
              <EmissiveMaterial color={pickUnitLedColor(rowIndex + ledIndex)} tier="led" />
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
      {[-0.18, 0.02, 0.2].map((x, index) => (
        <mesh
          key={`unit-service-cable-${x}`}
          position={[x, 0.18 + index * 0.04, 0.47]}
          rotation={[0, 0, x * 0.18]}
          castShadow
        >
          <boxGeometry args={[0.28, 0.026, 0.026]} />
          <SceneMaterial
            materialClass="rubber"
            color={index === 1 ? sc.cableAccent : sc.cableChannel}
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
      {[-4, -1.5, 1, 3.5].map((x, rackIndex) => (
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
              overrides={{ roughness: 0.42 }}
            />
          </RoundedBox>
          {/* Front panel */}
          <mesh position={[0, 1.4, 0.51]}>
            <planeGeometry args={[1.4, 2.6]} />
            <SceneMaterial
              materialClass="metal"
              color={sc.furniture}
              overrides={{ roughness: 0.5 }}
            />
          </mesh>
          {lodLevel === 'live' ? (
            <>
              {/* 8 × 1U slots with type variation: blank panel / cable bundle / drive bay */}
              {Array.from({ length: 8 }, (_, n) => n).map((uIndex) => {
                const yBase = 0.32 + uIndex * 0.31;
                const slotHash = (rackIndex * 17 + uIndex * 23) % 7;
                const showLed = slotHash < 2;
                const kind: 'blank' | 'cable' | 'drive' =
                  slotHash < 2 ? 'drive' : slotHash < 5 ? 'blank' : 'cable';
                return (
                  <group key={`u-${x}-${yBase.toFixed(2)}`}>
                    {/* 1U bezel (horizontal seam line) */}
                    <mesh position={[0, yBase + 0.305, 0.518]}>
                      <planeGeometry args={[1.35, 0.012]} />
                      <SceneMaterial
                        materialClass="metal"
                        color={sc.furnitureDark}
                        overrides={{ roughness: 0.62 }}
                      />
                    </mesh>
                    {kind === 'drive' && (
                      <>
                        {[-0.45, -0.15, 0.15, 0.45].map((bayX) => (
                          <mesh
                            key={`bay-${x}-${uIndex}-${bayX}`}
                            position={[bayX, yBase + 0.13, 0.515]}
                          >
                            <boxGeometry args={[0.22, 0.18, 0.022]} />
                            <SceneMaterial materialClass="metal-brushed" color={sc.furnitureDark} />
                          </mesh>
                        ))}
                        {showLed && (
                          <mesh position={[-0.58, yBase + 0.18, 0.527]}>
                            <circleGeometry args={[0.024, 8]} />
                            <EmissiveMaterial
                              color={pickRackLedColor(uIndex + rackIndex)}
                              tier="led"
                            />
                          </mesh>
                        )}
                      </>
                    )}
                    {kind === 'cable' &&
                      [0.06, 0.14, 0.22].map((cy) => (
                        <mesh key={`cable-${x}-${uIndex}-${cy}`} position={[0, yBase + cy, 0.514]}>
                          <boxGeometry args={[1.2, 0.018, 0.014]} />
                          <SceneMaterial materialClass="rubber" color={sc.cableChannel} />
                        </mesh>
                      ))}
                    {kind === 'blank' && (
                      <mesh position={[0, yBase + 0.155, 0.512]}>
                        <planeGeometry args={[1.34, 0.26]} />
                        <SceneMaterial materialClass="metal-brushed" color={sc.furniture} />
                      </mesh>
                    )}
                  </group>
                );
              })}
              {/* Top PDU (power distribution unit) */}
              <mesh position={[0, 2.78, 0.515]} castShadow>
                <boxGeometry args={[1.42, 0.12, 0.04]} />
                <SceneMaterial materialClass="metal-brushed" color={sc.furnitureDark} />
              </mesh>
              {[-0.55, -0.27, 0, 0.27, 0.55].map((sx) => (
                <mesh key={`pdu-socket-${x}-${sx}`} position={[sx, 2.78, 0.54]}>
                  <circleGeometry args={[0.018, 8]} />
                  <SceneMaterial materialClass="plastic" color={sc.furnitureLight} />
                </mesh>
              ))}
              {/* PDU power LED */}
              <mesh position={[-0.66, 2.78, 0.541]}>
                <circleGeometry args={[0.014, 6]} />
                <EmissiveMaterial color={sc.ledGreen} tier="led" />
              </mesh>
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
