import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, RoundedBox, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useAgentStates } from '../../runtime/use-agent-states';
import type { AgentState } from '../../runtime/use-agent-states';

/* ── Office Chair ── */
function OfficeChair({ position, rotation = [0, 0, 0] }: { position: [number, number, number]; rotation?: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.05, 0]} castShadow><cylinderGeometry args={[0.3, 0.3, 0.05, 16]} /><meshStandardMaterial color="#0f172a" /></mesh>
      <mesh position={[0, 0.25, 0]} castShadow><cylinderGeometry args={[0.05, 0.05, 0.4, 8]} /><meshStandardMaterial color="#334155" metalness={0.8} roughness={0.2} /></mesh>
      <RoundedBox args={[0.5, 0.08, 0.5]} position={[0, 0.45, 0]} radius={0.02} smoothness={4} castShadow><meshStandardMaterial color="#1e293b" /></RoundedBox>
      <RoundedBox args={[0.45, 0.5, 0.05]} position={[0, 0.75, 0.22]} radius={0.02} smoothness={4} castShadow><meshStandardMaterial color="#1e293b" /></RoundedBox>
    </group>
  );
}

/* ── Laptop ── */
function Laptop({ position, rotation = [0, 0, 0] }: { position: [number, number, number]; rotation?: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.01, 0]} castShadow><boxGeometry args={[0.4, 0.02, 0.3]} /><meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.2} /></mesh>
      <group position={[0, 0.02, -0.15]} rotation={[-0.2, 0, 0]}>
        <mesh position={[0, 0.15, 0]} castShadow><boxGeometry args={[0.4, 0.3, 0.02]} /><meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.2} /></mesh>
        <mesh position={[0, 0.15, 0.011]}><planeGeometry args={[0.38, 0.28]} /><meshBasicMaterial color="#0ea5e9" /></mesh>
      </group>
    </group>
  );
}

/* ── Plant ── */
function Plant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.25, 0]} castShadow><cylinderGeometry args={[0.2, 0.15, 0.5, 16]} /><meshStandardMaterial color="#f8fafc" roughness={0.8} /></mesh>
      <mesh position={[0, 0.6, 0]} castShadow><icosahedronGeometry args={[0.3, 1]} /><meshStandardMaterial color="#10b981" roughness={0.6} /></mesh>
      <mesh position={[-0.15, 0.5, 0.1]} castShadow><icosahedronGeometry args={[0.2, 1]} /><meshStandardMaterial color="#059669" roughness={0.6} /></mesh>
    </group>
  );
}

/* ── Desk Cluster (4 seats) ── */
function DeskCluster({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <RoundedBox args={[3.2, 0.05, 3.2]} position={[0, 0.75, 0]} radius={0.02} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color="#f1f5f9" roughness={0.2} />
      </RoundedBox>
      {[-1.5, 1.5].map(x => [-1.5, 1.5].map(z => (
        <mesh key={`${x}-${z}`} position={[x, 0.375, z]} castShadow><cylinderGeometry args={[0.04, 0.04, 0.75, 8]} /><meshStandardMaterial color="#cbd5e1" metalness={0.5} /></mesh>
      )))}
      {/* Glass dividers */}
      <mesh position={[0, 1.05, 0]} castShadow><boxGeometry args={[3.0, 0.6, 0.05]} /><meshPhysicalMaterial color="#bae6fd" transmission={0.9} opacity={1} roughness={0.1} ior={1.5} thickness={0.05} transparent /></mesh>
      <mesh position={[0, 1.05, 0]} rotation={[0, Math.PI / 2, 0]} castShadow><boxGeometry args={[3.0, 0.6, 0.05]} /><meshPhysicalMaterial color="#bae6fd" transmission={0.9} opacity={1} roughness={0.1} ior={1.5} thickness={0.05} transparent /></mesh>
      {/* 4 workstations */}
      {([[-0.8, -0.8, 0.2], [0.8, -0.8, -0.2], [-0.8, 0.8, Math.PI - 0.2], [0.8, 0.8, Math.PI + 0.2]] as [number, number, number][]).map(([x, z, rot], i) => (
        <group key={i} position={[x, 0, z]}>
          <Laptop position={[0, 0.775, 0]} rotation={[0, rot, 0]} />
          <OfficeChair position={[0, 0, z < 0 ? -0.8 : 0.8]} rotation={[0, z < 0 ? 0 : Math.PI, 0]} />
        </group>
      ))}
    </group>
  );
}

