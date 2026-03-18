import { Assets, Texture } from 'pixi.js';

const textureCache = new Map<string, Texture>();

/**
 * Convert an SVG string into a PixiJS Texture.
 * Caches by content hash to avoid re-creating identical textures.
 */
export async function svgToTexture(svgString: string, scale = 1): Promise<Texture> {
  const key = svgString.length + ':' + simpleHash(svgString);
  const cached = textureCache.get(key);
  if (cached && !cached.destroyed) return cached;

  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const texture = await Assets.load<Texture>({
      src: url,
      data: { resolution: scale * (globalThis.devicePixelRatio ?? 1) },
    });
    textureCache.set(key, texture);
    return texture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

export function clearTextureCache(): void {
  for (const t of textureCache.values()) {
    if (!t.destroyed) t.destroy(true);
  }
  textureCache.clear();
}
