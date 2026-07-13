/**
 * Parse `git status --porcelain=v1 -z` without losing Git path bytes to
 * C-style quoting. Rename/copy records are emitted as `target\0source\0`; both
 * sides are returned because an explicit `git add -- <paths>` must stage the
 * addition and the deletion.
 */
export function parsePorcelainV1ZPaths(stdout: string): string[] {
  const fields = stdout.split('\0');
  const paths: string[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index];
    if (!record || record.length < 4) continue;

    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (path) paths.push(path);

    if (status.includes('R') || status.includes('C')) {
      const sourcePath = fields[index + 1];
      index += 1;
      if (sourcePath) paths.push(sourcePath);
    }
  }

  return [...new Set(paths)];
}
