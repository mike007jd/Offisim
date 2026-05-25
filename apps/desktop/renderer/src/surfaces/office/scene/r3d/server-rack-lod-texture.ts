import * as THREE from 'three';
import type { Scene3DColors } from './scene-colors.js';

const textureCache = new Map<string, THREE.Texture>();

function cacheKey(sc: Scene3DColors): string {
  return [sc.ledCyan, sc.leafPrimary, sc.ledBlue, sc.furnitureLight, sc.serverBody].join('|');
}

export function buildServerRackBakedTexture(sc: Scene3DColors): THREE.Texture {
  const key = cacheKey(sc);
  const cached = textureCache.get(key);
  if (cached) return cached;

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(256, 128)
      : document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallback = new THREE.Texture();
    textureCache.set(key, fallback);
    return fallback;
  }

  ctx.fillStyle = sc.serverBody;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = sc.furnitureLight;
  for (let row = 0; row < 3; row += 1) {
    const y = 18 + row * 32;
    for (let vent = 0; vent < 6; vent += 1) {
      ctx.fillRect(36 + vent * 28, y, 16, 4);
    }
  }

  const ledPalette = [sc.ledCyan, sc.leafPrimary, sc.ledBlue];
  for (let row = 0; row < 8; row += 1) {
    const y = 16 + row * 13;
    for (let led = 0; led < 5; led += 1) {
      ctx.beginPath();
      ctx.fillStyle = ledPalette[(row + led) % ledPalette.length] ?? sc.ledCyan;
      ctx.arc(72 + led * 28, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}
