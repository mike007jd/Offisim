export type RadiusName = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full' | 'pill';

export const RADIUS_SCALE: Record<RadiusName, number> = {
  none: 0,
  xs: 5,
  sm: 7,
  md: 9,
  lg: 13,
  xl: 18,
  full: 9999,
  pill: 999,
};
