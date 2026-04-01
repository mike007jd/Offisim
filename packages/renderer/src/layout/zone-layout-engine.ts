// ── Zone Layout Engine ──────────────────────────────────────────────
// Pure algorithm module — NO PixiJS / GSAP dependencies.
// Computes an OfficeFloorPlan from zone configs and employee counts.
// The office is one floor divided into typed zones arranged in rows.

import type { Zone, ZoneArchetype } from '@offisim/shared-types';

// ── Legacy ZoneConfig adapter ────────────────────────────────────
// The layout engine internally uses a ZoneType classification.
// Map Zone.archetype to the legacy type for backward compat.

type LayoutZoneType = 'department' | 'library' | 'rest_area' | 'meeting_room' | 'server_room';

function archetypeToLayoutType(archetype: ZoneArchetype | null): LayoutZoneType {
  switch (archetype) {
    case 'workspace':
      return 'department';
    case 'library':
      return 'library';
    case 'rest':
      return 'rest_area';
    case 'meeting':
      return 'meeting_room';
    case 'server':
      return 'server_room';
    default:
      return 'department';
  }
}

/** Internal zone representation used by the layout algorithm. */
interface LayoutZone {
  readonly zoneId: string;
  readonly type: LayoutZoneType;
  readonly label: string;
  readonly labelEn: string;
  readonly floorColor: number;
  readonly minSlots: number;
}

function toLayoutZone(zone: Zone): LayoutZone {
  return {
    zoneId: zone.zoneId,
    type: archetypeToLayoutType(zone.archetype),
    label: zone.label,
    labelEn: zone.label,
    floorColor: zone.floorColor,
    minSlots: zone.deskSlots,
  };
}

// ── Public types ────────────────────────────────────────────────────

export interface DeskPosition {
  workstationId: string;
  x: number;
  y: number;
  zoneId: string;
}

export interface ZoneBounds {
  zoneId: string;
  type: 'department' | 'library' | 'rest_area' | 'meeting_room' | 'server_room';
  x: number;
  y: number;
  width: number;
  height: number;
  floorColor: number;
  label: string;
  labelEn: string;
  workstations: DeskPosition[];
}

export interface OfficeFloorPlan {
  totalWidth: number;
  totalHeight: number;
  zones: ZoneBounds[];
  /** All workstations keyed by workstationId */
  allWorkstations: Map<string, DeskPosition>;
}

export interface FloorPlanOptions {
  /** Padding between zones (default: 20) */
  zonePadding?: number;
  /** Gap between desks within a zone (default: 80) */
  deskGap?: number;
  /** Desk width (default: 50) */
  deskWidth?: number;
  /** Desk height (default: 30) */
  deskHeight?: number;
  /** Floor margin (default: 30) */
  margin?: number;
}

// ── Defaults ────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<FloorPlanOptions> = {
  zonePadding: 20,
  deskGap: 80,
  deskWidth: 50,
  deskHeight: 30,
  margin: 30,
};

/** Label header height inside each zone */
const ZONE_HEADER_HEIGHT = 30;

/** Minimum non-department zone dimension */
const MIN_UTILITY_WIDTH = 200;
const MIN_UTILITY_HEIGHT = 120;

/** Floor width constraints */
const MIN_FLOOR_WIDTH = 800;
const MAX_FLOOR_WIDTH = 2400;

// ── Core layout algorithm ───────────────────────────────────────────

/**
 * Compute the full office floor plan.
 *
 * Layout rows:
 *   Row 1: Department zones side by side (sorted by slot count, largest left)
 *   Row 2: Library + Rest Area side by side
 *   Row 3: Meeting Room (full width, centered)
 */
