/**
 * Company-aware LRU avatar cache for the 2D office view.
 * Replaces the previous unbounded Map to prevent memory growth
 * when switching companies or accumulating many unique seeds.
 */
import { avataaars } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import { outfitColorFromSeed } from '../../lib/avatar-seed';

const MAX_CACHE_SIZE = 100;

/**
 * Simple LRU cache using Map insertion order.
 * Key format: `${companyId}:${seed}` — avoids cross-company semantic mix.
 */
class AvatarLRUCache {
  private cache = new Map<string, string>();

  private makeKey(seed: string, companyId: string): string {
    return `${companyId}:${seed}`;
  }

  get(seed: string, companyId: string): string | undefined {
    const key = this.makeKey(seed, companyId);
    const val = this.cache.get(key);
    if (val === undefined) return undefined;
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }

  set(seed: string, companyId: string, value: string): void {
    const key = this.makeKey(seed, companyId);
    this.cache.delete(key);
    this.cache.set(key, value);
    // Evict oldest if over limit
    if (this.cache.size > MAX_CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

const cache = new AvatarLRUCache();

/** Get a DiceBear avataaars data URI, using the LRU cache. */
export function getAvatarUri(seed: string, companyId: string): string {
  const cached = cache.get(seed, companyId);
  if (cached) return cached;
  const uri = createAvatar(avataaars, {
    seed,
    size: 64,
    clothesColor: [outfitColorFromSeed(seed).slice(1)],
  }).toDataUri();
  cache.set(seed, companyId, uri);
  return uri;
}

/** Reset the cache — useful for testing. */
export function clearAvatarCache(): void {
  cache.clear();
}
