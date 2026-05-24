/**
 * UpgradePreview — shows a structured diff between installed and new package versions.
 * Used in the install dialog when upgrading an existing package (PRD 3.5).
 *
 * Visual language:
 * - Green text for additions / info
 * - Yellow/amber for warnings
 * - Red for breaking changes
 * - Migration notice if schema_version changed
 */

import type { DiffCategory, DiffEntry, DiffSeverity, UpgradeDiff } from '@offisim/install-core';
import { Alert, AlertDescription, Badge, Button, ScrollArea } from '@offisim/ui-core';
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Info,
  Minus,
  OctagonAlert,
  Plus,
  Shield,
} from 'lucide-react';
import { useState } from 'react';

interface UpgradePreviewProps {
  diff: UpgradeDiff;
  packageTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Severity config
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<
  DiffSeverity,
  {
    label: string;
    icon: typeof Info;
    badgeVariant: 'success' | 'warning' | 'error';
  }
> = {
  info: {
    label: 'Info',
    icon: Info,
    badgeVariant: 'success',
  },
  warning: {
    label: 'Warning',
    icon: AlertTriangle,
    badgeVariant: 'warning',
  },
  breaking: {
    label: 'Breaking',
    icon: OctagonAlert,
    badgeVariant: 'error',
  },
};

const CATEGORY_LABELS: Record<DiffCategory, string> = {
  metadata: 'Metadata',
  compatibility: 'Compatibility',
  requirements: 'Requirements',
  permissions: 'Permissions',
  assets: 'Assets',
  distribution: 'Distribution',
  lineage: 'Lineage',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DiffEntryRow({ entry }: { entry: DiffEntry }) {
  const config = SEVERITY_CONFIG[entry.severity];
  const Icon = config.icon;

  return (
    <div className="install-diff-row" data-severity={entry.severity}>
      <Icon data-icon="status" aria-hidden="true" />
      <div className="install-diff-copy">
        <p>{entry.description}</p>
        {(entry.oldValue || entry.newValue) && (
          <div className="install-diff-change">
            {entry.oldValue && (
              <span data-change="old">
                <Minus data-icon="inline-start" aria-hidden="true" />
                <span>{entry.oldValue}</span>
              </span>
            )}
            {entry.oldValue && entry.newValue && (
              <ArrowRight data-icon="inline" aria-hidden="true" />
            )}
            {entry.newValue && (
              <span data-change="new">
                <Plus data-icon="inline-start" aria-hidden="true" />
                <span>{entry.newValue}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CategorySection({
  category,
  entries,
}: {
  category: DiffCategory;
  entries: DiffEntry[];
}) {
  const [expanded, setExpanded] = useState(true);
  const hasBreaking = entries.some((e) => e.severity === 'breaking');
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="install-diff-section" data-has-breaking={hasBreaking ? 'true' : 'false'}>
      <Button
        type="button"
        variant="ghost"
        className="install-diff-section-trigger"
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronIcon data-icon="inline-start" aria-hidden="true" />
        <span data-slot="category">{CATEGORY_LABELS[category]}</span>
        <span data-slot="count">({entries.length})</span>
        {hasBreaking && (
          <Badge variant="error" size="xs" data-slot="breaking-badge">
            Breaking
          </Badge>
        )}
      </Button>
      {expanded && (
        <div className="install-diff-section-body">
          {entries.map((entry, i) => (
            <DiffEntryRow key={`${entry.field}-${i}`} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function UpgradePreview({ diff, packageTitle, onConfirm, onCancel }: UpgradePreviewProps) {
  // Group entries by category, preserving order
  const groupedEntries = new Map<DiffCategory, DiffEntry[]>();
  for (const entry of diff.entries) {
    const existing = groupedEntries.get(entry.category) ?? [];
    existing.push(entry);
    groupedEntries.set(entry.category, existing);
  }

  const maxConfig = SEVERITY_CONFIG[diff.maxSeverity];

  return (
    <div className="install-upgrade">
      {/* Version header */}
      <div className="install-upgrade-header">
        <div className="install-upgrade-title">
          <h3>{packageTitle}</h3>
          <div>
            <span>v{diff.fromVersion}</span>
            <ArrowRight data-icon="inline" aria-hidden="true" />
            <strong>v{diff.toVersion}</strong>
          </div>
        </div>
        <Badge variant={maxConfig.badgeVariant}>
          {diff.entries.length === 0 ? 'No Changes' : `${diff.entries.length} changes`}
        </Badge>
      </div>

      {/* Summary counts */}
      {diff.entries.length > 0 && (
        <div className="install-upgrade-summary">
          {diff.counts.breaking > 0 && (
            <span data-severity="breaking">
              <OctagonAlert data-icon="inline-start" aria-hidden="true" />
              {diff.counts.breaking} breaking
            </span>
          )}
          {diff.counts.warning > 0 && (
            <span data-severity="warning">
              <AlertTriangle data-icon="inline-start" aria-hidden="true" />
              {diff.counts.warning} warnings
            </span>
          )}
          {diff.counts.info > 0 && (
            <span data-severity="info">
              <Info data-icon="inline-start" aria-hidden="true" />
              {diff.counts.info} info
            </span>
          )}
        </div>
      )}

      {/* Migration notice */}
      {diff.requiresMigration && (
        <Alert variant="warning">
          <Shield data-icon="inline-start" aria-hidden="true" />
          <AlertDescription>
            This upgrade includes a data migration. A backup will be created automatically.
          </AlertDescription>
        </Alert>
      )}

      {/* Breaking changes alert */}
      {diff.counts.breaking > 0 && (
        <Alert variant="destructive">
          <OctagonAlert data-icon="inline-start" aria-hidden="true" />
          <AlertDescription>
            This upgrade contains {diff.counts.breaking} breaking change
            {diff.counts.breaking > 1 ? 's' : ''} that may affect your current setup. Review
            carefully before confirming.
          </AlertDescription>
        </Alert>
      )}

      {/* Diff entries grouped by category */}
      {diff.entries.length > 0 ? (
        <ScrollArea className="install-upgrade-scroll">
          <div className="install-upgrade-scroll-body">
            {Array.from(groupedEntries.entries()).map(([category, entries]) => (
              <CategorySection key={category} category={category} entries={entries} />
            ))}
          </div>
        </ScrollArea>
      ) : (
        <p className="install-upgrade-empty">No manifest changes detected between versions.</p>
      )}

      {/* Actions */}
      <div className="install-upgrade-actions">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onConfirm} variant={diff.counts.breaking > 0 ? 'destructive' : 'default'}>
          {diff.counts.breaking > 0 ? 'Confirm Upgrade' : 'Upgrade'}
        </Button>
      </div>
    </div>
  );
}
