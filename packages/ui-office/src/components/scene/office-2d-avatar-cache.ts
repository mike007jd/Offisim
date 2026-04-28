/**
 * Company-aware LRU image caches. Keys discriminate internal (DiceBear,
 * seed-based) vs external (brand-based) avatars so the same seed collision
 * between an internal and external employee never cross-contaminates the
 * decoded image.
 */
import type { EmployeeAppearance } from '@offisim/shared-types';
import { createOffisimAvatar } from '../../lib/avatar-seed';
import { lookupExternalBrand } from '../../lib/brand-registry';

const MAX_CACHE_SIZE = 100;

class LRUCache<V> {
  private cache = new Map<string, V>();

  get(key: string): V | undefined {
    const val = this.cache.get(key);
    if (val === undefined) return undefined;
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }

  set(key: string, value: V): void {
    this.cache.delete(key);
    this.cache.set(key, value);
    if (this.cache.size > MAX_CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

function appearanceFingerprint(appearance?: EmployeeAppearance | null): string {
  if (!appearance) return 'none';
  return `${appearance.skinColor}-${appearance.hairColor}-${appearance.clothingColor}-${appearance.hairStyle}`;
}

const dicebearKey = (seed: string, companyId: string, appearance?: EmployeeAppearance | null) =>
  `${companyId}:dicebear:${seed}:${appearanceFingerprint(appearance)}`;
const brandCacheKey = (brandKey: string, companyId: string) => `${companyId}:brand:${brandKey}`;

const uriCache = new LRUCache<string>();
const imageCache = new LRUCache<HTMLImageElement>();

function loadCachedImage(
  cacheKey: string,
  src: () => string,
  onReady?: () => void,
): HTMLImageElement | null {
  const existing = imageCache.get(cacheKey);
  if (existing) return existing.complete ? existing : null;
  const img = new Image();
  img.src = src();
  imageCache.set(cacheKey, img);
  if (img.complete) return img;
  if (onReady) img.onload = onReady;
  return null;
}

/** Get a DiceBear avataaars data URI, using the LRU cache. */
export function getAvatarUri(
  seed: string,
  companyId: string,
  appearance?: EmployeeAppearance | null,
): string {
  const key = dicebearKey(seed, companyId, appearance);
  const cached = uriCache.get(key);
  if (cached) return cached;
  const uri = createOffisimAvatar(seed, 64, appearance ?? undefined);
  uriCache.set(key, uri);
  return uri;
}

/**
 * Get a ready-to-draw `HTMLImageElement` for (seed, companyId, appearance).
 * Returns `null` while the image is decoding; `onReady` fires once the URI
 * decodes so callers can request a redraw.
 */
export function getAvatarImage(
  seed: string,
  companyId: string,
  appearance: EmployeeAppearance | null | undefined,
  onReady?: () => void,
): HTMLImageElement | null {
  return loadCachedImage(
    dicebearKey(seed, companyId, appearance),
    () => getAvatarUri(seed, companyId, appearance),
    onReady,
  );
}

/**
 * External employees' counterpart of {@link getAvatarImage}. Internal
 * employees must continue to go through `getAvatarImage` — this path has no
 * seed-based fallback.
 */
export function getBrandAvatarImage(
  brandKey: string | null,
  companyId: string,
  onReady?: () => void,
): HTMLImageElement | null {
  const entry = lookupExternalBrand(brandKey);
  return loadCachedImage(brandCacheKey(entry.brandKey, companyId), () => entry.asset2dUri, onReady);
}

/** Reset all caches — useful for testing or on company switch. */
export function clearAvatarCache(): void {
  uriCache.clear();
  imageCache.clear();
}
