import type { EmployeeState } from '@offisim/shared-types';

export interface Scene3DColors {
  floor: string;
  desk: string;
  deskEdge: string;
  furniture: string;
  furnitureDark: string;
  furnitureLight: string;
  partition: string;
  screen: string;
  metal: string;
  serverBody: string;
  ledCyan: string;
  ledGreen: string;
  ledBlue: string;
  ledAmber: string;
  potBase: string;
  leafPrimary: string;
  leafSecondary: string;
  leafTertiary: string;
  text: string;
  textMuted: string;
  selectionRing: string;
  sceneBackground: string;
  wallShell: string;
  bookSpine: readonly [string, string, string, string, string];
  cableChannel: string;
  vendingScreen: string;
  tableReading: string;
  whiteboardSurface: string;
  whiteboardMarker: readonly [string, string, string];
  accentWarm: string;
  accentCool: string;
  floorTile: string;
  floorTileAlt: string;
  floorGrid: string;
  floorBorder: string;
  wallPanel: string;
  wallTrim: string;
  wallShadow: string;
  zoneRug: string;
  zoneLabelBg: string;
  zoneLabelText: string;
  labelGlow: string;
  workMat: string;
  cableAccent: string;
  characterShoe: string;
  characterHand: string;
  brandNeutral: string;
  // 2D canvas-only fields (added by `scene-2d-theme-tokens` capability)
  canvasBackground: string;
  canvasGrid: string;
  deskSurface: string;
  deskScreen: string;
  deskBezel: string;
  pillBg: string;
  pillBgStroke: string;
  pillText: string;
  dotRing: string;
  nameLabelMuted: string;
  meetingBubbleBg: string;
  meetingBubbleStroke: string;
  meetingBubbleTitle: string;
  meetingBubbleParticipantText: string;
  meetingBubbleWaitingText: string;
  meetingBubbleExtraText: string;
  managerMarkerFill: string;
  managerMarkerStroke: string;
  managerMarkerLabel: string;
  selectionRing2D: string;
  dragGhostShadow: string;
  prefabSilhouetteDegraded: string;
  stateBadgeBg: string;
  stateBadgeStroke: string;
  stateBadgeText: string;
  stateBadgeBgBlocked: string;
  stateBadgeStrokeBlocked: string;
  stateBadgeTextBlocked: string;
  stateBadgeBgSuccess: string;
  stateBadgeStrokeSuccess: string;
  stateBadgeTextSuccess: string;
}

