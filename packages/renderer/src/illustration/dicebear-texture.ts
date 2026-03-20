import { svgToTexture } from './svg-to-texture';
import type { Texture } from 'pixi.js';

/**
 * Generate a Dicebear avatar SVG and convert it to a PixiJS texture.
 * Uses dynamic import to keep @dicebear out of the initial renderer bundle.
 */
export async function dicebearToTexture(seed: string, scale = 2): Promise<Texture> {
  const [{ createAvatar }, { avataaars }] = await Promise.all([
    import('@dicebear/core'),
    import('@dicebear/collection'),
  ]);

  const avatar = createAvatar(avataaars, { seed, size: 128 });
  const svgString = avatar.toString();
  return svgToTexture(svgString, scale);
}
