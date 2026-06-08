import { Environment, Lightformer } from '@react-three/drei';
import { SCENE_ENV_COLORS } from './scene-colors.js';

/**
 * Self-contained indoor studio environment map. Built entirely from
 * `<Lightformer>` emitters (no HDRI fetch) so it works offline inside the
 * Tauri/WKWebView release shell. `background={false}` keeps the clean light
 * scene background; the env is consumed only as reflections/IBL.
 *
 * Why this matters: every material preset in `scene-materials.tsx` tunes
 * `metalness` / `clearcoat` / `transmission` / `envMapIntensity`, but those
 * are no-ops without an environment to sample. metal-chrome (metalness 1,
 * roughness 0.06) renders near-black with no env. This rig is what makes the
 * brushed metal, glass partitions, ceramic mugs and server chassis read as
 * real surfaces instead of flat plastic.
 *
 * `frames={1}` bakes the cubemap once (static rig) — cheap, no per-frame cost.
 */
export function SceneEnvironment() {
  return (
    <Environment resolution={256} frames={1} background={false}>
      {/* Soft overhead ceiling panel — the dominant studio key from above. */}
      <Lightformer
        form="rect"
        intensity={1.5}
        color={SCENE_ENV_COLORS.ceiling}
        position={[0, 14, 2]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[28, 28, 1]}
      />
      {/* Cool side fills — give brushed metal and glass a directional sheen. */}
      <Lightformer
        form="rect"
        intensity={0.9}
        color={SCENE_ENV_COLORS.sideFill}
        position={[-16, 7, 4]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[18, 10, 1]}
      />
      <Lightformer
        form="rect"
        intensity={0.9}
        color={SCENE_ENV_COLORS.sideFill}
        position={[16, 7, 4]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={[18, 10, 1]}
      />
      {/* Warm front bounce — catches chrome casters and ceramic highlights. */}
      <Lightformer
        form="rect"
        intensity={0.7}
        color={SCENE_ENV_COLORS.frontBounce}
        position={[0, 5, 20]}
        rotation={[0, Math.PI, 0]}
        scale={[20, 8, 1]}
      />
      {/* Back rim strip — separates server racks / bookshelves from the wall. */}
      <Lightformer
        form="rect"
        intensity={0.5}
        color={SCENE_ENV_COLORS.backRim}
        position={[0, 6, -20]}
        scale={[22, 8, 1]}
      />
      {/* Two crisp ceiling streaks for elongated reflections on glossy tops. */}
      <Lightformer
        form="rect"
        intensity={1.1}
        color={SCENE_ENV_COLORS.streak}
        position={[-6, 13, 6]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[1.6, 16, 1]}
      />
      <Lightformer
        form="rect"
        intensity={1.1}
        color={SCENE_ENV_COLORS.streak}
        position={[6, 13, -4]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[1.6, 16, 1]}
      />
    </Environment>
  );
}
