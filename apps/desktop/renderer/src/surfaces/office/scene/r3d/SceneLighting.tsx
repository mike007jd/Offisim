import { SCENE_LIGHTING_COLORS } from './scene-colors.js';
import { useSceneColors } from './use-scene-colors.js';

export const SCENE_KEY_LIGHT = {
  position: [10, 20, 12] as [number, number, number],
  shadow: {
    mapSize: [2048, 2048] as [number, number],
    bias: -0.00015,
    normalBias: 0.018,
    radius: 3.6,
    near: 0.5,
    far: 56,
    left: -32,
    right: 32,
    top: 28,
    bottom: -26,
  },
} as const;

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
        position={SCENE_KEY_LIGHT.position}
        intensity={1.2}
        color={SCENE_LIGHTING_COLORS.key}
        shadow-mapSize={SCENE_KEY_LIGHT.shadow.mapSize}
        shadow-bias={SCENE_KEY_LIGHT.shadow.bias}
        shadow-normalBias={SCENE_KEY_LIGHT.shadow.normalBias}
        shadow-radius={SCENE_KEY_LIGHT.shadow.radius}
        shadow-camera-near={SCENE_KEY_LIGHT.shadow.near}
        shadow-camera-far={SCENE_KEY_LIGHT.shadow.far}
        shadow-camera-left={SCENE_KEY_LIGHT.shadow.left}
        shadow-camera-right={SCENE_KEY_LIGHT.shadow.right}
        shadow-camera-top={SCENE_KEY_LIGHT.shadow.top}
        shadow-camera-bottom={SCENE_KEY_LIGHT.shadow.bottom}
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
