export const MOTION_DURATION = {
  instant: 50,
  fast: 150,
  normal: 250,
  slow: 400,
} as const;

export const MOTION_EASING = {
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
  accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;
