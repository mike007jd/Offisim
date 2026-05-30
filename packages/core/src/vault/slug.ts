/**
 * Turn an employee id into a filesystem-safe slug for its vault directory.
 *
 * The slug is derived ONLY from the immutable `employee_id` — never the display
 * name. This is deliberate:
 *   - Collision-free: two employees that share a display name (e.g. two "Alex
 *     Chen") get distinct directories, so neither clobbers the other's vault.
 *   - Rename-stable: the directory never moves when an employee is renamed.
 *     Stability is load-bearing because employee-scope skill directories live
 *     under this path and persist their absolute `vault_path` in the DB at
 *     install time (read back verbatim, not recomputed). A name-derived slug
 *     would change on rename and orphan those skills / split the directory —
 *     exactly the silent data loss this slug scheme exists to prevent.
 *
 * The employee's display name still lives inside `employee.md`, so the vault
 * stays human-navigable without encoding the (mutable) name in the path.
 */
export function employeeSlug(employeeId: string): string {
  const idTail = employeeId.replace(/^e[-_]?/u, '').slice(0, 12) || employeeId.slice(0, 12);
  const safe = idTail
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return `employee-${safe || 'unknown'}`;
}