export const DARK_SCENE_3D: Scene3DColors = {
  floor: '#253347',
  desk: '#e2e8f0',
  deskEdge: '#cbd5e1',
  furniture: '#2d3b4f',
  furnitureDark: '#0f172a',
  furnitureLight: '#334155',
  partition: '#94a3b8',
  screen: '#0ea5e9',
  metal: '#334155',
  serverBody: '#0f172a',
  ledCyan: '#06b6d4',
  ledGreen: '#22c55e',
  ledBlue: '#3b82f6',
  ledAmber: '#fbbf24',
  potBase: '#334155',
  leafPrimary: '#10b981',
  leafSecondary: '#059669',
  leafTertiary: '#34d399',
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  selectionRing: '#3b82f6',
  sceneBackground: '#020617',
  wallShell: '#1c2538',
  bookSpine: ['#10b981', '#059669', '#047857', '#34d399', '#6ee7b7'],
  cableChannel: '#0c4a6e',
  vendingScreen: '#fbbf24',
  tableReading: '#064e3b',
  whiteboardSurface: '#f8fafc',
  whiteboardMarker: ['#06b6d4', '#334155', '#f97316'],
  accentWarm: '#d97706',
  accentCool: '#06b6d4',
  floorTile: '#1f2a36',
  floorTileAlt: '#2a3442',
  floorGrid: '#536172',
  floorBorder: '#8b7355',
  wallPanel: '#2e3a4a',
  wallTrim: '#4b5563',
  wallShadow: '#111827',
  zoneRug: '#263241',
  zoneLabelBg: 'rgba(14,18,25,0.82)',
  zoneLabelText: '#e5edf7',
  labelGlow: '#67e8f9',
  workMat: '#1f6f5b',
  cableAccent: '#d97706',
  characterShoe: '#111827',
  characterHand: '#f2c6b6',
  brandNeutral: '#64748b',
  // 2D canvas-only fields (byte-equivalent to pre-tokenization literals)
  canvasBackground: '#020617',
  canvasGrid: 'rgba(148, 163, 184, 0.06)',
  deskSurface: 'rgba(30, 41, 59, 0.6)',
  deskScreen: 'rgba(14, 165, 233, 0.5)',
  deskBezel: 'rgba(51, 65, 85, 1)',
  pillBg: '#1e293b',
  pillBgStroke: 'rgba(255, 255, 255, 0.08)',
  pillText: '#f8fafc',
  dotRing: '#1e293b',
  nameLabelMuted: '#f8fafc',
  meetingBubbleBg: 'rgba(0, 0, 0, 0.65)',
  meetingBubbleStroke: 'rgba(255, 255, 255, 0.10)',
  meetingBubbleTitle: 'rgba(255, 255, 255, 0.85)',
  meetingBubbleParticipantText: 'rgba(255, 255, 255, 0.35)',
  meetingBubbleWaitingText: 'rgba(255, 255, 255, 0.55)',
  meetingBubbleExtraText: 'rgba(255, 255, 255, 0.45)',
  managerMarkerFill: 'rgba(168, 85, 247, 0.15)',
  managerMarkerStroke: '#a855f7',
  managerMarkerLabel: '#ffffff',
  selectionRing2D: '#6366f1',
  dragGhostShadow: 'rgba(0, 0, 0, 0.3)',
  prefabSilhouetteDegraded: 'rgba(100, 116, 139, 0.1)',
  stateBadgeBg: 'rgba(0, 0, 0, 0.7)',
  stateBadgeStroke: 'rgba(255, 255, 255, 0.1)',
  stateBadgeText: 'rgba(255, 255, 255, 0.8)',
  stateBadgeBgBlocked: 'rgba(239, 68, 68, 0.25)',
  stateBadgeStrokeBlocked: 'rgba(239, 68, 68, 0.4)',
  stateBadgeTextBlocked: '#fca5a5',
  stateBadgeBgSuccess: 'rgba(34, 197, 94, 0.25)',
  stateBadgeStrokeSuccess: 'rgba(34, 197, 94, 0.4)',
  stateBadgeTextSuccess: '#86efac',
};

