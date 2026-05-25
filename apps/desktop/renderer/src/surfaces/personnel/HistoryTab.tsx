import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { cn } from '@/lib/utils.js';
import { Link2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  type EmployeeVersion,
  type VersionChangeType,
  useEmployeeVersions,
} from './personnel-data.js';

const CHANGE_BADGE: Record<VersionChangeType, { cls: string; label: string }> = {
  created: { cls: 'is-ok', label: 'Created' },
  updated: { cls: 'is-info', label: 'Updated' },
  rollback: { cls: 'is-warn', label: 'Rollback' },
};

const DIFF_CLS = { add: 'is-add', remove: 'is-rm', change: 'is-ch' } as const;

interface HistoryTabProps {
  employeeId: string;
}

export function HistoryTab({ employeeId }: HistoryTabProps) {
  const query = useEmployeeVersions(employeeId);
  const history = query.data;

  const currentVersion = history?.versions.find((v) => v.current) ?? null;
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [confirmingRollback, setConfirmingRollback] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);

  const effectiveSelected = useMemo<EmployeeVersion | null>(() => {
    if (!history) return null;
    if (selectedVersion === null) {
      // Default to the most recent non-current version when a diff exists.
      const candidate = history.versions.find((v) => !v.current && history.diffs[v.version]);
      return candidate ?? null;
    }
    return history.versions.find((v) => v.version === selectedVersion) ?? null;
  }, [history, selectedVersion]);

  const diffRows = effectiveSelected ? (history?.diffs[effectiveSelected.version] ?? []) : [];

  const doRollback = () => {
    setRollingBack(true);
    // Optimistic UI only — real rollback fires a backend mutation later.
    window.setTimeout(() => {
      setRollingBack(false);
      setConfirmingRollback(false);
    }, 320);
  };

  if (query.isLoading) {
    return (
      <div className="off-pers-tab-shell">
        <div className="off-pers-tab-scroll text-center text-[var(--off-fs-sm)] text-[var(--off-ink-4)]">
          Loading version history…
        </div>
      </div>
    );
  }

  if (!history || history.versions.length === 0) {
    return (
      <div className="off-pers-tab-shell">
        <div className="off-pers-tab-scroll text-center text-[var(--off-fs-sm)] text-[var(--off-ink-4)]">
          No version history available.
        </div>
      </div>
    );
  }

  if (history.versions.length === 1) {
    return (
      <div className="off-pers-tab-shell">
        <div className="off-pers-tab-scroll text-center text-[var(--off-fs-sm)] text-[var(--off-ink-4)]">
          Only one version exists. Make changes to build up history.
        </div>
      </div>
    );
  }

  return (
    <div className="off-pers-tab-shell">
      <div className="off-pers-tab-scroll">
        <CapsLabel>Version history</CapsLabel>

        {history.fork ? (
          <div className="off-pers-fork-badge">
            <span className="off-pers-badge is-info">Forked</span>
            <span>
              From: <span className="font-mono">{history.fork.sourceAssetId}</span>{' '}
              {history.fork.packageId ? (
                <span className="off-pers-fork-pkg">(pkg: {history.fork.packageId})</span>
              ) : null}
            </span>
            {history.fork.marketplaceUrl ? (
              <a
                className="off-pers-fork-link off-focusable"
                href={history.fork.marketplaceUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Icon icon={Link2} size="sm" />
                marketplace listing
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="off-pers-ver-list" aria-label="Version timeline">
          {history.versions.map((version) => {
            const badge = CHANGE_BADGE[version.changeType];
            const selected = effectiveSelected?.version === version.version;
            return (
              <button
                key={version.id}
                type="button"
                aria-pressed={selected}
                className={cn('off-pers-ver-row off-focusable', selected && 'is-sel')}
                onClick={() => {
                  setSelectedVersion(version.version);
                  setConfirmingRollback(false);
                }}
              >
                <span className="off-pers-ver-num">v{version.version}</span>
                <span className={cn('off-pers-badge', badge.cls)}>{badge.label}</span>
                <span className="off-pers-ver-sum">
                  {version.summary} · {version.timestamp}
                </span>
                {version.current ? <span className="off-pers-badge is-sec">current</span> : null}
              </button>
            );
          })}
        </div>

        {effectiveSelected && !effectiveSelected.current ? (
          <div className="off-pers-ver-diff">
            <div className="off-pers-ver-diff-head">
              <span className="off-pers-ver-diff-title">
                Diff: v{effectiveSelected.version} → v{currentVersion?.version ?? '?'} (current)
              </span>
              {confirmingRollback ? (
                <div className="off-pers-ver-diff-confirm">
                  <span>Rollback to v{effectiveSelected.version}?</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={rollingBack}
                    onClick={() => setConfirmingRollback(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={rollingBack}
                    onClick={doRollback}
                  >
                    {rollingBack ? 'Rolling back…' : 'Confirm'}
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirmingRollback(true)}>
                  Rollback to v{effectiveSelected.version}
                </Button>
              )}
            </div>
            <table className="off-pers-difftbl">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>v{effectiveSelected.version}</th>
                  <th>v{currentVersion?.version ?? '?'}</th>
                </tr>
              </thead>
              <tbody>
                {diffRows.map((row) => (
                  <tr key={row.field}>
                    <td className={cn('off-pers-diff-field', DIFF_CLS[row.kind])}>{row.field}</td>
                    <td>
                      <pre>{row.previous}</pre>
                    </td>
                    <td>
                      <pre>{row.current}</pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
