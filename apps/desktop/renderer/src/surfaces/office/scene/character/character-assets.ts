import animationsUrl from '@/assets/characters/animations.glb?url';
import bodyFemaleUrl from '@/assets/characters/body_female.glb?url';
import bodyMaleUrl from '@/assets/characters/body_male.glb?url';
import brows01Url from '@/assets/characters/brows_01.glb?url';
import brows02Url from '@/assets/characters/brows_02.glb?url';
import hair01Url from '@/assets/characters/hair_01.glb?url';
import hair02Url from '@/assets/characters/hair_02.glb?url';
import hair03Url from '@/assets/characters/hair_03.glb?url';
import hair04Url from '@/assets/characters/hair_04.glb?url';
import hair05Url from '@/assets/characters/hair_05.glb?url';
import hair06Url from '@/assets/characters/hair_06.glb?url';
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
  bodyMale: bodyMaleUrl,
  bodyFemale: bodyFemaleUrl,
  animations: animationsUrl,
  props: propsUrl,
  hair: {
    hair_01: hair01Url,
    hair_02: hair02Url,
    hair_03: hair03Url,
    hair_04: hair04Url,
    hair_05: hair05Url,
    /** RESERVED: beard mesh — ships and stays addressable for a future
     *  facial-accent slot, but no HAIR_STYLE_TO_ASSET entry maps to it, so it
     *  is deliberately NOT in the preload set (see PRELOADED_URLS). */
    hair_06: hair06Url,
  },
  brows: {
    brows_01: brows01Url,
    brows_02: brows02Url,
  },
} as const;

export type HairAssetKey = keyof typeof CHARACTER_ASSET_URLS.hair;
export type BrowsAssetKey = keyof typeof CHARACTER_ASSET_URLS.brows;

/** Build-time manifest: file sizes, clip list, body metrics, skin tint references. */
export { characterManifest };

function withMeshoptDecoder(loader: Loader): void {
  (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder);
}

/**
 * The runtime-reachable asset set: everything GltfCharacter can actually load.
 * `hair_06` (beard) is excluded — it is reserved (unmapped in
 * HAIR_STYLE_TO_ASSET), so warming it would fetch dead bytes on every office
 * mount. Add it here the moment a style/accent maps to it.
 */
const PRELOADED_URLS: readonly string[] = [
  CHARACTER_ASSET_URLS.bodyMale,
  CHARACTER_ASSET_URLS.bodyFemale,
  CHARACTER_ASSET_URLS.animations,
  CHARACTER_ASSET_URLS.props,
  CHARACTER_ASSET_URLS.hair.hair_01,
  CHARACTER_ASSET_URLS.hair.hair_02,
  CHARACTER_ASSET_URLS.hair.hair_03,
  CHARACTER_ASSET_URLS.hair.hair_04,
  CHARACTER_ASSET_URLS.hair.hair_05,
  ...Object.values(CHARACTER_ASSET_URLS.brows),
];

/**
 * Suspense-cached glTF load with the meshopt decoder wired in. Equivalent to
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
