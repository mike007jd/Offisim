/**
 * Company-aware LRU image caches. Keys discriminate internal (DiceBear,
 * seed-based) vs external (brand-based) avatars so the same seed collision
 * between an internal and external employee never cross-contaminates the
 * decoded image.
 */
import { lookupExternalBrand } from '../../lib/brand-registry';
import { createOffisimAvatar } from '../../lib/avatar-seed';

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

const dicebearKey = (seed: string, companyId: string) => `${companyId}:dicebear:${seed}`;
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
export function getAvatarUri(seed: string, companyId: string): string {
  const key = dicebearKey(seed, companyId);
  const cached = uriCache.get(key);
  if (cached) return cached;
  const uri = createOffisimAvatar(seed, 64);
  uriCache.set(key, uri);
  return uri;
}

/**
 * Get a ready-to-draw `HTMLImageElement` for (seed, companyId). Returns
 * `null` while the image is decoding; `onReady` fires once the URI decodes
 * so callers can request a redraw.
 */
export function getAvatarImage(
  seed: string,
  companyId: string,
  onReady?: () => void,
): HTMLImageElement | null {
  return loadCachedImage(dicebearKey(seed, companyId), () => getAvatarUri(seed, companyId), onReady);
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
