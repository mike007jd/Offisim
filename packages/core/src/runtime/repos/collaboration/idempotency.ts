/**
 * Collaboration message metadata helpers.
 *
 * The idempotency key is a DEDICATED column (`collaboration_messages.
 * idempotency_key`) deduped by a partial-unique index, NOT a metadata field, so
 * a concurrent double-send fails at the DB layer rather than racing two reads.
 *
 * `metadata_json` carries the sender SNAPSHOT (e.g. a display label) so a
 * message stays attributable after the sender employee is deleted (FK SET NULL).
 */

/**
 * Build the metadata object persisted on append: the author snapshot merged over
 * caller-provided metadata. Returns null when there is nothing to store.
 */
export function buildCollaborationMessageMetadata(input: {
  senderLabel?: string | null;
  metadata?: Record<string, unknown>;
}): string | null {
  const merged: Record<string, unknown> = { ...(input.metadata ?? {}) };
  if (input.senderLabel != null) merged.senderLabel = input.senderLabel;
  if (Object.keys(merged).length === 0) return null;
  return JSON.stringify(merged);
}

/**
 * Read a labelled value out of a (possibly malformed) metadata JSON string.
 * Tolerates malformed JSON by returning null — malformed metadata must never
 * break core reads.
 */
export function readMetadataString(metadataJson: string | null, key: string): string | null {
  if (!metadataJson) return null;
  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
    const value = parsed[key];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** Convenience reader for the persisted sender label snapshot. */
export function readSenderLabel(metadataJson: string | null): string | null {
  return readMetadataString(metadataJson, 'senderLabel');
}
