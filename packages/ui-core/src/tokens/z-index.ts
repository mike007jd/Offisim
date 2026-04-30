export type ZIndexLayer = 'base' | 'elevated' | 'sticky' | 'dropdown' | 'modal' | 'top';

export const Z_INDEX_SCALE: Record<ZIndexLayer, number> = {
  base: 0,
  elevated: 10,
  sticky: 20,
  dropdown: 50,
  modal: 100,
  top: 200,
};
