import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ThemeProvider } from '../theme/index';
import { useSceneColors } from '../theme/use-scene-colors';

function Wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe('useSceneColors', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark', 'light');
  });

  it('returns color strings keyed by semantic name', () => {
    const { result } = renderHook(() => useSceneColors(), { wrapper: Wrapper });
    expect(result.current.desk).toBeTruthy();
    expect(result.current.floor).toBeTruthy();
    expect(result.current.furniture).toBeTruthy();
    expect(result.current.screen).toBeTruthy();
  });

  it('all colors are valid hex strings', () => {
    const { result } = renderHook(() => useSceneColors(), { wrapper: Wrapper });
    const hexRegex = /^#[0-9a-fA-F]{6}$/;
    for (const val of Object.values(result.current)) {
      expect(val).toMatch(hexRegex);
    }
  });

  it('ignores legacy stored light preference and still returns the dark palette', () => {
    const defaultRender = renderHook(() => useSceneColors(), { wrapper: Wrapper });
    const defaultDesk = defaultRender.result.current.desk;

    localStorage.setItem('offisim-theme', 'light');
    const storedLightRender = renderHook(() => useSceneColors(), { wrapper: Wrapper });

    expect(storedLightRender.result.current.desk).toBe(defaultDesk);
  });
});
