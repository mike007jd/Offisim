import * as THREE from 'three';
import type { Scene3DColors } from './scene-colors.js';

const textureCache = new Map<string, THREE.Texture>();

function cacheKey(sc: Scene3DColors): string {
  return [sc.ledCyan, sc.leafPrimary, sc.ledBlue, sc.furnitureLight].join('|');
}

export function buildServerRackBakedTexture(sc: Scene3DColors): THREE.Texture {
  const key = cacheKey(sc);
  const cached = textureCache.get(key);
  if (cached) return cached;

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(128, 256)
      : document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallback = new THREE.Texture();
    textureCache.set(key, fallback);
    return fallback;
  }

  ctx.clearRect(0, 0, 128, 256);
  ctx.fillStyle = sc.furnitureLight;
  for (let row = 0; row < 4; row += 1) {
    const y = 30 + row * 58;
    for (let vent = 0; vent < 6; vent += 1) {
      ctx.fillRect(17 + vent * 16, y, 10, 4);
    }
  }

  const ledPalette = [sc.ledCyan, sc.leafPrimary, sc.ledBlue];
  for (let row = 0; row < 10; row += 1) {
    const y = 18 + row * 23;
    for (let led = 0; led < 5; led += 1) {
      ctx.beginPath();
      ctx.fillStyle = ledPalette[(row + led) % ledPalette.length] ?? sc.ledCyan;
      ctx.arc(28 + led * 18, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}
