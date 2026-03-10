import type { EmployeeState } from '@aics/shared-types';

/** Hex colors for each employee state — source: SCENE_STATE_MATRIX + DESIGN_RULES */
export const STATE_COLORS: Record<EmployeeState, number> = {
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

/** Floor / furniture palette — retro pixel theme */
export const SCENE_COLORS = {
  floor:       0x333c57,  /* ocean-mid */
  floorBorder: 0x566c86,  /* ocean-light */
  desk:        0x566c86,  /* ocean-light */
  deskBorder:  0x8b9bb4,  /* shell */
  text:        0xf4f4f4,  /* sand */
  textLight:   0x8b9bb4,  /* shell */
} as const;
