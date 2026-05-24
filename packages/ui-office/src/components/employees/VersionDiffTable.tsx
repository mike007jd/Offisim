import type { VersionDiff } from '@offisim/core/browser';

interface VersionDiffTableProps {
  diffs: VersionDiff[];
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '(empty)';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function diffTone(from: unknown, to: unknown): string {
  if (from === undefined || from === null) return 'added';
  if (to === undefined || to === null) return 'removed';
  return 'changed';
}

export function VersionDiffTable({ diffs }: VersionDiffTableProps) {
  if (diffs.length === 0) {
    return <p className="version-diff-empty">No differences found.</p>;
  }

  return (
    <div className="version-diff-scroll">
      <table className="version-diff-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Previous</th>
            <th>Current</th>
          </tr>
        </thead>
        <tbody>
          {diffs.map((diff) => (
            <tr key={diff.field}>
              <td data-tone={diffTone(diff.from, diff.to)}>{diff.field}</td>
              <td data-slot="previous">
                <pre>{formatValue(diff.from)}</pre>
              </td>
              <td data-slot="current">
                <pre>{formatValue(diff.to)}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
