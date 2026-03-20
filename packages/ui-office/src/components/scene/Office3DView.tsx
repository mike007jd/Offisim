import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, RoundedBox, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useContext, useMemo, useRef, useState } from 'react';
import { useAgentStates } from '../../runtime/use-agent-states';
import type { AgentState } from '../../runtime/use-agent-states';
import { AicsRuntimeContext } from '../../runtime/aics-runtime-context';
import { STATE_LABELS } from '../../lib/state-labels';

// ── Zone definitions (matching 2D renderer departments.ts) ──────────
// TODO: migrate to shared ../../lib/zone-config.ts (P1 follow-up)

interface ZoneDef {
  id: string;
  label: string;
  accent: string;
  /** Center position [x, y, z] */
  position: [number, number, number];
  /** Floor size [width, depth] */
  size: [number, number];
  /** Role slugs that map employees to this zone */
  roleSlugs: string[];
  /** Max desk workstation slots */
  deskSlots: number;
}

const ZONES: ZoneDef[] = [
  // Row 1 (back/top, z=-8): Infrastructure — rarely interacted with
  {
    id: 'mtg',
    label: 'MEETING ROOM',
    accent: '#94a3b8',
    position: [-10, 0, -8],
    size: [14, 6],
    roleSlugs: [],
    deskSlots: 0,
  },
  {
    id: 'srv',
    label: 'SERVER ROOM',
    accent: '#06b6d4',
    position: [8, 0, -8],
    size: [14, 6],
    roleSlugs: [],
    deskSlots: 0,
  },
  // Row 2 (middle, z=2): Support areas
  {
    id: 'lib',
    label: 'LIBRARY',
    accent: '#10b981',
    position: [-10, 0, 2],
    size: [14, 8],
    roleSlugs: [],
    deskSlots: 0,
  },
  {
    id: 'rest',
    label: 'REST AREA',
    accent: '#f59e0b',
    position: [8, 0, 2],
    size: [14, 8],
    roleSlugs: [],
    deskSlots: 0,
  },
  // Row 3 (front/bottom, z=11): Main work areas — high interaction
  {
    id: 'dev',
    label: 'DEVELOPMENT',
    accent: '#3b82f6',
    position: [-13, 0, 11],
    size: [12, 8],
    roleSlugs: ['developer', 'engineer', 'backend', 'frontend', 'fullstack'],
    deskSlots: 4,
  },
  {
    id: 'prod',
    label: 'PRODUCT',
    accent: '#a855f7',
    position: [0, 0, 11],
    size: [10, 8],
    roleSlugs: ['pm', 'product_manager', 'researcher', 'analyst'],
    deskSlots: 4,
  },
  {
    id: 'art',
    label: 'ART & DESIGN',
    accent: '#f97316',
    position: [12, 0, 11],
    size: [10, 8],
    roleSlugs: ['designer', 'artist', 'ui_designer', 'ux_designer'],
    deskSlots: 4,
  },
];

/** Resolve employee role slug to zone ID. Defaults to 'dev'. */
function resolveZone(role: string): string {
  for (const z of ZONES) {
    if (z.roleSlugs.includes(role)) return z.id;
  }
  return 'dev';
}

// ── Status colors (matching 2D renderer STATE_COLORS) ───────────────

const STATE_COLORS: Record<string, string> = {
  idle: '#64748b',
  assigned: '#3b82f6',
  thinking: '#818cf8',
  searching: '#c084fc',
  executing: '#10b981',
  meeting: '#a855f7',
  blocked: '#ef4444',
  waiting: '#f59e0b',
  reporting: '#06b6d4',
  success: '#22c55e',
  failed: '#ef4444',
  paused: '#475569',
};

const OUTFIT_COLORS = [
  '#3b82f6', '#a855f7', '#22c55e', '#818cf8',
  '#f97316', '#ef4444', '#06b6d4', '#f59e0b',
];

const SKIN_TONES = [
  '#fce7f3', '#fef3c7', '#92400e', '#fdf2f8',
  '#fff1f2', '#d4a574', '#f5deb3',
];

// ── Furniture components ────────────────────────────────────────────

