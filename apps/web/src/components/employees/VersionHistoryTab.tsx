import { useState } from 'react';
import { useEmployeeVersions } from '../../hooks/useEmployeeVersions';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { VersionDiffTable } from './VersionDiffTable';

interface VersionHistoryTabProps {
  employeeId: string;
}

const CHANGE_TYPE_BADGE: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'info' }
> = {
  create: { label: 'Created', variant: 'success' },
  update: { label: 'Updated', variant: 'info' },
  rollback: { label: 'Rollback', variant: 'warning' },
};

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export function VersionHistoryTab({ employeeId }: VersionHistoryTabProps) {
  const { versions, loading, diffResult, selectedVersion, selectVersion, rollback, isRollingBack } =
    useEmployeeVersions(employeeId);

  const [confirmRollback, setConfirmRollback] = useState<number | null>(null);

  if (loading) {
    return <p className="text-sm text-shell/50 py-4 text-center">Loading version history...</p>;
  }

  if (versions.length === 0) {
    return <p className="text-sm text-shell/50 py-4 text-center">No version history available.</p>;
  }

  if (versions.length === 1) {
    return (
      <p className="text-sm text-shell/50 py-4 text-center">
        Only one version exists. Make changes to build up history.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-2">
      {/* Timeline list */}
      <ScrollArea className="max-h-48">
        <div className="flex flex-col gap-1">
          {versions.map((v) => {
            const badge = CHANGE_TYPE_BADGE[v.change_type] ?? {
              label: v.change_type,
              variant: 'secondary' as const,
            };
            const isSelected = selectedVersion === v.version_num;
            const isCurrent = v.version_num === versions[0]!.version_num;

            return (
              <button
                type="button"
                key={v.version_id}
                className={`flex items-center gap-2 px-2 py-1.5 text-left text-sm rounded transition-colors ${
                  isSelected
                    ? 'bg-sea-blue/20 border border-sea-blue/40'
                    : 'hover:bg-ocean-mid border border-transparent'
                }`}
                onClick={() => selectVersion(isSelected ? null : v.version_num)}
              >
                <span className="font-mono text-xs text-shell/60 w-8 shrink-0">
                  v{v.version_num}
                </span>
                <Badge variant={badge.variant} className="shrink-0">
                  {badge.label}
                </Badge>
                <span className="text-xs text-shell/50 truncate flex-1">
                  {v.change_summary ?? formatTimestamp(v.created_at)}
                </span>
                {isCurrent && (
                  <Badge variant="secondary" className="shrink-0">
                    current
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </ScrollArea>

      {/* Diff display */}
      {selectedVersion != null && diffResult != null && (
        <div className="border border-ocean-light rounded p-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-shell/70 font-medium">
              Changes from v{selectedVersion} to v{versions[0]!.version_num} (current)
            </span>
            {/* Rollback button */}
            {confirmRollback === selectedVersion ? (
              <div className="flex items-center gap-1">
                <span className="text-xs text-coral-orange">Rollback to v{selectedVersion}?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={isRollingBack}
                  onClick={async () => {
                    await rollback(selectedVersion);
                    setConfirmRollback(null);
                  }}
                >
                  {isRollingBack ? 'Rolling back...' : 'Confirm'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmRollback(null)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmRollback(selectedVersion)}
              >
                Rollback to v{selectedVersion}
              </Button>
            )}
          </div>
          <VersionDiffTable diffs={diffResult} />
        </div>
      )}
    </div>
  );
}
