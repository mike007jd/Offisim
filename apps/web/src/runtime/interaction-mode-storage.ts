import type { InteractionMode } from '@offisim/shared-types';

const INTERACTION_MODE_KEY = 'offisim.interaction-mode.default';

export function loadDefaultInteractionMode(): InteractionMode {
  if (typeof window === 'undefined') return 'boss_proxy';
  const raw = window.localStorage.getItem(INTERACTION_MODE_KEY);
  return raw === 'human_in_loop' ? 'human_in_loop' : 'boss_proxy';
}

export function persistDefaultInteractionMode(mode: InteractionMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(INTERACTION_MODE_KEY, mode);
}