/* ── Meeting Room ── */
function MeetingRoom({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <RoundedBox args={[5, 0.05, 2]} position={[0, 0.75, 0]} radius={0.1} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color="#1e293b" roughness={0.3} />
      </RoundedBox>
      <mesh position={[0, 0.375, 0]} castShadow><boxGeometry args={[3, 0.75, 0.5]} /><meshStandardMaterial color="#0f172a" /></mesh>
      {[-1.5, 0, 1.5].map((x, i) => (
        <group key={i}>
          <OfficeChair position={[x, 0, -1.5]} />
          <OfficeChair position={[x, 0, 1.5]} rotation={[0, Math.PI, 0]} />
        </group>
      ))}
    </group>
  );
}

/* ── Lounge ── */
function Lounge({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[6, 6]} /><meshStandardMaterial color="#334155" roughness={0.9} /></mesh>
      <RoundedBox args={[3, 0.4, 1]} position={[0, 0.2, -2]} radius={0.1} castShadow><meshStandardMaterial color="#f59e0b" roughness={0.7} /></RoundedBox>
      <RoundedBox args={[3, 0.6, 0.3]} position={[0, 0.5, -2.35]} radius={0.1} castShadow><meshStandardMaterial color="#f59e0b" roughness={0.7} /></RoundedBox>
      <mesh position={[0, 0.3, 0]} castShadow><cylinderGeometry args={[0.8, 0.8, 0.05, 32]} /><meshStandardMaterial color="#f8fafc" roughness={0.2} /></mesh>
      <mesh position={[0, 0.15, 0]} castShadow><cylinderGeometry args={[0.4, 0.2, 0.3, 16]} /><meshStandardMaterial color="#0f172a" /></mesh>
      <Plant position={[2.5, 0, -2.5]} />
    </group>
  );
}

/* ── Department Zone Label ── */
function DepartmentZone({ position, size, color, name }: { position: [number, number, number]; size: [number, number]; color: string; name: string }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={size} />
        <meshStandardMaterial color={color} transparent opacity={0.15} />
        <lineSegments>
          <edgesGeometry args={[new THREE.PlaneGeometry(size[0], size[1])]} />
          <lineBasicMaterial color={color} transparent opacity={0.5} />
        </lineSegments>
      </mesh>
      {/* Sign */}
      <group position={[-size[0] / 2 + 1.5, 0, -size[1] / 2 + 0.5]}>
        <mesh position={[0, 0.05, 0]} castShadow><cylinderGeometry args={[0.3, 0.4, 0.1, 16]} /><meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.2} /></mesh>
        <mesh position={[0, 1.25, 0]} castShadow><cylinderGeometry args={[0.04, 0.06, 2.5, 8]} /><meshStandardMaterial color="#334155" metalness={0.8} roughness={0.2} /></mesh>
        <group position={[0, 2.8, 0]} rotation={[0, Math.PI / 8, 0]}>
          <RoundedBox args={[3.2, 0.8, 0.1]} radius={0.05} castShadow><meshStandardMaterial color="#0f172a" /></RoundedBox>
          <Text position={[0, 0, 0.055]} fontSize={0.24} color={color} fontWeight="bold" letterSpacing={0.1} anchorX="center" anchorY="middle" maxWidth={2.8} textAlign="center">
            {name}
          </Text>
        </group>
      </group>
    </group>
  );
}

