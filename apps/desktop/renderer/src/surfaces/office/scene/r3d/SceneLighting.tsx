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
        args={[SCENE_LIGHTING_COLORS.hemisphereSky, SCENE_LIGHTING_COLORS.hemisphereGround, 0.32]}
        intensity={0.28}
      />
      <directionalLight
        castShadow
        position={[10, 20, 12]}
        intensity={1.12}
        color={SCENE_LIGHTING_COLORS.key}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.026}
        shadow-radius={4.2}
        shadow-camera-near={0.5}
        shadow-camera-far={80}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
      />
      <directionalLight
        position={[-15, 12, -10]}
        intensity={0.2}
        color={SCENE_LIGHTING_COLORS.sideFill}
      />
      <directionalLight position={[5, 8, -18]} intensity={0.16} color={SCENE_LIGHTING_COLORS.rim} />
      <spotLight
        position={[0, 6, 14]}
        angle={0.45}
        penumbra={0.6}
        intensity={0.14}
        color={SCENE_LIGHTING_COLORS.bounceFront}
        decay={1.5}
      />
      <spotLight
        position={[0, 6, -14]}
        angle={0.4}
        penumbra={0.7}
        intensity={0.1}
        color={SCENE_LIGHTING_COLORS.bounceBack}
        decay={1.5}
      />
      <ambientLight intensity={0.045} />
      <fog attach="fog" args={[sc.sceneBackground, 60, 180]} />
    </>
  );
}
