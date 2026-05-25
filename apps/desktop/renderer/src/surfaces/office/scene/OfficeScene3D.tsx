import { useUiState } from '@/app/ui-state.js';
import { useEmployees, useOfficeLayout, useReassignEmployee, useThreads } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { resolveAppearance } from '@/lib/avatar.js';
import { ContactShadows, Html, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { ACESFilmicToneMapping, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { BlockCharacter } from './BlockCharacter.js';
import { RoomShell } from './r3d/RoomShell.js';
import { SceneLighting } from './r3d/SceneLighting.js';
import { BookshelfMesh3D } from './r3d/prefabs/BookshelfMesh3D.js';
import { DecorativeMesh3D } from './r3d/prefabs/DecorativeMesh3D.js';
import { MeetingTableMesh3D } from './r3d/prefabs/MeetingTableMesh3D.js';
import { Prefab3D } from './r3d/prefabs/Prefab3D.js';
import { RestAreaMesh3D } from './r3d/prefabs/RestAreaMesh3D.js';
import { ServerRackUnit3D } from './r3d/prefabs/ServerRackMesh3D.js';
import { WhiteboardMesh3D } from './r3d/prefabs/WhiteboardMesh3D.js';
import { WorkstationUnit3D } from './r3d/prefabs/WorkstationMesh3D.js';
import { OFFICE_CAMERA_PRESET } from './r3d/scene-art-direction.js';

interface ZoneDef {
  id: string;
  label: string;
  archetype: string;
  cx: number;
  cz: number;
  w: number;
  d: number;
}

const ZONE_TINT: Record<string, string> = {
  workspace: '#cdd9f2',
  meeting: '#e0d6f4',
  rest: '#d6efe4',
  lounge: '#d6efe4',
  library: '#d3ecdd',
  server: '#f2e3cf',
};

/** Synthetic fallback layout (non-Tauri/dev, or empty backend). */
const FALLBACK_ZONES: ZoneDef[] = [
  { id: 'work', label: 'Workspace', archetype: 'workspace', cx: -5, cz: -1, w: 16, d: 25 },
  { id: 'meet', label: 'Meeting', archetype: 'meeting', cx: 8.5, cz: -8.5, w: 11, d: 11 },
  { id: 'lounge', label: 'Lounge', archetype: 'rest', cx: 8.5, cz: 7, w: 11, d: 14 },
];

function zoneTint(archetype: string): string {
  return ZONE_TINT[archetype] ?? '#cdd9f2';
}

function hitTestZone(zones: ZoneDef[], x: number, z: number): ZoneDef | null {
  for (const zone of zones) {
    if (
      x >= zone.cx - zone.w / 2 &&
      x <= zone.cx + zone.w / 2 &&
      z >= zone.cz - zone.d / 2 &&
      z <= zone.cz + zone.d / 2
    ) {
      return zone;
    }
  }
  return null;
}

/** While an employee is dragged, raycast the pointer onto the floor (Y=0),
 *  report the hovered zone, and commit the drop on pointer-up. */
function DragController({
  zones,
  startX,
  startY,
  onHover,
  onDrop,
}: {
  zones: ZoneDef[];
  startX: number;
  startY: number;
  onHover: (zoneId: string | null) => void;
  onDrop: (zoneId: string | null) => void;
}) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new Raycaster();
    const plane = new Plane(new Vector3(0, 1, 0), 0);
    const pointer = new Vector2();
    const hit = new Vector3();
    let moved = false;
    const toGround = (e: PointerEvent): ZoneDef | null => {
      const rect = el.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      return hitTestZone(zones, hit.x, hit.z);
    };
    const onMove = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 5) moved = true;
      onHover(moved ? (toGround(e)?.id ?? null) : null);
    };
    const onUp = (e: PointerEvent) => onDrop(moved ? (toGround(e)?.id ?? null) : null);
    el.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'grabbing';
    return () => {
      el.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
    };
  }, [camera, gl, zones, startX, startY, onHover, onDrop]);
  return null;
}