export const LIGHT_SCENE_3D: Scene3DColors = {
  floor: '#c4cedb',
  desk: '#243044',
  deskEdge: '#344256',
  furniture: '#b2bdca',
  furnitureDark: '#738295',
  furnitureLight: '#d7dee8',
  partition: '#475569',
  screen: '#0284c7',
  metal: '#94a3b8',
  serverBody: '#475569',
  ledCyan: '#0891b2',
  ledGreen: '#16a34a',
  ledBlue: '#2563eb',
  ledAmber: '#d97706',
  potBase: '#94a3b8',
  leafPrimary: '#059669',
  leafSecondary: '#047857',
  leafTertiary: '#10b981',
  text: '#0f172a',
  textMuted: '#475569',
  selectionRing: '#2563eb',
  sceneBackground: '#e8edf4',
  wallShell: '#aeb9c8',
  bookSpine: ['#059669', '#047857', '#10b981', '#34d399', '#0d9488'],
  cableChannel: '#0284c7',
  vendingScreen: '#ca8a04',
  tableReading: '#047857',
  whiteboardSurface: '#ffffff',
  whiteboardMarker: ['#0891b2', '#475569', '#ea580c'],
  accentWarm: '#ea580c',
  accentCool: '#0891b2',
  floorTile: '#d8dee7',
  floorTileAlt: '#cbd5e1',
  floorGrid: '#94a3b8',
  floorBorder: '#9a7b4f',
  wallPanel: '#dbe2ec',
  wallTrim: '#94a3b8',
  wallShadow: '#64748b',
  zoneRug: '#e4ebf3',
  zoneLabelBg: 'rgba(248,250,252,0.86)',
  zoneLabelText: '#172033',
  labelGlow: '#0891b2',
  workMat: '#b7e4d2',
  cableAccent: '#ea580c',
  characterShoe: '#1e293b',
  characterHand: '#f2c6b6',
  brandNeutral: '#64748b',
  // 2D canvas-only fields (theme-correct light values preserving visual semantics)
  canvasBackground: '#e8edf4',
  canvasGrid: 'rgba(71, 85, 105, 0.10)',
  deskSurface: 'rgba(226, 232, 240, 0.85)',
  deskScreen: 'rgba(2, 132, 199, 0.55)',
  deskBezel: 'rgba(148, 163, 184, 0.95)',
  pillBg: '#ffffff',
  pillBgStroke: 'rgba(15, 23, 42, 0.10)',
  pillText: '#0f172a',
  dotRing: '#ffffff',
  nameLabelMuted: '#0f172a',
  meetingBubbleBg: 'rgba(248, 250, 252, 0.95)',
  meetingBubbleStroke: 'rgba(15, 23, 42, 0.10)',
  meetingBubbleTitle: 'rgba(15, 23, 42, 0.90)',
  meetingBubbleParticipantText: 'rgba(15, 23, 42, 0.50)',
  meetingBubbleWaitingText: 'rgba(15, 23, 42, 0.65)',
  meetingBubbleExtraText: 'rgba(15, 23, 42, 0.55)',
  managerMarkerFill: 'rgba(124, 58, 237, 0.18)',
  managerMarkerStroke: '#7c3aed',
  managerMarkerLabel: '#0f172a',
  selectionRing2D: '#2563eb',
  dragGhostShadow: 'rgba(15, 23, 42, 0.20)',
  prefabSilhouetteDegraded: 'rgba(100, 116, 139, 0.18)',
  stateBadgeBg: 'rgba(255, 255, 255, 0.90)',
  stateBadgeStroke: 'rgba(15, 23, 42, 0.12)',
  stateBadgeText: 'rgba(15, 23, 42, 0.80)',
  stateBadgeBgBlocked: 'rgba(220, 38, 38, 0.18)',
  stateBadgeStrokeBlocked: 'rgba(220, 38, 38, 0.45)',
  stateBadgeTextBlocked: '#991b1b',
  stateBadgeBgSuccess: 'rgba(22, 163, 74, 0.18)',
  stateBadgeStrokeSuccess: 'rgba(22, 163, 74, 0.45)',
  stateBadgeTextSuccess: '#15803d',
};

export const STATE_COLORS_DARK: Record<EmployeeState, number> = {
  idle: 0x94a3b8,
  assigned: 0x60a5fa,
  thinking: 0x818cf8,
  searching: 0xc084fc,
  executing: 0x34d399,
  meeting: 0xa78bfa,
  blocked: 0xf87171,
  waiting: 0xfbbf24,
  reporting: 0x2dd4bf,
  success: 0x4ade80,
  failed: 0xef4444,
  paused: 0x9ca3af,
};

export const STATE_COLORS_LIGHT: Record<EmployeeState, number> = {
  idle: 0x64748b,
  assigned: 0x2563eb,
  thinking: 0x4f46e5,
  searching: 0x9333ea,
  executing: 0x059669,
  meeting: 0x7c3aed,
  blocked: 0xdc2626,
  waiting: 0xd97706,
  reporting: 0x0d9488,
  success: 0x16a34a,
  failed: 0xdc2626,
  paused: 0x64748b,
};

export type StudioCategory =
  | 'workspace'
  | 'compute'
  | 'knowledge'
  | 'collaboration'
  | 'infrastructure'
  | 'decorative';

export const CATEGORY_COLORS_DARK: Record<StudioCategory, string> = {
  workspace: '#60a5fa',
  compute: '#f97316',
  knowledge: '#a78bfa',
  collaboration: '#34d399',
  infrastructure: '#facc15',
  decorative: '#4ade80',
};

export const CATEGORY_COLORS_LIGHT: Record<StudioCategory, string> = {
  workspace: '#2563eb',
  compute: '#ea580c',
  knowledge: '#7c3aed',
  collaboration: '#059669',
  infrastructure: '#ca8a04',
  decorative: '#16a34a',
};

export function getSceneColors(theme: 'light' | 'dark'): Scene3DColors {
  return theme === 'light' ? LIGHT_SCENE_3D : DARK_SCENE_3D;
}

export function getStateColors(theme: 'light' | 'dark'): Record<EmployeeState, number> {
  return theme === 'light' ? STATE_COLORS_LIGHT : STATE_COLORS_DARK;
}
