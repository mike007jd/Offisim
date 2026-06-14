import type { CacheRetention } from "../types.js";

/**
 * Defaults to "short" and keeps PI_CACHE_RETENTION for backward-compatible
 * local debugging. Product runtime should pass explicit cacheRetention.
 */
export function resolveCacheRetention(cacheRetention?: CacheRetention): CacheRetention {
	if (cacheRetention) {
		return cacheRetention;
	}
	if (typeof process !== "undefined" && process.env.PI_CACHE_RETENTION === "long") {
		return "long";
	}
	return "short";
}
