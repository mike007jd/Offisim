/**
 * Turn an employee name + id into a filesystem-safe slug. Uses the name when
 * possible so the folder is human-recognisable; falls back to a prefix of
 * the employee id for purely non-ASCII names.
 */
export function employeeSlug(name: string, employeeId: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

  if (base.length >= 2) {
    return base;
  }
  const idTail = employeeId.replace(/^e[-_]?/u, '').slice(0, 8) || employeeId.slice(0, 8);
  return `employee-${idTail.toLowerCase()}`;
}