/** Evenly spread `count` standing positions inside a zone footprint. */
function seatsInZone(zone: ZoneDef, count: number): [number, number][] {
  if (count <= 0) return [];
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const padX = Math.min(2.4, zone.w / (cols + 1));
  const padZ = Math.min(2.4, zone.d / (rows + 1));
  const cellW = (zone.w - padX * 2) / Math.max(1, cols - 1 || 1);
  const cellD = (zone.d - padZ * 2) / Math.max(1, rows - 1 || 1);
  const out: [number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = cols === 1 ? zone.cx : zone.cx - zone.w / 2 + padX + c * cellW;
    const z = rows === 1 ? zone.cz : zone.cz - zone.d / 2 + padZ + r * cellD;
    out.push([x, z]);
  }
  return out;
}

function ZoneRug({ zone, highlight = false }: { zone: ZoneDef; highlight?: boolean }) {
  return (
    <group position={[zone.cx, 0, zone.cz]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 0]} receiveShadow>
        <planeGeometry args={[zone.w, zone.d]} />
        <meshStandardMaterial
          color={highlight ? '#2f6bff' : zoneTint(zone.archetype)}
          roughness={0.95}
          transparent
          opacity={highlight ? 0.32 : 0.5}
        />
      </mesh>
      {highlight ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry
            args={[Math.min(zone.w, zone.d) / 2 - 0.3, Math.min(zone.w, zone.d) / 2, 48]}
          />
          <meshBasicMaterial color="#2f6bff" transparent opacity={0.7} />
        </mesh>
      ) : null}
      <Html
        position={[-zone.w / 2 + 0.5, 0.05, -zone.d / 2 + 0.5]}
        center={false}
        distanceFactor={22}
        occlude={false}
        style={{ pointerEvents: 'none' }}
      >
        <span className="off-scene-zone-label">{zone.label}</span>
      </Html>
    </group>
  );
}

function EmployeeUnit({
  employee,
  x,
  z,
  withDesk,
  running,
  active,
  onSelect,
  onDragStart,
}: {
  employee: Employee;
  x: number;
  z: number;
  withDesk: boolean;
  running: boolean;
  active: boolean;
  onSelect: () => void;
  onDragStart: (clientX: number, clientY: number) => void;
}) {
  const appearance = useMemo(
    () => resolveAppearance(employee.id, employee.appearance),
    [employee.id, employee.appearance],
  );
  const phase = useMemo(
    () => (employee.id.charCodeAt(employee.id.length - 1) % 10) * 0.6,
    [employee.id],
  );

  return (
    <group position={[x, 0, z]}>
      {withDesk ? (
        <WorkstationUnit3D position={[0, 0, -1.8]} rotation={0} variant="compact" />
      ) : null}
      {active ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <ringGeometry args={[0.52, 0.64, 40]} />
          <meshBasicMaterial color="#2f6bff" transparent opacity={0.8} />
        </mesh>
      ) : null}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: r3f raycaster on a 3D object; employees are keyboard-selectable via the team dock and thread list */}
      <group
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onDragStart(e.nativeEvent.clientX, e.nativeEvent.clientY);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'grab';
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
        }}
      >
        <BlockCharacter appearance={appearance} running={running} phase={phase} />
      </group>
      <Html
        position={[0, 2.1, 0]}
        center
        distanceFactor={16}
        occlude={false}
        style={{ pointerEvents: 'none' }}
      >
        <span className={`off-scene-tag${running ? ' is-running' : ''}`}>{employee.name}</span>
      </Html>
    </group>
  );
}

/** Synthetic furniture for the fallback layout (no real prefab instances). */
function FallbackFurniture() {
  return (
    <>
      <MeetingTableMesh3D position={[8.5, 0, -8.5]} rotation={0} capacity={8} />
      <ServerRackUnit3D position={[1, 0, -13]} rotation={0} heightScale={1.24} />
      <ServerRackUnit3D position={[-1, 0, -13]} rotation={0} />
      <BookshelfMesh3D position={[-12.5, 0, -12.5]} rotation={0} template="bookshelf-double" />
      <RestAreaMesh3D position={[7.5, 0, 8]} rotation={0} />
      <DecorativeMesh3D position={[12.5, 0, 11]} rotation={0} template="plant-large" />
      <DecorativeMesh3D position={[3.5, 0, 11]} rotation={0} template="plant-small" />
      <WhiteboardMesh3D position={[8.5, 0, -14]} rotation={0} />
    </>
  );
}