export function computeFloorPlan(
  inputZones: readonly Zone[],
  employeeCounts: Map<string, number>,
  options?: FloorPlanOptions,
): OfficeFloorPlan {
  const userOpts = options ?? {};
  const opts = { ...DEFAULT_OPTIONS, ...userOpts };

  const zones = inputZones.map(toLayoutZone);

  // ── Classify zones by type ──────────────────────────────────────
  const departmentZones = zones.filter((z) => z.type === 'department');
  const libraryZone = zones.find((z) => z.type === 'library');
  const restZone = zones.find((z) => z.type === 'rest_area');
  const serverZone = zones.find((z) => z.type === 'server_room');
  const meetingZone = zones.find((z) => z.type === 'meeting_room');

  // ── Step 1: Compute slot counts for departments ─────────────────
  const slotMap = new Map<string, number>();
  for (const dz of departmentZones) {
    const count = employeeCounts.get(dz.zoneId) ?? 0;
    // 20% headroom, but never below minSlots
    const slots = Math.max(dz.minSlots, Math.ceil(count * 1.2));
    slotMap.set(dz.zoneId, slots);
  }

  // Sort departments by slot count descending (largest left)
  const sortedDepts = [...departmentZones].sort(
    (a, b) => (slotMap.get(b.zoneId) ?? 0) - (slotMap.get(a.zoneId) ?? 0),
  );

  // ── Step 2: Compute each department zone's internal dimensions ──
  interface DeptLayout {
    zone: LayoutZone;
    slots: number;
    cols: number;
    rows: number;
    width: number;
    height: number;
  }

  const deptLayouts: DeptLayout[] = sortedDepts.map((zone) => {
    const slots = slotMap.get(zone.zoneId) ?? zone.minSlots;
    return computeDeptZoneLayout(zone, slots, opts);
  });

  // ── Step 3: Arrange Row 1 (departments) ─────────────────────────
  const row1Width =
    deptLayouts.reduce((sum, d) => sum + d.width, 0) +
    Math.max(0, deptLayouts.length - 1) * opts.zonePadding;
  const row1Height = deptLayouts.length > 0 ? Math.max(...deptLayouts.map((d) => d.height)) : 0;

  // ── Step 4: Arrange Row 2 (Library + Rest Area) ─────────────────
  // These zones share the row, each gets half the available width
  const hasRow2 = libraryZone || restZone;
  const row2Zones = [libraryZone, restZone].filter(Boolean) as LayoutZone[];

  // ── Step 5: Determine total floor width ─────────────────────────
  const rawFloorWidth = Math.max(row1Width, MIN_FLOOR_WIDTH);
  const floorContentWidth = Math.min(rawFloorWidth, MAX_FLOOR_WIDTH);

  // ── Step 5b: Apply dynamic zonePadding if user didn't override ─
  if (userOpts.zonePadding === undefined) {
    opts.zonePadding = Math.max(DEFAULT_OPTIONS.zonePadding, Math.round(floorContentWidth * 0.02));
  }

  // Row 2 dimensions — height scales with row 1
  const row2Count = row2Zones.length;
  const row2ZoneWidth =
    row2Count > 0 ? (floorContentWidth - (row2Count - 1) * opts.zonePadding) / row2Count : 0;
  const row2Height = hasRow2 ? Math.max(MIN_UTILITY_HEIGHT, Math.round(row1Height * 0.5)) : 0;

  // ── Step 5c: Ensure department zones are at least as tall as row2 ─
  // Avoid departments being shorter than utility zones
  if (row2Height > 0 && row1Height < row2Height) {
    for (const dl of deptLayouts) {
      dl.height = Math.max(dl.height, row2Height);
    }
  }
  // Recompute row1Height after potential adjustment
  const finalRow1Height =
    deptLayouts.length > 0 ? Math.max(...deptLayouts.map((d) => d.height)) : 0;

  // Row 3 (meeting room + server room)
  const hasRow3 = meetingZone || serverZone;
  const row3Height = hasRow3 ? MIN_UTILITY_HEIGHT : 0;
  const row3Zones = [meetingZone, serverZone].filter(Boolean) as LayoutZone[];

  // ── Step 6: Compute total dimensions ────────────────────────────
  const rowCount = [finalRow1Height > 0, hasRow2, hasRow3].filter(Boolean).length;
  const interRowPadding = Math.max(0, rowCount - 1) * opts.zonePadding;

  const totalWidth = floorContentWidth + 2 * opts.margin;
  const totalHeight = finalRow1Height + row2Height + row3Height + interRowPadding + 2 * opts.margin;

  // ── Step 7: Place zones and generate workstations ───────────────
  const result: ZoneBounds[] = [];
  const allWorkstations = new Map<string, DeskPosition>();

  // -- Row 1: Departments --
  let cursorX = opts.margin;
  const row1Y = opts.margin;

  for (const dl of deptLayouts) {
    const workstations = generateDeskGrid(dl.zone.zoneId, cursorX, row1Y, dl.slots, dl.cols, opts);

    result.push({
      zoneId: dl.zone.zoneId,
      type: 'department',
      x: cursorX,
      y: row1Y,
      width: dl.width,
      height: dl.height,
      floorColor: dl.zone.floorColor,
      label: dl.zone.label,
      labelEn: dl.zone.labelEn,
      workstations,
    });

    for (const ws of workstations) {
      allWorkstations.set(ws.workstationId, ws);
    }

    cursorX += dl.width + opts.zonePadding;
  }

  // -- Row 2: Library + Rest Area --
  if (hasRow2) {
    const row2Y = row1Y + finalRow1Height + (finalRow1Height > 0 ? opts.zonePadding : 0);
    let row2CursorX = opts.margin;

    for (const z of row2Zones) {
      const zoneWidth = Math.max(MIN_UTILITY_WIDTH, row2ZoneWidth);
      result.push({
        zoneId: z.zoneId,
        type: z.type as ZoneBounds['type'],
        x: row2CursorX,
        y: row2Y,
        width: zoneWidth,
        height: row2Height,
        floorColor: z.floorColor,
        label: z.label,
        labelEn: z.labelEn,
        workstations: [], // utility zones have no permanent workstations
      });

      row2CursorX += zoneWidth + opts.zonePadding;
    }
  }

  // -- Row 3: Meeting Room + Server Room --
  if (hasRow3) {
    const row3Y =
      opts.margin +
      finalRow1Height +
      (finalRow1Height > 0 ? opts.zonePadding : 0) +
      row2Height +
      (hasRow2 ? opts.zonePadding : 0);

    if (row3Zones.length === 1) {
      // Single zone in row 3 — centered at 80% width (existing behavior for meeting room)
      const [z] = row3Zones;
      if (!z) {
        throw new Error('Expected a single row 3 zone');
      }
      const zoneWidth = Math.max(MIN_UTILITY_WIDTH, floorContentWidth * 0.8);
      const zoneX = opts.margin + (floorContentWidth - zoneWidth) / 2;

      result.push({
        zoneId: z.zoneId,
        type: z.type as ZoneBounds['type'],
        x: zoneX,
        y: row3Y,
        width: zoneWidth,
        height: row3Height,
        floorColor: z.floorColor,
        label: z.label,
        labelEn: z.labelEn,
        workstations: [],
      });
    } else {
      // Two zones share row 3: meeting room gets 70%, server room gets 30%
      const meetingFraction = 0.7;
      const totalGap = (row3Zones.length - 1) * opts.zonePadding;
      const availableWidth = floorContentWidth - totalGap;

      let row3CursorX = opts.margin;
      for (const z of row3Zones) {
        const fraction = z.type === 'meeting_room' ? meetingFraction : 1 - meetingFraction;
        const zoneWidth = Math.max(MIN_UTILITY_WIDTH, availableWidth * fraction);

        result.push({
          zoneId: z.zoneId,
          type: z.type as ZoneBounds['type'],
          x: row3CursorX,
          y: row3Y,
          width: zoneWidth,
          height: row3Height,
          floorColor: z.floorColor,
          label: z.label,
          labelEn: z.labelEn,
          workstations: [],
        });

        row3CursorX += zoneWidth + opts.zonePadding;
      }
    }
  }

  return {
    totalWidth,
    totalHeight,
    zones: result,
    allWorkstations,
  };
}