function OfficeChair({ position, rotation = [0, 0, 0] }: {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.05, 16]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.4, 8]} />
        <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.2} />
      </mesh>
      <RoundedBox args={[0.5, 0.08, 0.5]} position={[0, 0.45, 0]} radius={0.02} smoothness={4} castShadow>
        <meshStandardMaterial color="#1e293b" />
      </RoundedBox>
      <RoundedBox args={[0.45, 0.5, 0.05]} position={[0, 0.75, 0.22]} radius={0.02} smoothness={4} castShadow>
        <meshStandardMaterial color="#1e293b" />
      </RoundedBox>
    </group>
  );
}

function Laptop({ position, rotation = [0, 0, 0] }: {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.01, 0]} castShadow>
        <boxGeometry args={[0.4, 0.02, 0.3]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.2} />
      </mesh>
      <group position={[0, 0.02, -0.15]} rotation={[-0.2, 0, 0]}>
        <mesh position={[0, 0.15, 0]} castShadow>
          <boxGeometry args={[0.4, 0.3, 0.02]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0.15, 0.011]}>
          <planeGeometry args={[0.38, 0.28]} />
          <meshBasicMaterial color="#0ea5e9" />
        </mesh>
      </group>
    </group>
  );
}

function Plant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.15, 0.5, 16]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.6, 0]} castShadow>
        <icosahedronGeometry args={[0.3, 1]} />
        <meshStandardMaterial color="#10b981" roughness={0.6} />
      </mesh>
      <mesh position={[-0.15, 0.5, 0.1]} castShadow>
        <icosahedronGeometry args={[0.2, 1]} />
        <meshStandardMaterial color="#059669" roughness={0.6} />
      </mesh>
    </group>
  );
}

// ── Zone furniture sets ─────────────────────────────────────────────

/** 4-seat desk cluster with laptops and glass dividers */
function DeskCluster({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <RoundedBox args={[3.2, 0.05, 3.2]} position={[0, 0.75, 0]} radius={0.02} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color="#f1f5f9" roughness={0.2} />
      </RoundedBox>
      {[-1.5, 1.5].map(x => [-1.5, 1.5].map(z => (
        <mesh key={`leg-${x}-${z}`} position={[x, 0.375, z]} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 0.75, 8]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.5} />
        </mesh>
      )))}
      {/* Glass dividers */}
      <mesh position={[0, 1.05, 0]} castShadow>
        <boxGeometry args={[3.0, 0.6, 0.05]} />
        <meshPhysicalMaterial color="#bae6fd" transmission={0.9} opacity={1} roughness={0.1} ior={1.5} thickness={0.05} transparent />
      </mesh>
      <mesh position={[0, 1.05, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[3.0, 0.6, 0.05]} />
        <meshPhysicalMaterial color="#bae6fd" transmission={0.9} opacity={1} roughness={0.1} ior={1.5} thickness={0.05} transparent />
      </mesh>
      {/* 4 workstations */}
      {([[-0.8, -0.8, 0.2], [0.8, -0.8, -0.2], [-0.8, 0.8, Math.PI - 0.2], [0.8, 0.8, Math.PI + 0.2]] as [number, number, number][]).map(([x, z, rot], i) => (
        <group key={`ws-${i}`} position={[x, 0, z]}>
          <Laptop position={[0, 0.775, 0]} rotation={[0, rot, 0]} />
          <OfficeChair position={[0, 0, z < 0 ? -0.8 : 0.8]} rotation={[0, z < 0 ? Math.PI : 0, 0]} />
        </group>
      ))}
    </group>
  );
}

