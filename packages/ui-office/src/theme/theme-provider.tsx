import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';

export type Theme = 'dark';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'dark';
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const DARK_THEME: ThemeContextValue = { theme: 'dark', resolvedTheme: 'dark' };

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('dark');
    root.classList.remove('light');
  }, []);

  return <ThemeContext.Provider value={DARK_THEME}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
