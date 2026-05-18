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
    textClass: string;
    badgeVariant: 'success' | 'warning' | 'error';
  }
> = {
  info: {
    label: 'Info',
    icon: Info,
    textClass: 'text-success',
    badgeVariant: 'success',
  },
  warning: {
    label: 'Warning',
    icon: AlertTriangle,
    textClass: 'text-warning',
    badgeVariant: 'warning',
  },
  breaking: {
    label: 'Breaking',
    icon: OctagonAlert,
    textClass: 'text-error',
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
    <div className="flex items-start gap-2 py-1.5 px-2 border-b border-ocean-light/30 last:border-b-0">
      <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${config.textClass}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${config.textClass}`}>{entry.description}</p>
        {(entry.oldValue || entry.newValue) && (
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-shell/70">
            {entry.oldValue && (
              <span className="inline-flex items-center gap-0.5">
                <Minus className="h-2.5 w-2.5 text-error/70" />
                <span className="line-through">{entry.oldValue}</span>
              </span>
            )}
            {entry.oldValue && entry.newValue && (
              <ArrowRight className="h-2.5 w-2.5 text-shell/50" />
            )}
            {entry.newValue && (
              <span className="inline-flex items-center gap-0.5">
                <Plus className="h-2.5 w-2.5 text-success/70" />
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
    <div className="mb-2 border border-border-subtle">
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-start gap-2 rounded-none px-2 py-1.5 text-left hover:bg-surface-hover"
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronIcon className="size-3.5 text-text-muted" />
        <span className="font-pixel-body text-xs font-medium uppercase tracking-wide text-text-secondary">
          {CATEGORY_LABELS[category]}
        </span>
        <span className="text-xs text-text-muted">({entries.length})</span>
        {hasBreaking && (
          <Badge variant="error" className="ml-auto px-1 py-0 text-caption">
            Breaking
          </Badge>
        )}
      </Button>
      {expanded && (
        <div className="px-1">
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
    <div className="flex flex-col gap-3">
      {/* Version header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-sand truncate">{packageTitle}</h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-sm text-shell/70">v{diff.fromVersion}</span>
            <ArrowRight className="h-3.5 w-3.5 text-shell/50" />
            <span className="text-sm text-sand font-medium">v{diff.toVersion}</span>
          </div>
        </div>
        <Badge variant={maxConfig.badgeVariant}>
          {diff.entries.length === 0 ? 'No Changes' : `${diff.entries.length} changes`}
        </Badge>
      </div>

      {/* Summary counts */}
      {diff.entries.length > 0 && (
        <div className="flex gap-3 text-xs">
          {diff.counts.breaking > 0 && (
            <span className="text-error flex items-center gap-1">
              <OctagonAlert className="h-3 w-3" />
              {diff.counts.breaking} breaking
            </span>
          )}
          {diff.counts.warning > 0 && (
            <span className="text-warning flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {diff.counts.warning} warnings
            </span>
          )}
          {diff.counts.info > 0 && (
            <span className="text-success flex items-center gap-1">
              <Info className="h-3 w-3" />
              {diff.counts.info} info
            </span>
          )}
        </div>
      )}

      {/* Migration notice */}
      {diff.requiresMigration && (
        <Alert variant="warning">
          <Shield className="h-4 w-4" />
          <AlertDescription>
            This upgrade includes a data migration. A backup will be created automatically.
          </AlertDescription>
        </Alert>
      )}

      {/* Breaking changes alert */}
      {diff.counts.breaking > 0 && (
        <Alert variant="destructive">
          <OctagonAlert className="h-4 w-4" />
          <AlertDescription>
            This upgrade contains {diff.counts.breaking} breaking change
            {diff.counts.breaking > 1 ? 's' : ''} that may affect your current setup. Review
            carefully before confirming.
          </AlertDescription>
        </Alert>
      )}

      {/* Diff entries grouped by category */}
      {diff.entries.length > 0 ? (
        <ScrollArea className="max-h-upgrade-diff">
          <div className="pr-3">
            {Array.from(groupedEntries.entries()).map(([category, entries]) => (
              <CategorySection key={category} category={category} entries={entries} />
            ))}
          </div>
        </ScrollArea>
      ) : (
        <p className="text-sm text-shell/70 text-center py-4">
          No manifest changes detected between versions.
        </p>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-ocean-light">
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
