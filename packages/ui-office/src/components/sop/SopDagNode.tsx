import type { SopStep } from '@offisim/shared-types';
import { Button, cn } from '@offisim/ui-core';
import { memo } from 'react';
import type { SopStepStatus } from './sop-dag-layout';

// ---------------------------------------------------------------------------
// Status dot styles
// ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<SopStepStatus, string> = {
  pending: 'Pending',
  active: 'Active',
  completed: 'Completed',
  failed: 'Failed',
};

// ---------------------------------------------------------------------------
// SopDagNode
// ---------------------------------------------------------------------------

export interface SopDagNodeProps {
  step: SopStep;
  status: SopStepStatus;
  selected: boolean;
  editMode?: boolean;
  onStepClick: (stepId: string) => void;
  /** True when no employee in the active company has this step's role. */
  roleMissing?: boolean;
}

export const SopDagNode = memo(function SopDagNode({
  step,
  status,
  selected,
  editMode,
  onStepClick,
  roleMissing,
}: SopDagNodeProps) {
  const depsCount = step.dependencies.length;

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onStepClick(step.step_id)}
      className={cn(
        'sop-dag-node',
        selected && 'sop-dag-node-selected',
        editMode && 'sop-dag-node-editing',
      )}
      data-role={step.role_slug}
      data-status={status}
    >
      <div className="sop-dag-node-rail" aria-hidden="true" />

      <div className="sop-dag-node-body">
        <div className="sop-dag-node-head">
          <span className="sop-status-dot" data-status={status} />
          <span className="sop-dag-node-title">{step.label}</span>
          {depsCount > 0 && (
            <span className="sop-dag-node-chip" data-tone="neutral">
              deps · {depsCount}
            </span>
          )}
          {status === 'failed' && (
            <span className="sop-dag-node-chip" data-tone="danger">
              failed
            </span>
          )}
          {roleMissing && (
            <span className="sop-dag-node-chip" data-tone="warn">
              no {step.role_slug}
            </span>
          )}
          <span className="sop-dag-node-role" data-role={step.role_slug}>
            {step.role_slug}
          </span>
        </div>

        <p className="sop-dag-node-instruction">{step.instruction}</p>

        <p className="sop-dag-node-output">→ {step.output_key}</p>
      </div>
    </Button>
  );
});
