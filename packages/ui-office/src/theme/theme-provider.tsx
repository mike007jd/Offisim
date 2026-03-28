import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export type Theme = 'dark';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'dark';
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const DARK_THEME: ThemeContextValue = { theme: 'dark', resolvedTheme: 'dark' };

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={DARK_THEME}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
