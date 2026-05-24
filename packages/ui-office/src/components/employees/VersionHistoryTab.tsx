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
    return <p className="version-history-state">Loading version history...</p>;
  }

  if (versions.length === 0) {
    return <p className="version-history-state">No version history available.</p>;
  }

  if (versions.length === 1) {
    return (
      <p className="version-history-state">
        Only one version exists. Make changes to build up history.
      </p>
    );
  }

  return (
    <div className="version-history-tab">
      {/* Fork provenance badge */}
      {forkOrigin && (
        <div className="version-history-origin">
          <Badge variant="info" className="version-history-badge">
            Forked
          </Badge>
          <span>
            From:{' '}
            {forkOrigin.sourceUrl ? (
              <a href={forkOrigin.sourceUrl} target="_blank" rel="noopener noreferrer">
                {forkOrigin.sourceAssetId}
              </a>
            ) : (
              <span data-slot="asset-id">{forkOrigin.sourceAssetId}</span>
            )}
            {forkOrigin.sourcePackageId && (
              <span data-slot="package-id">(pkg: {forkOrigin.sourcePackageId})</span>
            )}
          </span>
        </div>
      )}

      {/* Timeline list */}
      <ScrollArea className="version-history-scroll">
        <div className="version-history-list">
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
                className="version-history-item"
                data-selected={isSelected ? 'true' : 'false'}
                onClick={() => selectVersion(isSelected ? null : v.version_num)}
              >
                <span data-slot="version">v{v.version_num}</span>
                <Badge variant={badge.variant} className="version-history-badge">
                  {badge.label}
                </Badge>
                <span data-slot="summary">{v.change_summary ?? formatTimestamp(v.created_at)}</span>
                {isCurrent && (
                  <Badge variant="secondary" className="version-history-badge">
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
        <div className="version-history-diff">
          <div className="version-history-diff-head">
            <span>
              Changes from v{selectedVersion} to v{versions[0]?.version_num} (current)
            </span>
            {/* Rollback button */}
            {confirmRollback === selectedVersion ? (
              <div className="version-history-confirm">
                <span>Rollback to v{selectedVersion}?</span>
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
