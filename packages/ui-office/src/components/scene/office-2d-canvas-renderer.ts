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

import type { EmployeeState } from '@offisim/shared-types';
import { STATE_COLORS_DARK, STATE_COLORS_LIGHT, type Scene3DColors } from '@offisim/ui-core/tokens';
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

// ── Token-driven palette contract ────────────────────────────────────

/**
 * Narrow `Scene3DColors` view exposing exactly the 2D-canvas fields.
 * Single source of truth: `SCENE_CANVAS_PALETTE_KEYS` drives both the
 * `SceneCanvasPalette` type and `pickSceneCanvasPalette`'s runtime projection
 * — adding a key only requires touching this tuple.
 *
 * Layer + helper fns receive the projected palette through
 * `FrameContext.palette`; the React caller picks it once per frame from
 * `useSceneColors()`.
 */
export const SCENE_CANVAS_PALETTE_KEYS = [
  'canvasBackground',
  'canvasGrid',
  'deskSurface',
  'deskScreen',
  'deskBezel',
  'pillBg',
  'pillBgStroke',
  'pillText',
  'dotRing',
  'nameLabelMuted',
  'meetingBubbleBg',
  'meetingBubbleStroke',
  'meetingBubbleTitle',
  'meetingBubbleParticipantText',
  'meetingBubbleWaitingText',
  'meetingBubbleExtraText',
  'managerMarkerFill',
  'managerMarkerStroke',
  'managerMarkerLabel',
  'selectionRing2D',
  'dragGhostShadow',
  'prefabSilhouetteDegraded',
  'stateBadgeBg',
  'stateBadgeStroke',
  'stateBadgeText',
  'stateBadgeBgBlocked',
  'stateBadgeStrokeBlocked',
  'stateBadgeTextBlocked',
  'stateBadgeBgSuccess',
  'stateBadgeStrokeSuccess',
  'stateBadgeTextSuccess',
] as const satisfies readonly (keyof Scene3DColors)[];

export type SceneCanvasPalette = Pick<Scene3DColors, (typeof SCENE_CANVAS_PALETTE_KEYS)[number]>;

/** Build the canvas palette from full `Scene3DColors` (the React caller does this once per redraw). */
export function pickSceneCanvasPalette(colors: Scene3DColors): SceneCanvasPalette {
  const palette = {} as { [K in keyof SceneCanvasPalette]: SceneCanvasPalette[K] };
  for (const key of SCENE_CANVAS_PALETTE_KEYS) {
    palette[key] = colors[key];
  }
  return palette;
}

// ── Status colors (token-driven, theme-aware) ─────────────────────────

const DEFAULT_STATUS_COLOR_NUMERIC = 0x64748b;

function numericToHex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** Build the per-employee status color map (hex strings) for the active theme. */
export function buildStatusColors(theme: 'light' | 'dark'): Record<EmployeeState, string> {
  const source = theme === 'light' ? STATE_COLORS_LIGHT : STATE_COLORS_DARK;
  const out = {} as Record<EmployeeState, string>;
  for (const key of Object.keys(source) as EmployeeState[]) {
    out[key] = numericToHex(source[key]);
  }
  return out;
}

/** Resolve a status string (loose key) to the active palette's hex string, with fallback. */
export function resolveStatusColor(
  state: string,
  statusColors: Record<EmployeeState, string>,
): string {
  return Object.prototype.hasOwnProperty.call(statusColors, state)
    ? statusColors[state as EmployeeState]
    : numericToHex(DEFAULT_STATUS_COLOR_NUMERIC);
}

/**
 * Legacy non-React helper kept for compatibility. Returns the dark-theme
 * status color for a given state — callers running inside React should
 * prefer `buildStatusColors(theme)` + `resolveStatusColor` instead so the
 * value follows the active theme.
 */
const DARK_STATUS_COLORS = buildStatusColors('dark');
export function getStatusColor(state: string): string {
  return resolveStatusColor(state, DARK_STATUS_COLORS);
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
  /** Scene color palette resolved from `useSceneColors()` for the active theme. */
  palette: SceneCanvasPalette;
  /** Full scene colors — used by prefab silhouettes that need broader 3D tokens. */
  sceneColors: Scene3DColors;
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
