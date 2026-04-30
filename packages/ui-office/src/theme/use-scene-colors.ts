import { DARK_SCENE_3D, LIGHT_SCENE_3D } from '@offisim/ui-core/tokens';
import type { Scene3DColors } from '@offisim/ui-core/tokens';
import { useTheme } from './theme-provider.js';

export type SceneColors = Scene3DColors;

export function useSceneColors(): SceneColors {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === 'light' ? LIGHT_SCENE_3D : DARK_SCENE_3D;
}