/* ── Low-Poly Character ── */
function LowPolyCharacter({ statusColor, outfitColor, skinTone }: { statusColor: string; outfitColor: string; skinTone: string }) {
  return (
    <group>
      {/* Legs */}
      <mesh position={[-0.12, 0.25, 0]} castShadow><boxGeometry args={[0.12, 0.5, 0.12]} /><meshStandardMaterial color="#0f172a" /></mesh>
      <mesh position={[0.12, 0.25, 0]} castShadow><boxGeometry args={[0.12, 0.5, 0.12]} /><meshStandardMaterial color="#0f172a" /></mesh>
      {/* Torso */}
      <mesh position={[0, 0.75, 0]} castShadow><boxGeometry args={[0.36, 0.5, 0.2]} /><meshStandardMaterial color={outfitColor} roughness={0.7} /></mesh>
      {/* Arms */}
      <mesh position={[-0.25, 0.75, 0]} castShadow><boxGeometry args={[0.1, 0.45, 0.1]} /><meshStandardMaterial color={skinTone} roughness={0.4} /></mesh>
      <mesh position={[0.25, 0.75, 0]} castShadow><boxGeometry args={[0.1, 0.45, 0.1]} /><meshStandardMaterial color={skinTone} roughness={0.4} /></mesh>
      {/* Head */}
      <mesh position={[0, 1.25, 0]} castShadow><boxGeometry args={[0.3, 0.3, 0.3]} /><meshStandardMaterial color={skinTone} roughness={0.4} /></mesh>
      {/* Hair */}
      <mesh position={[0, 1.48, 0]} castShadow><boxGeometry args={[0.32, 0.16, 0.32]} /><meshStandardMaterial color="#1a1a1a" roughness={0.9} /></mesh>
      {/* Status ring */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.4, 0.5, 32]} />
        <meshBasicMaterial color={statusColor} transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

/* ── Employee 3D Marker ── */
function EmployeeMarker({ agent, index }: { agent: AgentState; index: number }) {
  const statusColors: Record<string, string> = {
    idle: '#64748b', assigned: '#3b82f6', thinking: '#3b82f6', executing: '#10b981',
    meeting: '#a855f7', blocked: '#ef4444', failed: '#ef4444', waiting: '#f59e0b',
  };
  const outfitColors = ['#3b82f6', '#a855f7', '#22c55e', '#818cf8', '#f97316', '#ef4444', '#06b6d4', '#f59e0b'];
  const skinTones = ['#fce7f3', '#fef3c7', '#92400e', '#fdf2f8', '#fff1f2', '#d4a574', '#f5deb3'];

  const color = statusColors[agent.state] ?? '#64748b';
  const outfit = outfitColors[index % outfitColors.length] ?? '#3b82f6';
  const skin = skinTones[index % skinTones.length] ?? '#fce7f3';

  // Position employees in a grid on the left desk clusters
  const row = Math.floor(index / 4);
  const col = index % 4;
  const baseX = col < 2 ? -8.8 + (col % 2) * 1.6 : -8.8 + (col % 2) * 1.6;
  const baseZ = row === 0 ? -4.6 + (col < 2 ? 0 : 3.2) : 2.4 + (col < 2 ? 0 : 3.2);

  return (
    <group position={[baseX, 0, baseZ]}>
      <LowPolyCharacter statusColor={color} outfitColor={outfit} skinTone={skin} />
    </group>
  );
}

/* ── Main 3D View ── */
export default function Office3DView() {
  const agents = useAgentStates();

  return (
    <div className="w-full h-full bg-slate-950">
      <Canvas shadows camera={{ position: [0, 15, 20], fov: 45 }}>
        <color attach="background" args={['#020617']} />
        <fog attach="fog" args={['#020617', 15, 40]} />

        <ambientLight intensity={0.6} />
        <directionalLight
          castShadow position={[10, 20, 10]} intensity={1.5}
          shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005}
          shadow-camera-left={-20} shadow-camera-right={20}
          shadow-camera-top={20} shadow-camera-bottom={-20}
        />
        <pointLight position={[-10, 10, -10]} intensity={0.5} color="#3b82f6" />
        <Environment preset="city" />

        {/* Room */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[30, 20]} /><meshStandardMaterial color="#0f172a" roughness={0.8} /></mesh>
        <gridHelper args={[30, 30, '#1e293b', '#0f172a']} position={[0, 0.01, 0]} />
        <mesh position={[0, 2.5, -10]} receiveShadow><boxGeometry args={[30, 5, 0.5]} /><meshStandardMaterial color="#1e293b" /></mesh>
        <mesh position={[-15, 2.5, 0]} receiveShadow><boxGeometry args={[0.5, 5, 20]} /><meshStandardMaterial color="#1e293b" /></mesh>
        <mesh position={[15, 2.5, 0]} receiveShadow><boxGeometry args={[0.5, 5, 20]} /><meshStandardMaterial color="#1e293b" /></mesh>

        {/* Zones */}
        <DepartmentZone position={[-8, 0, -3]} size={[8, 6.5]} color="#3b82f6" name="DEVELOPMENT" />
        <DepartmentZone position={[-8, 0, 4]} size={[8, 6.5]} color="#10b981" name="PRODUCTION" />
        <DepartmentZone position={[8, 0, -6]} size={[12, 10]} color="#a8a29e" name="MEETING CORE" />
        <DepartmentZone position={[8, 0, 5]} size={[10, 10]} color="#f59e0b" name="REST AREA" />

        {/* Furniture */}
        <DeskCluster position={[-8, 0, -3]} />
        <DeskCluster position={[-8, 0, 4]} />
        <MeetingRoom position={[8, 0, -6]} />
        <Lounge position={[8, 0, 5]} />
        <Plant position={[-13, 0, -8]} />
        <Plant position={[-13, 0, 8]} />
        <Plant position={[0, 0, 8]} />

        {/* Employees */}
        {[...agents.entries()].map(([id, agent], index) => (
          <EmployeeMarker key={id} agent={agent} index={index} />
        ))}

        <OrbitControls
          makeDefault
          minPolarAngle={0} maxPolarAngle={Math.PI / 2 - 0.1}
          minDistance={5} maxDistance={35}
          target={[0, 0, 0]}
        />
      </Canvas>
    </div>
  );
}