/** Library zone: bookshelves + reading tables */
function LibraryFurniture({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Bookshelves along the back */}
      {[-4, -1.5, 1, 3.5].map((x, i) => (
        <group key={`shelf-${i}`} position={[x, 0, -2.5]}>
          {/* Shelf frame */}
          <RoundedBox args={[2, 2.5, 0.6]} position={[0, 1.25, 0]} radius={0.03} smoothness={4} castShadow>
            <meshStandardMaterial color="#1e293b" />
          </RoundedBox>
          {/* Shelf levels with books */}
          {[0.5, 1.1, 1.7, 2.3].map((y, j) => (
            <group key={`books-${j}`}>
              <mesh position={[0, y, 0]} castShadow>
                <boxGeometry args={[1.8, 0.04, 0.5]} />
                <meshStandardMaterial color="#334155" />
              </mesh>
              {/* Book spines */}
              {[-0.6, -0.3, 0, 0.3, 0.6].map((bx, k) => (
                <mesh key={`book-${k}`} position={[bx, y + 0.15, 0]} castShadow>
                  <boxGeometry args={[0.18, 0.25, 0.35]} />
                  <meshStandardMaterial
                    color={['#10b981', '#059669', '#047857', '#34d399', '#6ee7b7'][(j + k) % 5]}
                    roughness={0.8}
                  />
                </mesh>
              ))}
            </group>
          ))}
        </group>
      ))}
      {/* Reading tables */}
      {[-3, 1.5].map((x, i) => (
        <group key={`table-${i}`} position={[x, 0, 1.5]}>
          <RoundedBox args={[2.5, 0.05, 1.2]} position={[0, 0.72, 0]} radius={0.02} smoothness={4} castShadow receiveShadow>
            <meshStandardMaterial color="#064e3b" roughness={0.3} />
          </RoundedBox>
          {([[-1, -0.5], [1, -0.5], [-1, 0.5], [1, 0.5]] as [number, number][]).map(([lx, lz], j) => (
            <mesh key={`tleg-${j}`} position={[lx, 0.36, lz]} castShadow>
              <cylinderGeometry args={[0.04, 0.04, 0.72, 8]} />
              <meshStandardMaterial color="#334155" metalness={0.5} />
            </mesh>
          ))}
          <OfficeChair position={[-0.6, 0, -1]} />
          <OfficeChair position={[0.6, 0, -1]} />
          <OfficeChair position={[-0.6, 0, 1]} rotation={[0, Math.PI, 0]} />
          <OfficeChair position={[0.6, 0, 1]} rotation={[0, Math.PI, 0]} />
        </group>
      ))}
      <Plant position={[5.5, 0, -2.5]} />
    </group>
  );
}

/** Rest area: sofas, coffee table, vending machine */
function RestAreaFurniture({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Carpet */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[10, 6]} />
        <meshStandardMaterial color="#334155" roughness={0.9} />
      </mesh>
      {/* Sofa set 1 - L shape */}
      <RoundedBox args={[4, 0.4, 1.2]} position={[-1, 0.2, -2.2]} radius={0.1} castShadow>
        <meshStandardMaterial color="#f59e0b" roughness={0.7} />
      </RoundedBox>
      <RoundedBox args={[4, 0.6, 0.3]} position={[-1, 0.5, -2.75]} radius={0.1} castShadow>
        <meshStandardMaterial color="#f59e0b" roughness={0.7} />
      </RoundedBox>
      {/* Sofa set 2 */}
      <RoundedBox args={[3, 0.4, 1]} position={[1, 0.2, 2]} radius={0.1} castShadow>
        <meshStandardMaterial color="#d97706" roughness={0.7} />
      </RoundedBox>
      <RoundedBox args={[3, 0.6, 0.3]} position={[1, 0.5, 2.45]} radius={0.1} castShadow>
        <meshStandardMaterial color="#d97706" roughness={0.7} />
      </RoundedBox>
      {/* Coffee table */}
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.8, 0.8, 0.05, 32]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[0.4, 0.2, 0.3, 16]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      {/* Vending machine */}
      <group position={[5.5, 0, -2]}>
        <RoundedBox args={[1, 2.2, 0.8]} position={[0, 1.1, 0]} radius={0.05} castShadow>
          <meshStandardMaterial color="#1e293b" metalness={0.4} roughness={0.3} />
        </RoundedBox>
        {/* Screen */}
        <mesh position={[0, 1.4, 0.41]}>
          <planeGeometry args={[0.7, 0.5]} />
          <meshBasicMaterial color="#f59e0b" />
        </mesh>
        {/* Product window */}
        <mesh position={[0, 0.8, 0.41]}>
          <planeGeometry args={[0.7, 0.8]} />
          <meshPhysicalMaterial color="#bae6fd" transmission={0.8} opacity={1} roughness={0.1} ior={1.5} thickness={0.05} transparent />
        </mesh>
      </group>
      <Plant position={[-5, 0, -2.5]} />
      <Plant position={[4, 0, 2.5]} />
    </group>
  );
}

