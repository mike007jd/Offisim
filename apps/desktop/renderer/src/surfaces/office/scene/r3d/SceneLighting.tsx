import { SCENE_LIGHTING_COLORS } from './scene-colors.js';
import { useSceneColors } from './use-scene-colors.js';

/**
 * Open-plinth daylight rig: broad warm key, cool fill, restrained rim and two
 * low-energy bounces. The fog begins beyond the platform edge, softening the
 * studio backdrop without washing contrast out of the toy furniture.
 */

export function SceneLighting() {
  const sc = useSceneColors();
  return (
    <>
      <hemisphereLight
        args={[SCENE_LIGHTING_COLORS.hemisphereSky, SCENE_LIGHTING_COLORS.hemisphereGround, 0.32]}
        intensity={0.38}
      />
      <directionalLight
        castShadow
        position={[10, 20, 12]}
        intensity={1.2}
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
        intensity={0.24}
        color={SCENE_LIGHTING_COLORS.sideFill}
      />
      <directionalLight position={[5, 9, -18]} intensity={0.2} color={SCENE_LIGHTING_COLORS.rim} />
      <spotLight
        position={[0, 6, 14]}
        angle={0.45}
        penumbra={0.6}
        intensity={0.12}
        color={SCENE_LIGHTING_COLORS.bounceFront}
        decay={1.5}
      />
      <spotLight
        position={[0, 6, -14]}
        angle={0.4}
        penumbra={0.7}
        intensity={0.08}
        color={SCENE_LIGHTING_COLORS.bounceBack}
        decay={1.5}
      />
      <ambientLight intensity={0.06} />
      <fog attach="fog" args={[sc.sceneBackground, 46, 118]} />
    </>
  );
}
