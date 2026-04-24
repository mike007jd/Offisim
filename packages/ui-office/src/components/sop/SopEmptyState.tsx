import { EmptyState } from '@offisim/ui-core';
import { ClipboardList, FileText } from 'lucide-react';

export interface SopEmptyStateProps {
  hasNoSops: boolean;
  onCreateClick: () => void;
  onImportClick: () => void;
  /** Optional template starter. */
  onTemplateClick?: () => void;
}

/**
 * SOP default state. When no SOP is selected or the user has no SOPs, surface
 * template / create / import starting actions and keep run-style actions
 * absent until a runnable graph exists.
 */
export function SopEmptyState({
  hasNoSops,
  onCreateClick,
  onImportClick,
  onTemplateClick,
}: SopEmptyStateProps) {
  const title = hasNoSops ? 'Start your first SOP' : 'Select an SOP';
  const description = hasNoSops
    ? 'A Standard Operating Procedure captures a repeatable workflow. Start from a template, build from scratch, or import one.'
    : 'Pick an SOP from the list to view its graph, edit steps, or run it against a new task.';

  const secondaryActions = hasNoSops
    ? [
        ...(onTemplateClick ? [{ label: 'Use a template', onClick: onTemplateClick }] : []),
        { label: 'Import SOP', onClick: onImportClick },
      ]
    : [];

  return (
    <div className="flex flex-1 items-center justify-center">
      <EmptyState
        icon={hasNoSops ? FileText : ClipboardList}
        title={title}
        description={description}
        primaryAction={{ label: 'Create SOP', onClick: onCreateClick }}
        secondaryActions={secondaryActions}
        footer={hasNoSops ? undefined : 'Run actions appear once a SOP has a complete graph.'}
      />
    </div>
  );
}