/** Meeting room: conference table + chairs */
function MeetingRoomFurniture({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Conference table */}
      <RoundedBox args={[6, 0.08, 2.2]} position={[0, 0.75, 0]} radius={0.1} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color="#1e293b" roughness={0.3} />
      </RoundedBox>
      {/* Table base */}
      <mesh position={[0, 0.375, 0]} castShadow>
        <boxGeometry args={[4, 0.75, 0.6]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      {/* Chairs around table */}
      {[-2, -0.7, 0.7, 2].map((x, i) => (
        <group key={`mchair-${i}`}>
          <OfficeChair position={[x, 0, -1.8]} />
          <OfficeChair position={[x, 0, 1.8]} rotation={[0, Math.PI, 0]} />
        </group>
      ))}
      {/* Whiteboard on wall */}
      <group position={[-5.5, 0, 0]}>
        <mesh position={[0, 1.8, 0]} castShadow>
          <boxGeometry args={[0.1, 1.5, 2.5]} />
          <meshStandardMaterial color="#f1f5f9" roughness={0.3} />
        </mesh>
        {/* Whiteboard frame */}
        <lineSegments position={[0.06, 1.8, 0]}>
          <edgesGeometry args={[new THREE.PlaneGeometry(2.5, 1.5)]} />
          <lineBasicMaterial color="#94a3b8" />
        </lineSegments>
      </group>
    </group>
  );
}

/** Server room: server racks with LED indicator lights */
function ServerRoomFurniture({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Server racks */}
      {[-4, -1.5, 1, 3.5].map((x, ri) => (
        <group key={`rack-${ri}`} position={[x, 0, -0.5]}>
          {/* Rack cabinet */}
          <RoundedBox args={[1.6, 2.8, 1]} position={[0, 1.4, 0]} radius={0.03} smoothness={4} castShadow>
            <meshStandardMaterial color="#0f172a" metalness={0.6} roughness={0.3} />
          </RoundedBox>
          {/* Front panel */}
          <mesh position={[0, 1.4, 0.51]}>
            <planeGeometry args={[1.4, 2.6]} />
            <meshStandardMaterial color="#1e293b" metalness={0.4} roughness={0.4} />
          </mesh>
          {/* LED indicator rows */}
          {[0.4, 0.7, 1.0, 1.3, 1.6, 1.9, 2.2, 2.5].map((y, li) => (
            <group key={`led-row-${li}`}>
              {[-0.4, -0.2, 0, 0.2, 0.4].map((lx, lj) => (
                <mesh key={`led-${lj}`} position={[lx, y, 0.52]}>
                  <circleGeometry args={[0.03, 8]} />
                  <meshBasicMaterial
                    color={(li + lj + ri) % 3 === 0 ? '#06b6d4' : (li + lj + ri) % 3 === 1 ? '#10b981' : '#3b82f6'}
                  />
                </mesh>
              ))}
            </group>
          ))}
          {/* Ventilation grilles */}
          {[0.3, 1.2, 2.1].map((y, vi) => (
            <group key={`vent-${vi}`}>
              {[-0.5, -0.3, -0.1, 0.1, 0.3, 0.5].map((vx, vj) => (
                <mesh key={`vline-${vj}`} position={[vx, y, 0.515]}>
                  <planeGeometry args={[0.08, 0.04]} />
                  <meshStandardMaterial color="#334155" />
                </mesh>
              ))}
            </group>
          ))}
        </group>
      ))}
      {/* Floor cable channels */}
      {[-3, 0, 3].map((x, i) => (
        <mesh key={`cable-${i}`} position={[x, 0.02, 1.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.3, 2]} />
          <meshStandardMaterial color="#0c4a6e" />
        </mesh>
      ))}
      {/* Server room glow */}
      <pointLight position={[0, 2, 0.5]} intensity={0.8} color="#06b6d4" distance={8} decay={2} />
    </group>
  );
}

