import type { VersionDiff } from '@aics/core/browser';

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
  if (from === undefined || from === null) return 'text-kelp-green'; // added
  if (to === undefined || to === null) return 'text-lobster-red'; // removed
  return 'text-coral-orange'; // changed
}

export function VersionDiffTable({ diffs }: VersionDiffTableProps) {
  if (diffs.length === 0) {
    return <p className="text-sm text-shell/50 italic py-2">No differences found.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-ocean-light">
            <th className="text-left py-1.5 px-2 text-shell/70 font-medium">Field</th>
            <th className="text-left py-1.5 px-2 text-shell/70 font-medium">Previous</th>
            <th className="text-left py-1.5 px-2 text-shell/70 font-medium">Current</th>
          </tr>
        </thead>
        <tbody>
          {diffs.map((diff) => (
            <tr key={diff.field} className="border-b border-ocean-light/50">
              <td className={`py-1.5 px-2 font-mono text-xs ${diffColor(diff.from, diff.to)}`}>
                {diff.field}
              </td>
              <td className="py-1.5 px-2 text-shell/60">
                <pre className="whitespace-pre-wrap break-all text-xs font-mono">
                  {formatValue(diff.from)}
                </pre>
              </td>
              <td className="py-1.5 px-2 text-shell">
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
