// raw-hex-allowed-file: asset renderer palette; non-design-token content colors.
/**
 * office-2d-canvas-renderer.ts — Thin orchestrator for the 2D office canvas.
 *
 * Responsibilities:
 *  - Own the public `drawScene(ctx, snapshot, frame)` API.
 *  - Own the shared render data types consumed by every layer.
 *  - Delegate actual drawing to the per-layer modules in `./canvas-layers/`.
 *
 * Draw order (back-to-front) mirrors the 7 layers called from `drawScene`:
 *   background → zones → prefabs → employees → ceremony → interactions → drag-overlay.
 *
 * The dpr-aware viewport transform is applied inside `drawBackground`; every
 * downstream layer trusts the ctx is already in world coords.
 */

import { drawBackground } from './canvas-layers/draw-background';
import { drawCeremony } from './canvas-layers/draw-ceremony';
import { drawDragOverlay } from './canvas-layers/draw-drag-overlay';
import { drawEmployees } from './canvas-layers/draw-employees';
import { drawInteractions } from './canvas-layers/draw-interactions';
import { drawPrefabs } from './canvas-layers/draw-prefabs';
import { drawZones } from './canvas-layers/draw-zones';
import type { ViewportTransform } from './office-2d-canvas-geometry';

export type { ViewportTransform } from './office-2d-canvas-geometry';

/** Degraded-rendering threshold: switch to cheap silhouettes past this many employees. */
export const DEGRADED_THRESHOLD = 50;

// ── Status colors ─────────────────────────────────────────────────────

export const STATUS_COLORS: Record<string, string> = {
  idle: '#64748b',
  assigned: '#3b82f6',
  thinking: '#818cf8',
  searching: '#c084fc',
  executing: '#10b981',
  blocked: '#ef4444',
  waiting: '#f59e0b',
  reporting: '#06b6d4',
  success: '#22c55e',
  failed: '#ef4444',
};

const DEFAULT_STATUS_COLOR = '#64748b';

export function getStatusColor(state: string): string {
  return Object.prototype.hasOwnProperty.call(STATUS_COLORS, state)
    ? (STATUS_COLORS[state] as string)
    : DEFAULT_STATUS_COLOR;
}

// ── Stable scene data (SSOT rebuilt only when scene inputs change) ────

export interface SceneSnapshot {
  zones: ReadonlyArray<ZoneRenderData>;
  prefabs: ReadonlyArray<PrefabRenderData>;
  employees: ReadonlyArray<EmployeeRenderData>;
  ceremony: CeremonyRenderData;
  managerMarker: ManagerMarkerData | null;
  meetingBubble: MeetingBubbleData | null;
}

export interface ZoneRenderData {
  zoneId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  accentColor: string;
  label: string;
  isInfrastructure: boolean;
}

export interface PrefabRenderData {
  prefabId: string;
  category: string;
  x: number;
  y: number;
  rotation: number;
}

export interface EmployeeRenderData {
  employeeId: string;
  x: number;
  y: number;
  name: string;
  avatarImage: HTMLImageElement | ImageBitmap | null;
  statusColor: string;
  state: string;
  stateLabel: string | null;
  isBlocked: boolean;
  isSuccess: boolean;
  isWorking: boolean;
  isActive: boolean;
  isExternal: boolean;
  brandKey: string | null;
}

export interface CeremonyRenderData {
  phase: string;
  isActive: boolean;
}

export interface ManagerMarkerData {
  x: number;
  y: number;
}

export interface MeetingBubbleData {
  x: number;
  y: number;
  phaseColor: string;
  bubbleText: string;
  participantCount: number;
  waitingLabels: string[];
  extraWaitingCount: number;
}

// ── Per-frame transient context (rebuilt each rAF tick) ───────────────

export interface InteractionState {
  selectedEmployeeId: string | null;
  hoveredEmployeeId: string | null;
  drag: DragRenderState | null;
}

export interface DragRenderState {
  ghostX: number;
  ghostY: number;
  ghostAvatarImage: HTMLImageElement | ImageBitmap | null;
  ghostName: string;
  ghostStatusColor: string;
  sourceZoneId: string;
  hoveredZoneId: string | null;
  dropTargetZoneIds: string[];
}

export interface FrameContext {
  interaction: InteractionState;
  animationTime: number;
  canvasSize: { width: number; height: number; devicePixelRatio: number };
  transform: ViewportTransform;
}

// ── Legacy / compatibility exports ────────────────────────────────────

/**
 * Evenly spaced positions along a semicircle (π arc) around (cx, cy).
 * Kept exported for consumer compatibility — not called by `drawScene` itself.
 */
export function computeSemicirclePositions(
  centerX: number,
  centerY: number,
  radius: number,
  count: number,
): Array<{ x: number; y: number }> {
  if (count <= 0) return [];
  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.PI * ((i + 1) / (count + 1));
    positions.push({
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius * 0.6,
    });
  }
  return positions;
}

// ── Orchestrator ──────────────────────────────────────────────────────

/**
 * Draw the complete scene. `drawBackground` installs the dpr-aware world
 * transform; subsequent layers trust it and draw in world coords.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneSnapshot,
  frame: FrameContext,
): void {
  drawBackground(ctx, snapshot, frame);
  drawZones(ctx, snapshot, frame);
  drawPrefabs(ctx, snapshot, frame);
  drawEmployees(ctx, snapshot, frame);
  drawCeremony(ctx, snapshot, frame);
  drawInteractions(ctx, snapshot, frame);
  drawDragOverlay(ctx, snapshot, frame);
  ctx.resetTransform();
}
