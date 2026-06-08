import { Bloom, EffectComposer, N8AO, SMAA, Vignette } from '@react-three/postprocessing';
import { HalfFloatType } from 'three';

/**
 * Post-processing stack for the office diorama. This is the second half of the
 * fidelity story (the first is the env map in `SceneEnvironment`):
 *
 * - N8AO  — screen-space ambient occlusion. Darkens contact creases (furniture
 *           meeting the floor, books in shelves, racks against the wall) so the
 *           scene reads as solid objects in a space, not floating props.
 * - Bloom — luminance-thresholded glow. The emissive screens / LEDs / server
 *           lights render raw HDR (`toneMapped={false}`, intensity > 1) so only
 *           they cross the threshold and bloom; matte surfaces stay crisp. This
 *           is what `scene-materials.tsx` was already designed for.
 * - SMAA  — edge antialiasing (composer runs with multisampling off so N8AO is
 *           artifact-free; SMAA recovers clean silhouettes).
 * - Vignette — a restrained corner falloff to seat the diorama on the page.
 *
 * `multisampling={0}` is intentional — N8AO wants a non-MSAA depth target.
 * `frameBufferType={HalfFloatType}` keeps the chain in HDR so the raw-HDR
 * emissives (`toneMapped={false}`, intensity > 1) survive to the Bloom pass
 * instead of clamping at 1.0.
 */
export function ScenePostFx() {
  return (
    <EffectComposer multisampling={0} frameBufferType={HalfFloatType}>
      <N8AO
        aoRadius={1.4}
        distanceFalloff={1}
        intensity={2.1}
        quality="medium"
        halfRes={false}
      />
      <Bloom
        luminanceThreshold={1}
        luminanceSmoothing={0.03}
        intensity={0.5}
        radius={0.7}
        mipmapBlur
      />
      <SMAA />
      <Vignette offset={0.32} darkness={0.5} />
    </EffectComposer>
  );
}
