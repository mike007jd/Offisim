import { SCENE_LIGHTING_COLORS } from './scene-colors.js';
import { useSceneColors } from './use-scene-colors.js';

/**
 * Daylight rig ported from the legacy `scene-lighting-rig` (light-theme values):
 * warm hemisphere ambient + key directional with soft shadows + cool side-fill +
 * rim + two soft bounce spotlights + distance fog. Runtime tier/agent coupling
 * dropped — this renders a static, well-lit diorama.
 */

export function SceneLighting() {
  const sc = useSceneColors();
  return (
    <>
      <hemisphereLight
        args={[
          SCENE_LIGHTING_COLORS.hemisphereSky,
          SCENE_LIGHTING_COLORS.hemisphereGround,
          0.42,
        ]}
        intensity={0.42}
      />
      <directionalLight
        castShadow
        position={[12, 25, 12]}
        intensity={1.35}
        color={SCENE_LIGHTING_COLORS.key}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00035}
        shadow-normalBias={0.02}
        shadow-radius={4}
        shadow-camera-near={0.5}
        shadow-camera-far={80}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      <directionalLight
        position={[-15, 12, -10]}
        intensity={0.24}
        color={SCENE_LIGHTING_COLORS.sideFill}
      />
      <directionalLight
        position={[5, 8, -18]}
        intensity={0.18}
        color={SCENE_LIGHTING_COLORS.rim}
      />
      <spotLight
        position={[0, 6, 14]}
        angle={0.45}
        penumbra={0.6}
        intensity={0.18}
        color={SCENE_LIGHTING_COLORS.bounceFront}
        decay={1.5}
      />
      <spotLight
        position={[0, 6, -14]}
        angle={0.4}
        penumbra={0.7}
        intensity={0.12}
        color={SCENE_LIGHTING_COLORS.bounceBack}
        decay={1.5}
      />
      <ambientLight intensity={0.2} />
      <fog attach="fog" args={[sc.sceneBackground, 48, 160]} />
    </>
  );
}
