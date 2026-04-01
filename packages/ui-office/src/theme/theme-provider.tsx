import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { invalidateSpCache } from '../components/studio/studio-tokens.js';

export type Theme = 'dark';
export type Density = 'compact' | 'normal' | 'spacious';

const DENSITY_STORAGE_KEY = 'offisim.density';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'dark';
  density: Density;
  setDensity: (density: Density) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredDensity(): Density {
  if (typeof window === 'undefined') return 'normal';
  const stored = window.localStorage.getItem(DENSITY_STORAGE_KEY);
  return stored === 'compact' || stored === 'spacious' ? stored : 'normal';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [density, setDensity] = useState<Density>(() => readStoredDensity());

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('dark');
    root.classList.remove('light');
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (density === 'normal') {
      root.removeAttribute('data-density');
      window.localStorage.removeItem(DENSITY_STORAGE_KEY);
      invalidateSpCache();
      return;
    }
    root.setAttribute('data-density', density);
    window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
    invalidateSpCache();
  }, [density]);

  return (
    <ThemeContext.Provider value={{ theme: 'dark', resolvedTheme: 'dark', density, setDensity }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
