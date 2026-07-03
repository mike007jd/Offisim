import { reposOrNull } from '@/data/adapters.js';
import { useEffect } from 'react';
import type { DensityValue, ThemeValue } from './settings-data.js';

const RUNTIME_SETTINGS_KEY = 'settings.runtime.v1';

interface PersistedRuntimeSettings {
  theme: ThemeValue;
  density: DensityValue;
}

function isThemeValue(value: unknown): value is ThemeValue {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isDensityValue(value: unknown): value is DensityValue {
  return value === 'compact' || value === 'normal' || value === 'spacious';
}

function parsePersistedRuntimeSettings(value: string | null): PersistedRuntimeSettings | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as Partial<PersistedRuntimeSettings>;
    return {
      theme: isThemeValue(raw.theme) ? raw.theme : 'system',
      density: isDensityValue(raw.density) ? raw.density : 'normal',
    };
  } catch {
    return null;
  }
}

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

/**
 * Resolve a theme preference to the concrete `data-theme` value, mapping
 * 'system' onto the live OS color-scheme preference.
 */
function resolveTheme(theme: ThemeValue): 'light' | 'dark' {
  if (theme === 'system') return prefersDark() ? 'dark' : 'light';
  return theme;
}

/**
 * Write the resolved appearance onto `document.documentElement`. The design
 * system is light-only today, so these attributes may not yet carry visual
 * weight — but the persisted preference is genuinely applied to the document,
 * which is what the Settings hints promise.
 */
function applyAppearance(theme: ThemeValue, density: DensityValue): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', resolveTheme(theme));
  root.setAttribute('data-density', density);
}

/**
 * Load the persisted appearance preference from storage once on mount and apply
 * it to the document. Mounted at the app root so the persisted theme/density is
 * applied app-wide on load, independent of which surface is showing.
 */
export function useLoadPersistedAppearance(): void {
  useEffect(() => {
    let cancelled = false;
    let media: MediaQueryList | null = null;
    let onChange: (() => void) | null = null;
    async function load() {
      const repos = await reposOrNull();
      if (!repos?.settings || cancelled) return;
      const persisted = parsePersistedRuntimeSettings(
        await repos.settings.get(RUNTIME_SETTINGS_KEY),
      );
      if (!persisted || cancelled) return;
      applyAppearance(persisted.theme, persisted.density);
      if (
        persisted.theme === 'system' &&
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function'
      ) {
        media = window.matchMedia(SYSTEM_DARK_QUERY);
        onChange = () => applyAppearance('system', persisted.density);
        media.addEventListener('change', onChange);
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (media && onChange) media.removeEventListener('change', onChange);
    };
  }, []);
}
