import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
export type Density = 'compact' | 'normal' | 'spacious';

export const THEME_STORAGE_KEY = 'offisim.theme';
const DENSITY_STORAGE_KEY = 'offisim.density';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  density: Density;
  setTheme: (theme: Theme) => void;
  setDensity: (density: Density) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredDensity(): Density {
  if (typeof window === 'undefined') return 'normal';
  try {
    const stored = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    return stored === 'compact' || stored === 'spacious' ? stored : 'normal';
  } catch {
    return 'normal';
  }
}

export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(readStoredTheme()),
  );
  const [density, setDensity] = useState<Density>(() => readStoredDensity());

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
    setResolvedTheme(resolveTheme(nextTheme));
    if (typeof window === 'undefined') return;
    try {
      if (nextTheme === 'system') {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      }
    } catch {
      // Ignore storage failures; the in-memory theme still applies.
    }
  }, []);

  useEffect(() => {
    if (theme !== 'system') {
      setResolvedTheme(resolveTheme(theme));
      return;
    }
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      setResolvedTheme('dark');
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      setResolvedTheme(media.matches ? 'dark' : 'light');
    };
    handleChange();
    media.addEventListener?.('change', handleChange);
    return () => {
      media.removeEventListener?.('change', handleChange);
    };
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.classList.toggle('light', resolvedTheme === 'light');
    // Notify modules that cache theme-derived values (e.g. `studio-style-helpers`).
    window.dispatchEvent(new CustomEvent('offisim.theme.change', { detail: resolvedTheme }));
  }, [resolvedTheme]);

  useEffect(() => {
    const root = document.documentElement;
    if (density === 'normal') {
      root.removeAttribute('data-density');
      try {
        window.localStorage.removeItem(DENSITY_STORAGE_KEY);
      } catch {
        // Ignore storage failures; density still applies for this session.
      }
    } else {
      root.setAttribute('data-density', density);
      try {
        window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
      } catch {
        // Ignore storage failures; density still applies for this session.
      }
    }
    // Notify modules that cache CSS-variable-derived spacing values (e.g.
    // `studio-style-helpers` SP cache) so they refresh on the next read.
    window.dispatchEvent(new CustomEvent('offisim.density.change', { detail: density }));
  }, [density]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, density, setTheme, setDensity }),
    [theme, resolvedTheme, density, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