// ── Zone floor label ────────────────────────────────────────────────

function ZoneLabel({ position, size, color, name }: {
  position: [number, number, number];
  size: [number, number];
  color: string;
  name: string;
}) {
  return (
    <group position={position}>
      {/* Zone floor overlay */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={size} />
        <meshStandardMaterial color={color} transparent opacity={0.12} />
        <lineSegments>
          <edgesGeometry args={[new THREE.PlaneGeometry(size[0], size[1])]} />
          <lineBasicMaterial color={color} transparent opacity={0.4} />
        </lineSegments>
      </mesh>
      {/* HUD label floating above zone */}
      <Html
        position={[0, 0.5, -size[1] / 2 + 0.5]}
        center
        style={{ pointerEvents: 'none' }}
      >
        <div style={{
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(8px)',
          border: `1px solid ${color}40`,
          borderRadius: '8px',
          padding: '4px 12px',
          whiteSpace: 'nowrap',
        }}>
          <span style={{
            color: color,
            fontSize: '11px',
            fontWeight: 900,
            letterSpacing: '3px',
            textTransform: 'uppercase',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}>
            {name}
          </span>
        </div>
      </Html>
    </group>
  );
}

// ── Low-poly character ──────────────────────────────────────────────

function LowPolyCharacter({ statusColor, outfitColor, skinTone, state }: {
  statusColor: string;
  outfitColor: string;
  skinTone: string;
  state: string;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((frameState) => {
    if (!groupRef.current) return;
    const t = frameState.clock.elapsedTime;

    // Reset to baseline every frame to prevent drift between state switches
    groupRef.current.position.x = 0;
    groupRef.current.position.y = 0;
    groupRef.current.rotation.y = 0;

    switch (state) {
      case 'idle':
        // Gentle breathing
        groupRef.current.position.y = Math.sin(t * 2) * 0.03;
        break;
      case 'executing':
      case 'working':
        // Typing motion - slight body bob
        groupRef.current.position.y = Math.sin(t * 8) * 0.02;
        groupRef.current.rotation.y = Math.sin(t * 3) * 0.05;
        break;
      case 'thinking':
        // Slow sway
        groupRef.current.position.y = Math.sin(t * 1.5) * 0.05;
        groupRef.current.rotation.y = Math.sin(t * 0.8) * 0.1;
        break;
      case 'blocked':
      case 'failed':
        // Frustrated shake
        groupRef.current.position.x = Math.sin(t * 15) * 0.03;
        break;
      case 'meeting':
      case 'talking':
        // Animated gesturing
        groupRef.current.rotation.y = Math.sin(t * 2) * 0.15;
        break;
      case 'success':
        // Happy bounce
        groupRef.current.position.y = Math.abs(Math.sin(t * 4)) * 0.1;
        break;
      default:
        groupRef.current.position.y = Math.sin(t * 2) * 0.02;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Legs */}
      <mesh position={[-0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      <mesh position={[0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      {/* Torso */}
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[0.36, 0.5, 0.2]} />
        <meshStandardMaterial color={outfitColor} roughness={0.7} />
      </mesh>
      {/* Arms */}
      <mesh position={[-0.25, 0.75, 0]} castShadow>
        <boxGeometry args={[0.1, 0.45, 0.1]} />
        <meshStandardMaterial color={skinTone} roughness={0.4} />
      </mesh>
      <mesh position={[0.25, 0.75, 0]} castShadow>
        <boxGeometry args={[0.1, 0.45, 0.1]} />
        <meshStandardMaterial color={skinTone} roughness={0.4} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <meshStandardMaterial color={skinTone} roughness={0.4} />
      </mesh>
      {/* Hair */}
      <mesh position={[0, 1.48, 0]} castShadow>
        <boxGeometry args={[0.32, 0.16, 0.32]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
      </mesh>
      {/* Status ring at feet */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.4, 0.5, 32]} />
        <meshBasicMaterial color={statusColor} transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

// ── Status bubble labels ────────────────────────────────────────────

function StatusBubble3D({ state }: { state: string }) {
  const label = STATE_LABELS[state];
  if (!label) return null;
  return (
    <Html position={[0, 2.2, 0]} center distanceFactor={12} style={{ pointerEvents: 'none' }}>
      <div style={{
        borderRadius: '9999px',
        background: 'rgba(0,0,0,0.70)',
        backdropFilter: 'blur(4px)',
        border: '1px solid rgba(255,255,255,0.10)',
        padding: '2px 8px',
        fontSize: '9px',
        fontFamily: 'monospace',
        color: 'rgba(255,255,255,0.80)',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </div>
    </Html>
  );
}

// ── Employee placement ──────────────────────────────────────────────

/**
 * Workstation positions relative to zone center,
 * used for placing employees within department desk clusters.
 */
/** Chair/seat positions — OUTSIDE the desk, where employees sit */
const SEAT_POSITIONS: [number, number, number][] = [
  [-0.8, 0, -1.8],
  [0.8, 0, -1.8],
  [-0.8, 0, 1.8],
  [0.8, 0, 1.8],
];

interface PlacedEmployee {
  id: string;
  agent: AgentState;
  globalIndex: number;
  position: [number, number, number];
}

function usePlacedEmployees(agents: Map<string, AgentState>): PlacedEmployee[] {
  return useMemo(() => {
    // Group employees by zone
    const zoneEmployees = new Map<string, { id: string; agent: AgentState; globalIndex: number }[]>();
    for (const z of ZONES) {
      zoneEmployees.set(z.id, []);
    }

    let globalIdx = 0;
    for (const [id, agent] of agents) {
      const zoneId = resolveZone(agent.role);
      const arr = zoneEmployees.get(zoneId);
      if (arr) {
        arr.push({ id, agent, globalIndex: globalIdx });
      }
      globalIdx++;
    }

    const placed: PlacedEmployee[] = [];
    for (const zone of ZONES) {
      const emps = zoneEmployees.get(zone.id) ?? [];
      emps.forEach((emp, slotIdx) => {
        // Place at desk positions, wrapping around if > 4
        const deskPos = SEAT_POSITIONS[slotIdx % SEAT_POSITIONS.length]!;
        placed.push({
          id: emp.id,
          agent: emp.agent,
          globalIndex: emp.globalIndex,
          position: [
            zone.position[0] + deskPos[0],
            0,
            zone.position[2] + deskPos[2] + Math.floor(slotIdx / 4) * 2,
          ],
        });
      });
    }
    return placed;
  }, [agents]);
}

function EmployeeMarker({
  emp,
  isSelected,
  onSelect,
}: {
  emp: PlacedEmployee;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const color = STATE_COLORS[emp.agent.state] ?? '#64748b';
  const outfit = OUTFIT_COLORS[emp.globalIndex % OUTFIT_COLORS.length] ?? '#3b82f6';
  const skin = SKIN_TONES[emp.globalIndex % SKIN_TONES.length] ?? '#fce7f3';

  return (
    <group
      position={emp.position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(emp.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'default';
      }}
    >
      {/* Selection ring — rendered below the character when selected */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.6, 0.75, 32]} />
          <meshBasicMaterial color="#3b82f6" transparent opacity={0.8} />
        </mesh>
      )}
      <LowPolyCharacter statusColor={color} outfitColor={outfit} skinTone={skin} state={emp.agent.state} />
      {emp.agent.state !== 'idle' && <StatusBubble3D state={emp.agent.state} />}
    </group>
  );
}

// ── Room shell ──────────────────────────────────────────────────────

const ROOM_W = 40;
const ROOM_D = 30;
const WALL_H = 5;

function RoomShell({ onFloorClick }: { onFloorClick?: () => void }) {
  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow onClick={onFloorClick}>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial color="#020617" roughness={0.9} />
      </mesh>
      {/* Grid overlay */}
      <gridHelper args={[ROOM_W, 40, '#1e293b', '#0f172a']} position={[0, 0.01, 0]} />
      {/* Back wall */}
      <mesh position={[0, WALL_H / 2, -ROOM_D / 2]} receiveShadow>
        <boxGeometry args={[ROOM_W, WALL_H, 0.3]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      {/* Left wall */}
      <mesh position={[-ROOM_W / 2, WALL_H / 2, 0]} receiveShadow>
        <boxGeometry args={[0.3, WALL_H, ROOM_D]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      {/* Right wall */}
      <mesh position={[ROOM_W / 2, WALL_H / 2, 0]} receiveShadow>
        <boxGeometry args={[0.3, WALL_H, ROOM_D]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
    </group>
  );
}

// ── Main 3D View ────────────────────────────────────────────────────

export default function Office3DView() {
  const agents = useAgentStates();
  const placed = usePlacedEmployees(agents);
  const runtime = useContext(AicsRuntimeContext);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  const handleSelectEmployee = (id: string) => {
    setSelectedEmployeeId(id);
    runtime?.eventBus.emit({
      type: 'scene.employee.selected',
      entityId: id,
      entityType: 'employee',
      companyId: '',
      timestamp: Date.now(),
      payload: { employeeId: id, source: 'scene' },
    });
  };

  const handleDeselect = () => {
    setSelectedEmployeeId(null);
    runtime?.eventBus.emit({
      type: 'ui.selection.changed',
      entityId: '',
      entityType: 'employee',
      companyId: '',
      timestamp: Date.now(),
      payload: { employeeId: null, source: 'scene' },
    });
  };

  return (
    <div className="w-full h-full bg-slate-950">
      <Canvas shadows camera={{ position: [0, 22, 28], fov: 45 }}>
        <color attach="background" args={['#020617']} />
        <fog attach="fog" args={['#020617', 40, 100]} />

        {/* Lighting */}
        <ambientLight intensity={0.8} />
        <directionalLight
          castShadow
          position={[12, 25, 12]}
          intensity={1.5}
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0005}
          shadow-camera-left={-25}
          shadow-camera-right={25}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
        />
        <pointLight position={[-15, 12, -10]} intensity={0.4} color="#3b82f6" />
        <pointLight position={[15, 8, 10]} intensity={0.3} color="#06b6d4" />
        <Environment preset="city" />

        {/* Room shell — floor click deselects */}
        <RoomShell onFloorClick={handleDeselect} />

        {/* ── Zone overlays ── */}
        {ZONES.map((z) => (
          <ZoneLabel
            key={z.id}
            position={z.position}
            size={z.size}
            color={z.accent}
            name={z.label}
          />
        ))}

        {/* ── MTG zone furniture (back row) ── */}
        <MeetingRoomFurniture position={[-10, 0, -8]} />

        {/* ── SRV zone furniture (back row) ── */}
        <ServerRoomFurniture position={[8, 0, -8]} />

        {/* ── LIB zone furniture (middle row) ── */}
        <LibraryFurniture position={[-10, 0, 2]} />

        {/* ── REST zone furniture (middle row) ── */}
        <RestAreaFurniture position={[8, 0, 2]} />

        {/* ── DEV zone furniture (front row) ── */}
        <DeskCluster position={[-13, 0, 11]} />

        {/* ── PROD zone furniture (front row) ── */}
        <DeskCluster position={[0, 0, 11]} />

        {/* ── ART zone furniture (front row) ── */}
        <DeskCluster position={[12, 0, 11]} />

        {/* ── Decoration plants along walls ── */}
        <Plant position={[-18, 0, -13]} />
        <Plant position={[-18, 0, 13]} />
        <Plant position={[18, 0, -13]} />
        <Plant position={[18, 0, 13]} />
        <Plant position={[0, 0, 13]} />

        {/* ── Employees ── */}
        {placed.map((emp) => (
          <EmployeeMarker
            key={emp.id}
            emp={emp}
            isSelected={selectedEmployeeId === emp.id}
            onSelect={handleSelectEmployee}
          />
        ))}

        <OrbitControls
          makeDefault
          minPolarAngle={0}
          maxPolarAngle={Math.PI / 2 - 0.1}
          minDistance={5}
          maxDistance={45}
          target={[0, 0, 2]}
        />
      </Canvas>
    </div>
  );
}
