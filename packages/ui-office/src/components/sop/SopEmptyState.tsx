import { Button, EmptyState } from '@offisim/ui-core';
import { ClipboardList, FileInput, FileText, Library } from 'lucide-react';

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

  if (!hasNoSops) {
    return (
      <div className="sop-empty-state">
        <EmptyState
          icon={ClipboardList}
          title={title}
          description={description}
          primaryAction={{ label: 'Create SOP', onClick: onCreateClick }}
          footer="Run actions appear once a SOP has a complete graph."
        />
      </div>
    );
  }

  const actions = [
    {
      label: 'Use template',
      description: 'Browse SOP templates',
      icon: Library,
      onClick: onTemplateClick,
      disabled: !onTemplateClick,
    },
    {
      label: 'Create SOP',
      description: 'Build a new graph',
      icon: FileText,
      onClick: onCreateClick,
      disabled: false,
    },
    {
      label: 'Import SOP',
      description: 'Load an existing workflow',
      icon: FileInput,
      onClick: onImportClick,
      disabled: false,
    },
  ];

  return (
    <div className="sop-empty-state sop-empty-state-start">
      <EmptyState
        icon={FileText}
        title={title}
        description={description}
        className="sop-empty-state-card"
        footer={
          <div className="sop-empty-action-grid">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <Button
                  key={action.label}
                  type="button"
                  variant="outline"
                  disabled={action.disabled}
                  onClick={action.onClick}
                  className="sop-empty-action"
                >
                  <Icon data-icon="empty-action" aria-hidden="true" />
                  <span className="sop-empty-action-copy">
                    <span className="sop-empty-action-label">{action.label}</span>
                    <span className="sop-empty-action-description">{action.description}</span>
                  </span>
                </Button>
              );
            })}
          </div>
        }
      />
    </div>
  );
}
