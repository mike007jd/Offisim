export function toRecordRows(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    : [];
}

export function countDuplicateRowsByKey(
  rows: readonly Record<string, unknown>[],
  key: string,
): number {
  const seen = new Set<unknown>();
  let duplicates = 0;
  for (const row of rows) {
    const value = row[key];
    if (!value) continue;
    if (seen.has(value)) {
      duplicates++;
      continue;
    }
    seen.add(value);
  }
  return duplicates;
}
