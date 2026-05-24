import { Badge, Button, ScrollArea } from '@offisim/ui-core';
import { useState } from 'react';
import { useEmployeeVersions } from '../../hooks/useEmployeeVersions';
import { VersionDiffTable } from './VersionDiffTable';

interface ForkOrigin {
  sourceAssetId: string;
  sourcePackageId?: string | null;
  sourceUrl?: string | null;
}

interface VersionHistoryTabProps {
  employeeId: string;
  /** If this employee was installed from a marketplace asset, show provenance. */
  forkOrigin?: ForkOrigin | null;
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

export function VersionHistoryTab({ employeeId, forkOrigin }: VersionHistoryTabProps) {
  const { versions, loading, diffResult, selectedVersion, selectVersion, rollback, isRollingBack } =
    useEmployeeVersions(employeeId);

  const [confirmRollback, setConfirmRollback] = useState<number | null>(null);

  if (loading) {
    return <p className="text-fs-sm text-ink-2/50 py-4 text-center">Loading version history...</p>;
  }

  if (versions.length === 0) {
    return (
      <p className="text-fs-sm text-ink-2/50 py-4 text-center">No version history available.</p>
    );
  }

  if (versions.length === 1) {
    return (
      <p className="text-fs-sm text-ink-2/50 py-4 text-center">
        Only one version exists. Make changes to build up history.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-2">
      {/* Fork provenance badge */}
      {forkOrigin && (
        <div className="flex items-center gap-2 rounded-r-xs border border-accent/20 bg-accent-surface px-2 py-1.5">
          <Badge variant="info" className="shrink-0">
            Forked
          </Badge>
          <span className="text-fs-meta text-ink-2/70">
            From:{' '}
            {forkOrigin.sourceUrl ? (
              <a
                href={forkOrigin.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {forkOrigin.sourceAssetId}
              </a>
            ) : (
              <span className="font-mono">{forkOrigin.sourceAssetId}</span>
            )}
            {forkOrigin.sourcePackageId && (
              <span className="text-ink-2/50 ml-1">(pkg: {forkOrigin.sourcePackageId})</span>
            )}
          </span>
        </div>
      )}

      {/* Timeline list */}
      <ScrollArea className="max-h-48">
        <div className="flex flex-col gap-1">
          {versions.map((v) => {
            const badge = CHANGE_TYPE_BADGE[v.change_type] ?? {
              label: v.change_type,
              variant: 'secondary' as const,
            };
            const isSelected = selectedVersion === v.version_num;
            const isCurrent = v.version_num === versions[0]?.version_num;

            return (
              <Button
                type="button"
                key={v.version_id}
                variant="ghost"
                className={`h-auto justify-start gap-2 rounded-r-xs px-2 py-1.5 text-left text-fs-sm ${
                  isSelected
                    ? 'border border-accent bg-accent-surface'
                    : 'border border-transparent hover:bg-surface-sunken'
                }`}
                onClick={() => selectVersion(isSelected ? null : v.version_num)}
              >
                <span className="w-8 shrink-0 font-mono text-fs-meta text-ink-4">
                  v{v.version_num}
                </span>
                <Badge variant={badge.variant} className="shrink-0">
                  {badge.label}
                </Badge>
                <span className="flex-1 truncate text-fs-meta text-ink-4">
                  {v.change_summary ?? formatTimestamp(v.created_at)}
                </span>
                {isCurrent && (
                  <Badge variant="secondary" className="shrink-0">
                    current
                  </Badge>
                )}
              </Button>
            );
          })}
        </div>
      </ScrollArea>

      {/* Diff display */}
      {selectedVersion != null && diffResult != null && (
        <div className="border border-line rounded-r-xs p-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-fs-meta text-ink-2/70 font-medium">
              Changes from v{selectedVersion} to v{versions[0]?.version_num} (current)
            </span>
            {/* Rollback button */}
            {confirmRollback === selectedVersion ? (
              <div className="flex items-center gap-1">
                <span className="text-fs-meta text-warn">Rollback to v{selectedVersion}?</span>
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