export function OfficeScene3D() {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const openThread = useUiState((s) => s.openThread);
  const closeThread = useUiState((s) => s.closeThread);
  const employees = useEmployees();
  const threads = useThreads(projectId);
  const layout = useOfficeLayout(companyId);
  const reassign = useReassignEmployee();
  const [drag, setDrag] = useState<{ employeeId: string; startX: number; startY: number } | null>(
    null,
  );
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);

  const real = layout.data ?? null;
  const liveThread = threads.data?.find((t) => t.runState === 'running');
  const roster = employees.data ?? [];

  const zoneDefs: ZoneDef[] = real
    ? real.zones.map((z) => ({
        id: z.zone_id,
        label: z.label,
        archetype: z.archetype ?? 'workspace',
        cx: z.cx,
        cz: z.cz,
        w: z.w,
        d: z.d,
      }))
    : FALLBACK_ZONES;

  // Employee standing positions: real mode spreads them across the workspace
  // zone (furniture comes from real prefab instances); fallback grids them in
  // its synthetic workspace zone (each with their own compact workstation).
  const seats = useMemo(() => {
    const workZone =
      zoneDefs.find((z) => z.archetype === 'workspace') ?? zoneDefs[0] ?? FALLBACK_ZONES[0];
    return seatsInZone(workZone as ZoneDef, roster.length);
  }, [zoneDefs, roster.length]);

  return (
    <Canvas
      shadows="soft"
      dpr={[1, 2]}
      camera={{ position: OFFICE_CAMERA_PRESET.position, fov: OFFICE_CAMERA_PRESET.fov }}
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      className="off-scene-canvas"
    >
      <color attach="background" args={['#eef2f8']} />

      <SceneLighting />
      <RoomShell onFloorClick={closeThread} />

      {zoneDefs.map((zone) => (
        <ZoneRug key={zone.id} zone={zone} highlight={drag !== null && hoveredZoneId === zone.id} />
      ))}

      {drag ? (
        <DragController
          zones={zoneDefs}
          startX={drag.startX}
          startY={drag.startY}
          onHover={setHoveredZoneId}
          onDrop={(zoneId) => {
            if (zoneId) reassign.mutate({ employeeId: drag.employeeId, zoneId });
            setDrag(null);
            setHoveredZoneId(null);
          }}
        />
      ) : null}

      {real ? (
        real.prefabs.map(({ instance, definition }) => (
          <Prefab3D
            key={instance.instance_id}
            definition={definition}
            position={[instance.position_x, 0, instance.position_y]}
            rotation={instance.rotation}
          />
        ))
      ) : (
        <FallbackFurniture />
      )}

      {roster.map((employee, i) => {
        const seat = seats[i] ?? [0, 0];
        const thread = threads.data?.find((t) => t.employeeId === employee.id);
        const running =
          thread?.runState === 'running' || (liveThread?.scope === 'team' && employee.online);
        return (
          <EmployeeUnit
            key={employee.id}
            employee={employee}
            x={seat[0]}
            z={seat[1]}
            withDesk={!real}
            running={running}
            active={Boolean(thread && thread.id === selectedThreadId)}
            onSelect={() => thread && openThread(thread.id)}
            onDragStart={(cx, cy) => setDrag({ employeeId: employee.id, startX: cx, startY: cy })}
          />
        );
      })}

      <ContactShadows position={[0, 0.02, 0]} opacity={0.3} scale={48} blur={2.6} far={8} />
      {/* Fixed oblique top-down: rotation locked, gentle zoom only. */}
      <OrbitControls
        makeDefault
        target={OFFICE_CAMERA_PRESET.target}
        enableRotate={false}
        enablePan={false}
        minDistance={OFFICE_CAMERA_PRESET.minDistance}
        maxDistance={OFFICE_CAMERA_PRESET.maxDistance}
      />
    </Canvas>
  );
}
