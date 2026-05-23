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

const ELEV_1 = '0 1px 2px rgba(20,32,56,0.06), 0 1px 1px rgba(20,32,56,0.04)';
const ELEV_2 = '0 4px 14px rgba(20,32,56,0.10), 0 1px 3px rgba(20,32,56,0.06)';
const ELEV_3 = '0 18px 44px rgba(18,28,50,0.20), 0 4px 12px rgba(18,28,50,0.10)';

/**
 * Single light-only shadow scale (V3 is light-only). The 5 legacy elevation
 * names are re-pointed onto the V3 `elev-1/2/3` semantics so existing
 * `shadow-resting/hover/popover/overlay/modal` utilities keep working; the 4
 * glows are retained, re-tinted to V3 accent/ok/warn/danger.
 */
export const SHADOW_SCALE: Record<ShadowName, string> = {
  resting: ELEV_1,
  hover: ELEV_2,
  popover: ELEV_2,
  overlay: ELEV_3,
  modal: ELEV_3,
  glowAccent: '0 0 12px rgba(47,107,255,0.16), inset 0 0 12px rgba(47,107,255,0.03)',
  glowSuccess: '0 0 12px rgba(26,164,106,0.16), inset 0 0 12px rgba(26,164,106,0.03)',
  glowWarning: '0 0 12px rgba(201,132,16,0.16), inset 0 0 12px rgba(201,132,16,0.03)',
  glowError: '0 0 12px rgba(214,69,61,0.16), inset 0 0 12px rgba(214,69,61,0.03)',
};

export const ELEVATION = {
  elev1: ELEV_1,
  elev2: ELEV_2,
  elev3: ELEV_3,
} as const;
