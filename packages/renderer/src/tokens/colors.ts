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
