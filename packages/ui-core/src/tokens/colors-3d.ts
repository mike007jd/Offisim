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
};

export const LIGHT_SCENE_3D: Scene3DColors = {
  floor: '#dbe2ed',
  desk: '#1f2937',
  deskEdge: '#334155',
  furniture: '#cbd5e1',
  furnitureDark: '#94a3b8',
  furnitureLight: '#e2e8f0',
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
  sceneBackground: '#f8fafc',
  wallShell: '#cbd5e1',
  bookSpine: ['#059669', '#047857', '#10b981', '#34d399', '#0d9488'],
  cableChannel: '#0284c7',
  vendingScreen: '#ca8a04',
  tableReading: '#047857',
  whiteboardSurface: '#ffffff',
  whiteboardMarker: ['#0891b2', '#475569', '#ea580c'],
  accentWarm: '#ea580c',
  accentCool: '#0891b2',
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
