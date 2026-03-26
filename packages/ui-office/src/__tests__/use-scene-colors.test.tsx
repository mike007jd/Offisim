import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ThemeProvider, useTheme } from '../theme/index';
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

  it('returns different desk color for light vs dark', () => {
    function useTestHook() {
      const theme = useTheme();
      const colors = useSceneColors();
      return { theme, colors };
    }

    const { result } = renderHook(() => useTestHook(), { wrapper: Wrapper });

    act(() => result.current.theme.setTheme('dark'));
    const darkDesk = result.current.colors.desk;

    act(() => result.current.theme.setTheme('light'));
    const lightDesk = result.current.colors.desk;

    expect(darkDesk).not.toBe(lightDesk);
  });
});
