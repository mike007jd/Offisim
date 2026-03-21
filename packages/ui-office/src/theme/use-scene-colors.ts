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

/**
 * "Modern Coworking" scene palette.
 * Warm neutrals, light wood tones, soft contrast.
 * Feels like a real modern office — not a cold wireframe.
 */
const SCENE: SceneColors = {
  // ── Surfaces: warm cream/wood tones ──
  floor: '#e8e4dc',           // warm beige floor (like light wood)
  desk: '#faf9f6',            // near-white desk surface (clean)
  deskEdge: '#d4d0c7',        // warm edge
  furniture: '#c8c3b8',       // warm gray furniture
  furnitureDark: '#8a857d',   // warm dark (chair bases, keyboards)
  furnitureLight: '#e3e0d8',  // warm light (shelves, panels)
  partition: '#b8b3a8',       // warm divider / glass tint

  // ── Tech: subtle, not neon ──
  screen: '#5ab0c8',          // soft teal screen (not harsh blue)
  metal: '#a09b93',           // brushed warm metal
  serverBody: '#6b655c',      // warm dark server rack
  ledCyan: '#2d9c8f',         // warm teal LED
  ledGreen: '#2d9c6f',        // warm green LED
  ledBlue: '#4a8ea8',         // warm blue LED (NOT AI blue)
  ledAmber: '#c78c20',        // warm amber LED

  // ── Nature ──
  potBase: '#b8b3a8',         // terracotta-ish pot
  leafPrimary: '#5a9e78',     // warm green
  leafSecondary: '#3d7a5a',   // darker warm green
  leafTertiary: '#7ab890',    // lighter warm green

  // ── Text / UI ──
  text: '#2c2924',            // warm charcoal
  textMuted: '#9e978d',       // warm muted
  selectionRing: '#c17040',   // terracotta accent (matches app accent)
};

// Both modes use the same warm palette — unified look
const DARK_SCENE = SCENE;
const LIGHT_SCENE = SCENE;

export function useSceneColors(): SceneColors {
  const { resolvedTheme } = useTheme();
  return useMemo(() => (resolvedTheme === 'dark' ? DARK_SCENE : LIGHT_SCENE), [resolvedTheme]);
}
