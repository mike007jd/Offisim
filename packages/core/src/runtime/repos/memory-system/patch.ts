import type { MemoryEntryRow, MemoryUpdatePatch } from '../../repositories.js';

/**
 * Stable normalization for memory dedupe keys. Lowercases, NFKC-normalizes,
 * collapses punctuation/whitespace. Used at create time (entry.dedupe_key ??
 * normalize(entry.content)) AND at update time (recompute when content
 * changes) so findByDedupeKey lookups against current content always hit
 * the same row.
 */
export function normalizeMemoryDedupeKey(content: string): string {
  const normalized = content.normalize('NFKC').toLowerCase();
  const simplified = normalized
    .replace(/[.,:;/，。：；、]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return simplified || normalized.replace(/\s+/g, ' ').trim();
}

export type MemoryUpdateColumns = Partial<
  Pick<MemoryEntryRow, 'content' | 'importance' | 'dedupe_key'>
>;

/**
 * Translate a MemoryUpdatePatch into the columns to persist. Returns `{}`
 * when the patch is a no-op. dedupe_key is recomputed alongside any content
 * change — the invariant `row.dedupe_key === normalize(row.content)` is
 * what later findByDedupeKey lookups depend on; skipping the recompute
 * orphans the row and lets a duplicate insert through.
 */
export function buildMemoryUpdatePatch(patch: MemoryUpdatePatch): MemoryUpdateColumns {
  const updates: MemoryUpdateColumns = {};
  if (patch.content !== undefined) {
    updates.content = patch.content;
    updates.dedupe_key = normalizeMemoryDedupeKey(patch.content);
  }
  if (patch.importance !== undefined) updates.importance = patch.importance;
  return updates;
}
