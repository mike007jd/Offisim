import { useMemo } from 'react';
import { useTheme } from './theme-provider.js';

export interface SceneColors {
  // Surfaces
  floor: string;
  desk: string;
  deskEdge: string;
  furniture: string;
  furnitureDark: string;
  furnitureLight: string;
  partition: string;
  // Tech
  screen: string;
  metal: string;
  serverBody: string;
  ledCyan: string;
  ledGreen: string;
  ledBlue: string;
  ledAmber: string;
  // Nature
  potBase: string;
  leafPrimary: string;
  leafSecondary: string;
  leafTertiary: string;
  // Text / UI
  text: string;
  textMuted: string;
  selectionRing: string;
}

const DARK_SCENE: SceneColors = {
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
};

const LIGHT_SCENE: SceneColors = {
  floor: '#e2e8f0',
  desk: '#ffffff',
  deskEdge: '#cbd5e1',
  furniture: '#e2e8f0',
  furnitureDark: '#cbd5e1',
  furnitureLight: '#f1f5f9',
  partition: '#94a3b8',
  screen: '#0284c7',
  metal: '#94a3b8',
  serverBody: '#334155',
  ledCyan: '#06b6d4',
  ledGreen: '#22c55e',
  ledBlue: '#3b82f6',
  ledAmber: '#f59e0b',
  potBase: '#a1a1aa',
  leafPrimary: '#10b981',
  leafSecondary: '#059669',
  leafTertiary: '#34d399',
  text: '#1e293b',
  textMuted: '#64748b',
  selectionRing: '#2563eb',
};

export function useSceneColors(): SceneColors {
  const { resolvedTheme } = useTheme();
  return useMemo(() => (resolvedTheme === 'dark' ? DARK_SCENE : LIGHT_SCENE), [resolvedTheme]);
}
