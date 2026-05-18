import { Button } from '@offisim/ui-core';
import { useCallback, useEffect, useState } from 'react';
import {
  DEV_LIGHTING_OVERRIDE_KEYS,
  type SceneLightingTier,
  clearDevLightingOverrides,
  emitDevLightingOverrideChange,
  getDevLightingOverrides,
  getDevTierOverride,
} from './scene-performance-tier.js';

const TIERS: SceneLightingTier[] = ['high', 'medium', 'low', 'off'];
const HEMI_VALUES = [0.4, 0.6, 0.8, 1.0] as const;

function readSnapshot(): {
  tier: SceneLightingTier | null;
  overrides: ReturnType<typeof getDevLightingOverrides>;
} {
  return {
    tier: getDevTierOverride(),
    overrides: getDevLightingOverrides(),
  };
}

function setBooleanOverride(key: string, current: boolean | null): void {
  localStorage.setItem(key, String(!(current ?? true)));
  emitDevLightingOverrideChange();
}

export function DevLightingPanel() {
  if (!import.meta.env.DEV) return null;

  const [snapshot, setSnapshot] = useState(readSnapshot);
  const refresh = useCallback(() => setSnapshot(readSnapshot()), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      const key = event.key.toLowerCase();
      if (key === 'l') {
        const current = getDevTierOverride();
        const next = TIERS[(TIERS.indexOf(current ?? 'high') + 1) % TIERS.length] ?? 'high';
        localStorage.setItem(DEV_LIGHTING_OVERRIDE_KEYS.tier, next);
        emitDevLightingOverrideChange();
        refresh();
      } else if (key === 'e') {
        setBooleanOverride(DEV_LIGHTING_OVERRIDE_KEYS.env, getDevLightingOverrides().env);
        refresh();
      } else if (key === 's') {
        setBooleanOverride(DEV_LIGHTING_OVERRIDE_KEYS.shadows, getDevLightingOverrides().shadows);
        refresh();
      } else if (key === 'b') {
        const current = getDevLightingOverrides().hemi ?? 0.6;
        const next =
          HEMI_VALUES[
            (HEMI_VALUES.indexOf(current as (typeof HEMI_VALUES)[number]) + 1) % HEMI_VALUES.length
          ] ?? 0.6;
        localStorage.setItem(DEV_LIGHTING_OVERRIDE_KEYS.hemi, String(next));
        emitDevLightingOverrideChange();
        refresh();
      } else if (key === 'p') {
        setBooleanOverride(DEV_LIGHTING_OVERRIDE_KEYS.post, getDevLightingOverrides().post);
        refresh();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('offisim.scene.devOverride.change', refresh);
    window.addEventListener('offisim.scene.devOverride.reset', refresh);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('offisim.scene.devOverride.change', refresh);
      window.removeEventListener('offisim.scene.devOverride.reset', refresh);
    };
  }, [refresh]);

  const { tier, overrides } = snapshot;
  return (
    <div className="fixed right-3 top-3 z-top rounded bg-black/70 px-2 py-1 font-mono text-xs text-amber-300">
      DEV: tier={tier ?? 'auto'} · hemi={overrides.hemi ?? 'auto'} · env=
      {overrides.env == null ? 'auto' : overrides.env ? 'on' : 'off'} · shadows=
      {overrides.shadows == null ? 'auto' : overrides.shadows ? 'on' : 'off'} · post=
      {overrides.post == null ? 'auto' : overrides.post ? 'on' : 'off'} ·{' '}
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-warning underline-offset-2"
        onClick={() => {
          clearDevLightingOverrides();
          refresh();
        }}
      >
        Reset
      </Button>
    </div>
  );
}
