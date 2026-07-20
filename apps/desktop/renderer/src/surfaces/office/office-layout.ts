export const OFFICE_PANEL_SIZES = {
  workspace: { default: 296, min: 244, max: 360 },
  stage: { min: 620 },
  conversations: { default: 448, min: 400, max: 560 },
  separator: 1,
} as const;

export const OFFICE_LAYOUT_BREAKPOINTS = {
  compactMax: 1100,
  wideMin: 1366,
} as const;

export const OFFICE_LAYOUT_MEDIA = {
  compact: `(max-width: ${OFFICE_LAYOUT_BREAKPOINTS.compactMax}px)`,
  wide: `(min-width: ${OFFICE_LAYOUT_BREAKPOINTS.wideMin}px)`,
} as const;

export type OfficeRailTier = 'wide' | 'mid' | 'compact';

export interface OfficeRailState {
  left: boolean;
  right: boolean;
}

const THREE_PANEL_MIN_WIDTH =
  OFFICE_PANEL_SIZES.workspace.min +
  OFFICE_PANEL_SIZES.stage.min +
  OFFICE_PANEL_SIZES.conversations.min +
  OFFICE_PANEL_SIZES.separator * 2;

export function officeRailTierForWidth(width: number): OfficeRailTier {
  if (width >= OFFICE_LAYOUT_BREAKPOINTS.wideMin) return 'wide';
  if (width <= OFFICE_LAYOUT_BREAKPOINTS.compactMax) return 'compact';
  return 'mid';
}

export function responsiveOfficeRailState(
  tier: OfficeRailTier,
  preferred: OfficeRailState,
): OfficeRailState {
  if (tier === 'wide') return preferred;
  if (tier === 'mid') return { left: true, right: preferred.right };
  return { left: true, right: true };
}

export function officeRailsCanCoexist(width: number): boolean {
  return width >= THREE_PANEL_MIN_WIDTH;
}
