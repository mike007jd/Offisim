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

function diffColor(from: unknown, to: unknown): string {
  if (from === undefined || from === null) return 'text-ok'; // added
  if (to === undefined || to === null) return 'text-danger'; // removed
  return 'text-warning'; // changed
}

export function VersionDiffTable({ diffs }: VersionDiffTableProps) {
  if (diffs.length === 0) {
    return <p className="text-sm text-ink-2/50 italic py-2">No differences found.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th className="text-left py-1.5 px-2 text-ink-2/70 font-medium">Field</th>
            <th className="text-left py-1.5 px-2 text-ink-2/70 font-medium">Previous</th>
            <th className="text-left py-1.5 px-2 text-ink-2/70 font-medium">Current</th>
          </tr>
        </thead>
        <tbody>
          {diffs.map((diff) => (
            <tr key={diff.field} className="border-b border-line">
              <td className={`py-1.5 px-2 font-mono text-xs ${diffColor(diff.from, diff.to)}`}>
                {diff.field}
              </td>
              <td className="py-1.5 px-2 text-ink-2/60">
                <pre className="whitespace-pre-wrap break-all text-xs font-mono">
                  {formatValue(diff.from)}
                </pre>
              </td>
              <td className="py-1.5 px-2 text-ink-2">
                <pre className="whitespace-pre-wrap break-all text-xs font-mono">
                  {formatValue(diff.to)}
                </pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
