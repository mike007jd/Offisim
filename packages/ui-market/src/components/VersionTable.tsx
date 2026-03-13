import type { VersionSummary } from '@aics/registry-client';
import { formatDate } from '../lib/format.js';
import { RiskBadge } from './RiskBadge.js';

export function VersionTable({ versions }: { versions: VersionSummary[] }) {
  if (versions.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="pb-2 font-medium">Version</th>
            <th className="pb-2 font-medium">Runtime</th>
            <th className="pb-2 font-medium">Environments</th>
            <th className="pb-2 font-medium">Risk</th>
            <th className="pb-2 font-medium">Published</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.version} className="border-b border-gray-100">
              <td className="py-2 font-mono text-xs">{v.version}</td>
              <td className="py-2 font-mono text-xs">{v.runtime_range}</td>
              <td className="py-2">
                <div className="flex gap-1">
                  {v.environments.map((env) => (
                    <span key={env} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
                      {env}
                    </span>
                  ))}
                </div>
              </td>
              <td className="py-2">
                <RiskBadge risk={v.risk_class} />
              </td>
              <td className="py-2 text-gray-500">
                {v.published_at ? formatDate(v.published_at) : '\u2014'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
