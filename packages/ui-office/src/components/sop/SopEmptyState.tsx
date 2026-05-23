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
      <div className="flex flex-1 items-center justify-center">
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
    <div className="flex flex-1 items-center justify-center px-sp-7 py-sp-7">
      <EmptyState
        icon={FileText}
        title={title}
        description={description}
        className="max-w-3xl"
        footer={
          <div className="grid w-full gap-sp-3 pt-sp-2 sm:grid-cols-3">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <Button
                  key={action.label}
                  type="button"
                  variant="outline"
                  disabled={action.disabled}
                  onClick={action.onClick}
                  className="h-auto min-h-20 flex-col items-start justify-between gap-2 rounded-r-md border-line-soft bg-surface-1 p-4 text-left shadow-elev-1 hover:bg-surface-sunken"
                >
                  <Icon className="size-4 text-ink-3" aria-hidden="true" />
                  <span className="flex flex-col items-start gap-1">
                    <span className="text-fs-sm font-semibold text-ink-1">{action.label}</span>
                    <span className="text-fs-meta font-normal text-ink-3">
                      {action.description}
                    </span>
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
