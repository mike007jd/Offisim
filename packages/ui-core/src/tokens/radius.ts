export type RadiusName = 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';

export const RADIUS_SCALE: Record<RadiusName, number> = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};
