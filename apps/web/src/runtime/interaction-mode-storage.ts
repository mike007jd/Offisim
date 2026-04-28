import { DEFAULT_INTERACTION_MODE, type InteractionMode } from '@offisim/shared-types';

const INTERACTION_MODE_KEY = 'offisim.interaction-mode.default';

export function loadDefaultInteractionMode(): InteractionMode {
  if (typeof window === 'undefined') return DEFAULT_INTERACTION_MODE;
  const raw = window.localStorage.getItem(INTERACTION_MODE_KEY);
  if (
    raw === 'boss_proxy' ||
    raw === 'human_in_loop' ||
    raw === 'direct_to_employee' ||
    raw === 'yolo'
  ) {
    return raw;
  }
  return DEFAULT_INTERACTION_MODE;
}

export function persistDefaultInteractionMode(mode: InteractionMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(INTERACTION_MODE_KEY, mode);
}
