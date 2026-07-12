import animationsUrl from '@/assets/characters/animations.glb?url';
import bodyToyUrl from '@/assets/characters/body_toy.glb?url';
import hair01Url from '@/assets/characters/hair_01.glb?url';
import hair02Url from '@/assets/characters/hair_02.glb?url';
import hair03Url from '@/assets/characters/hair_03.glb?url';
import hair04Url from '@/assets/characters/hair_04.glb?url';
import hair05Url from '@/assets/characters/hair_05.glb?url';
import hair06Url from '@/assets/characters/hair_06.glb?url';
import hair07Url from '@/assets/characters/hair_07.glb?url';
import hair08Url from '@/assets/characters/hair_08.glb?url';
import hair09Url from '@/assets/characters/hair_09.glb?url';
import hair10Url from '@/assets/characters/hair_10.glb?url';
import hair11Url from '@/assets/characters/hair_11.glb?url';
import hair12Url from '@/assets/characters/hair_12.glb?url';
import characterManifest from '@/assets/characters/manifest.json';
import propsUrl from '@/assets/characters/props.glb?url';
import { useLoader } from '@react-three/fiber';
import type { Loader } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Shipped character asset URLs (built by `scripts/build-character-assets.mjs`,
 * source-controlled under `src/assets/characters/`). All glbs are meshopt
 * compressed — loading goes through {@link useCharacterGltf}, which wires
 * three's locally bundled meshopt decoder (`three/examples/jsm/libs/
 * meshopt_decoder.module.js`, wasm inlined — no CDN fetch) into GLTFLoader.
 */
export const CHARACTER_ASSET_URLS = {
  bodyToy: bodyToyUrl,
  animations: animationsUrl,
  props: propsUrl,
  hair: {
    hair_01: hair01Url,
    hair_02: hair02Url,
    hair_03: hair03Url,
    hair_04: hair04Url,
    hair_05: hair05Url,
    hair_06: hair06Url,
    hair_07: hair07Url,
    hair_08: hair08Url,
    hair_09: hair09Url,
    hair_10: hair10Url,
    hair_11: hair11Url,
    hair_12: hair12Url,
  },
} as const;

/** Build-time manifest: file sizes, clip list, body metrics, skin tint references. */
export { characterManifest };

function withMeshoptDecoder(loader: Loader): void {
  (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder);
}

/**
 * The runtime-reachable asset set: everything GltfCharacter can actually load.
 * Every URL here is reachable from at least one resolved hairstyle/prop path.
 */
const PRELOADED_URLS: readonly string[] = [
  CHARACTER_ASSET_URLS.bodyToy,
  CHARACTER_ASSET_URLS.animations,
  CHARACTER_ASSET_URLS.props,
  ...Object.values(CHARACTER_ASSET_URLS.hair),
];

/**
 * Suspense-cached glTF load with the meshopt decoder enabled. Equivalent to
 * drei's `useGLTF` minus its DRACO path — drei hardcodes a `www.gstatic.com`
 * DRACO decoder URL constant that would put a CDN reference into the desktop
 * bundle; the character set is meshopt-only, so we load through fiber's
 * `useLoader` with the local decoder instead.
 */
export function useCharacterGltf(url: string) {
  return useLoader(GLTFLoader, url, withMeshoptDecoder);
}

/** Warm the loader cache for every REACHABLE character asset (office shell). */
export function preloadCharacterAssets(): void {
  useLoader.preload(GLTFLoader, [...PRELOADED_URLS], withMeshoptDecoder);
}
