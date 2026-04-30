export type ShadowName =
  | 'resting'
  | 'hover'
  | 'popover'
  | 'overlay'
  | 'modal'
  | 'glowAccent'
  | 'glowSuccess'
  | 'glowWarning'
  | 'glowError';

export const SHADOW_SCALE_DARK: Record<ShadowName, string> = {
  resting: '0 1px 2px rgba(0,0,0,0.05)',
  hover: '0 2px 8px rgba(0,0,0,0.10)',
  popover: '0 8px 24px rgba(2,6,23,0.14)',
  overlay: '0 12px 32px rgba(2,6,23,0.18)',
  modal: '0 20px 60px rgba(2,6,23,0.28)',
  glowAccent: '0 0 12px rgba(59,130,246,0.20), inset 0 0 12px rgba(59,130,246,0.04)',
  glowSuccess: '0 0 12px rgba(16,185,129,0.20), inset 0 0 12px rgba(16,185,129,0.04)',
  glowWarning: '0 0 12px rgba(245,158,11,0.20), inset 0 0 12px rgba(245,158,11,0.04)',
  glowError: '0 0 12px rgba(239,68,68,0.20), inset 0 0 12px rgba(239,68,68,0.04)',
};

export const SHADOW_SCALE_LIGHT: Record<ShadowName, string> = {
  resting: '0 1px 2px rgba(2,6,23,0.04)',
  hover: '0 2px 8px rgba(2,6,23,0.08)',
  popover: '0 8px 24px rgba(2,6,23,0.12)',
  overlay: '0 12px 32px rgba(2,6,23,0.16)',
  modal: '0 20px 60px rgba(2,6,23,0.22)',
  glowAccent: '0 0 12px rgba(37,99,235,0.16), inset 0 0 12px rgba(37,99,235,0.03)',
  glowSuccess: '0 0 12px rgba(5,150,105,0.16), inset 0 0 12px rgba(5,150,105,0.03)',
  glowWarning: '0 0 12px rgba(217,119,6,0.16), inset 0 0 12px rgba(217,119,6,0.03)',
  glowError: '0 0 12px rgba(220,38,38,0.16), inset 0 0 12px rgba(220,38,38,0.03)',
};
