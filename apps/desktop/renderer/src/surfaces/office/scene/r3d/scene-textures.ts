import * as THREE from 'three';

/**
 * Procedural normal-map textures (dust micro-roughness, wood grain) used by the
 * scene material presets. Cached singletons — generated once, reused everywhere.
 */

let dustNormalTexture: THREE.Texture | null = null;
let woodGrainNormalTexture: THREE.Texture | null = null;

function makeDataTexture(size: number, sample: (x: number, y: number) => number): THREE.Texture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = sample(x, y);
      const offset = (y * size + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = 255;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function hashNoise(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

export function getDustNormalTexture(): THREE.Texture {
  if (!dustNormalTexture) {
    dustNormalTexture = makeDataTexture(256, (x, y) => 118 + Math.floor(hashNoise(x, y) * 24));
  }
  return dustNormalTexture;
}

export function getWoodGrainNormalTexture(): THREE.Texture {
  if (!woodGrainNormalTexture) {
    woodGrainNormalTexture = makeDataTexture(256, (x, y) => {
      const wave = Math.sin((x / 256) * Math.PI * 18 + hashNoise(x, y) * 1.8);
      return 120 + Math.floor(wave * 18 + hashNoise(x * 3, y) * 12);
    });
  }
  return woodGrainNormalTexture;
}
