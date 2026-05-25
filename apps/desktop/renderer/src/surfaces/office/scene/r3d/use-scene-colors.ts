import { LIGHT_SCENE_3D, type Scene3DColors } from './scene-colors.js';

export type SceneColors = Scene3DColors;

/** Light-only scene palette (the renderer has no dark theme). */
export function useSceneColors(): SceneColors {
  return LIGHT_SCENE_3D;
}
