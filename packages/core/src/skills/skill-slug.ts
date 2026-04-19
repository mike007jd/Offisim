/**
 * Filesystem-safe slug for a skill. Mirrors `employeeSlug` byte-for-byte:
 * uses the name when possible (human-recognisable), falls back to
 * `skill-{id前8字符}` for purely non-ASCII names.
 */
export function skillSlug(name: string, skillId: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

  if (base.length >= 2) {
    return base;
  }
  const idTail = skillId.replace(/^s[-_]?/u, '').slice(0, 8) || skillId.slice(0, 8);
  return `skill-${idTail.toLowerCase()}`;
}
