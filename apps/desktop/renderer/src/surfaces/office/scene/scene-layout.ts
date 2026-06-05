import type { Employee, ZoneKind } from '@/data/types.js';

/** A resolved zone in scene coordinates, shared by the 2D and 3D office scenes
 *  so both render the same floor plan, zones, and seating from one source. */
export interface ZoneDef {
  id: string;
  label: string;
  archetype: string;
  cx: number;
  cz: number;
  w: number;
  d: number;
}

/** Synthetic fallback layout (non-Tauri/dev, or an empty backend). Both scenes
 *  fall back to this so dev/preview stays consistent across render modes. */
export const FALLBACK_ZONES: ZoneDef[] = [
  { id: 'work', label: 'Workspace', archetype: 'workspace', cx: -5, cz: -1, w: 16, d: 25 },
  { id: 'meet', label: 'Meeting', archetype: 'meeting', cx: 8.5, cz: -8.5, w: 11, d: 11 },
  { id: 'lounge', label: 'Lounge', archetype: 'rest', cx: 8.5, cz: 7, w: 11, d: 14 },
];

interface RealZone {
  zone_id: string;
  label: string;
  archetype?: string | null;
  cx: number;
  cz: number;
  w: number;
  d: number;
}

/** Build ZoneDefs from a real office layout, or fall back to the synthetic
 *  layout when there is no real data (non-Tauri/dev or an empty backend). */
export function zoneDefsFromLayout(real: { zones: RealZone[] } | null | undefined): ZoneDef[] {
  if (!real || real.zones.length === 0) return FALLBACK_ZONES;
  return real.zones.map((z) => ({
    id: z.zone_id,
    label: z.label,
    archetype: z.archetype ?? 'workspace',
    cx: z.cx,
    cz: z.cz,
    w: z.w,
    d: z.d,
  }));
}

/** The zone an unassigned employee defaults into (the workspace, else first).
 *  FALLBACK_ZONES is always non-empty, so a ZoneDef is always returned. */
export function defaultEmployeeZone(zoneDefs: ZoneDef[]): ZoneDef {
  return (zoneDefs.find((z) => z.archetype === 'workspace') ??
    zoneDefs[0] ??
    FALLBACK_ZONES[0]) as ZoneDef;
}

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

function employeeZone(employee: Employee, zones: ZoneDef[], fallbackZone: ZoneDef): ZoneDef {
  return zones.find((zone) => zone.id === employee.workstationId) ?? fallbackZone;
}

/** Deterministic seat coordinate per employee, grouped by their assigned zone. */
export function employeePositions(
  roster: Employee[],
  zones: ZoneDef[],
  fallbackZone: ZoneDef,
): Map<string, [number, number]> {
  const byZone = new Map<string, { zone: ZoneDef; employees: Employee[] }>();
  for (const employee of roster) {
    const zone = employeeZone(employee, zones, fallbackZone);
    const group = byZone.get(zone.id) ?? { zone, employees: [] };
    group.employees.push(employee);
    byZone.set(zone.id, group);
  }

  const positions = new Map<string, [number, number]>();
  for (const { zone, employees } of byZone.values()) {
    const seats = seatsInZone(zone, employees.length);
    employees.forEach((employee, index) => {
      positions.set(employee.id, seats[index] ?? [zone.cx, zone.cz]);
    });
  }
  return positions;
}

/** Floor extent (origin-centered) that bounds every zone plus a margin, used by
 *  the 2D top-down scene to scale the real layout to the canvas. */
export function floorBounds(zoneDefs: ZoneDef[]): { floorW: number; floorD: number } {
  if (zoneDefs.length === 0) return { floorW: 32, floorD: 28 };
  let maxX = 0;
  let maxZ = 0;
  for (const z of zoneDefs) {
    maxX = Math.max(maxX, Math.abs(z.cx) + z.w / 2);
    maxZ = Math.max(maxZ, Math.abs(z.cz) + z.d / 2);
  }
  const margin = 2;
  return { floorW: maxX * 2 + margin * 2, floorD: maxZ * 2 + margin * 2 };
}

/** Map a zone archetype onto the 2D top-down tint key (workspace/meeting/lounge). */
export function archetypeToKind(archetype: string): ZoneKind {
  if (archetype === 'meeting') return 'meeting';
  if (archetype === 'rest' || archetype === 'lounge') return 'lounge';
  return 'workspace';
}