// ── Rest area seat computation ──────────────────────────────────────

/**
 * Generate temporary seat positions inside a rest area zone.
 * Uses a relaxed grid with larger spacing for informal seating.
 */
export function computeRestAreaSeats(zone: ZoneBounds, count: number): DeskPosition[] {
  if (count <= 0) return [];

  const seatGap = 100; // larger spacing than desks
  const seatSize = 40;
  const padding = 20;
  const headerOffset = ZONE_HEADER_HEIGHT;

  const usableWidth = zone.width - 2 * padding;
  const cols = Math.max(1, Math.floor(usableWidth / (seatSize + seatGap)));
  const seats: DeskPosition[] = [];

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);

    const x = zone.x + padding + col * (seatSize + seatGap) + seatSize / 2;
    const y = zone.y + headerOffset + padding + row * (seatSize + seatGap) + seatSize / 2;

    // Only place seats that fit within the zone
    if (x + seatSize / 2 > zone.x + zone.width || y + seatSize / 2 > zone.y + zone.height) {
      break;
    }

    seats.push({
      workstationId: `seat-${zone.zoneId}-${i}`,
      x,
      y,
      zoneId: zone.zoneId,
    });
  }

  return seats;
}

// ── Internal helpers ────────────────────────────────────────────────

/**
 * Compute internal grid dimensions for a department zone.
 */
function computeDeptZoneLayout(zone: LayoutZone, slots: number, opts: Required<FloorPlanOptions>) {
  const cellWidth = opts.deskWidth + opts.deskGap;
  const cellHeight = opts.deskHeight + opts.deskGap;

  // Zone should be wide enough for at least 2 desks side-by-side,
  // or enough to hold half the slots per row (roughly 2-row layout).
  const rawWidth = Math.max(2 * cellWidth, Math.ceil(slots / 2) * cellWidth);
  const width = rawWidth;

  const cols = Math.max(1, Math.floor(width / cellWidth));
  const rows = Math.max(1, Math.ceil(slots / cols));
  const height = rows * cellHeight + ZONE_HEADER_HEIGHT;

  return { zone, slots, cols, rows, width, height };
}

/**
 * Generate a grid of desk positions within a zone.
 * Desks are placed below the header, centered within each cell.
 */
function generateDeskGrid(
  zoneId: string,
  zoneX: number,
  zoneY: number,
  slots: number,
  cols: number,
  opts: Required<FloorPlanOptions>,
): DeskPosition[] {
  const cellWidth = opts.deskWidth + opts.deskGap;
  const cellHeight = opts.deskHeight + opts.deskGap;
  const desks: DeskPosition[] = [];

  for (let i = 0; i < slots; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);

    // Position = zone origin + cell offset + half-desk centering
    const x = zoneX + col * cellWidth + opts.deskGap / 2 + opts.deskWidth / 2;
    const y =
      zoneY + ZONE_HEADER_HEIGHT + row * cellHeight + opts.deskGap / 2 + opts.deskHeight / 2;

    desks.push({
      workstationId: `ws-${zoneId}-${i}`,
      x,
      y,
      zoneId,
    });
  }

  return desks;
}
