/**
 * Company-aware LRU caches for the 2D office view. Replaces the previous
 * unbounded Map(s) so long sessions / frequent company switches don't grow
 * unboundedly. Keys are `${companyId}:${seed}` to avoid cross-company mix.
 */
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

const keyOf = (seed: string, companyId: string) => `${companyId}:${seed}`;

const uriCache = new LRUCache<string>();
const imageCache = new LRUCache<HTMLImageElement>();

/** Get a DiceBear avataaars data URI, using the LRU cache. */
export function getAvatarUri(seed: string, companyId: string): string {
  const key = keyOf(seed, companyId);
  const cached = uriCache.get(key);
  if (cached) return cached;
  const uri = createOffisimAvatar(seed, 64);
  uriCache.set(key, uri);
  return uri;
}

/**
 * Get a ready-to-draw `HTMLImageElement` for the given (seed, companyId).
 * Returns `null` while the image is still decoding; `onReady` fires once the
 * backing data URI finishes loading so callers can request a redraw.
 * Sharing one LRU for both URI and decoded `Image` prevents the cache
 * duplication the pre-refactor draw code had.
 */
export function getAvatarImage(
  seed: string,
  companyId: string,
  onReady?: () => void,
): HTMLImageElement | null {
  const key = keyOf(seed, companyId);
  const existing = imageCache.get(key);
  if (existing) return existing.complete ? existing : null;
  const img = new Image();
  img.src = getAvatarUri(seed, companyId);
  imageCache.set(key, img);
  if (img.complete) return img;
  if (onReady) img.onload = onReady;
  return null;
}

/** Reset all caches — useful for testing or on company switch. */
export function clearAvatarCache(): void {
  uriCache.clear();
  imageCache.clear();
}
