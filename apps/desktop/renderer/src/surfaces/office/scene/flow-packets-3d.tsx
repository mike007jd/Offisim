import { useFrame } from '@react-three/fiber';
import { type RefObject, useRef } from 'react';
import type { Mesh } from 'three';

function FlowPacketMesh({
  color,
  position,
  meshRef,
}: {
  readonly color: string;
  readonly position: readonly [number, number, number];
  readonly meshRef?: RefObject<Mesh | null>;
}) {
  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[0.075, 12, 8]} />
      <meshBasicMaterial color={color} transparent opacity={0.82} depthWrite={false} />
    </mesh>
  );
}

function AnimatedFlowPacket3D({
  from,
  to,
  color,
  phase,
}: {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  color: string;
  phase: number;
}) {
  const ref = useRef<Mesh>(null);
  useFrame((state) => {
    const packet = ref.current;
    if (!packet) return;
    const t = (state.clock.elapsedTime / 1.6 + phase) % 1;
    packet.position.set(
      from[0] + (to[0] - from[0]) * t,
      from[1] + 0.035,
      from[2] + (to[2] - from[2]) * t,
    );
  });
  return <FlowPacketMesh meshRef={ref} position={from} color={color} />;
}

export function FlowPacket3D({
  from,
  to,
  color,
  pulse,
  phase,
  reducedMotion,
}: {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  color: string;
  pulse: boolean;
  phase: number;
  reducedMotion: boolean;
}) {
  if (pulse && !reducedMotion) {
    return <AnimatedFlowPacket3D from={from} to={to} color={color} phase={phase} />;
  }
  const t = 0.35;
  return (
    <FlowPacketMesh
      color={color}
      position={[from[0] + (to[0] - from[0]) * t, from[1] + 0.035, from[2] + (to[2] - from[2]) * t]}
    />
  );
}
