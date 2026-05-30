/**
 * Re-insert `key` as the most-recently-used entry of an insertion-ordered Map,
 * then evict the least-recently-used entries until the map is within `cap`.
 *
 * Relies on Map preserving insertion order: deleting then re-setting moves a key
 * to the newest position, and `keys().next().value` is always the oldest. Use
 * for bounded per-thread/per-entry caches whose eviction is a plain delete; NOT
 * for caches whose eviction has side effects (e.g. unlinking a backing file),
 * which need their own evict step.
 */
export function touchLru<K, V>(map: Map<K, V>, key: K, value: V, cap: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > cap) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
