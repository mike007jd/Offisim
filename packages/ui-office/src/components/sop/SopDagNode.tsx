import type { SopStep } from '@offisim/shared-types';
import { Button, cn } from '@offisim/ui-core';
import { memo } from 'react';
import type { SopStepStatus } from './sop-dag-layout';

// ---------------------------------------------------------------------------
// Role color mapping
// ---------------------------------------------------------------------------

const DEFAULT_ROLE_TONE = {
  rail: 'bg-text-muted',
  chip: 'bg-surface-muted',
  text: 'text-text-secondary',
};

const ROLE_TONE: Record<string, { rail: string; chip: string; text: string }> = {
  developer: { rail: 'bg-info', chip: 'bg-info-muted', text: 'text-info' },
  designer: { rail: 'bg-accent', chip: 'bg-accent-muted', text: 'text-accent' },
  pm: { rail: 'bg-warning', chip: 'bg-warning-muted', text: 'text-warning' },
  qa: { rail: 'bg-success', chip: 'bg-success-muted', text: 'text-success' },
  devops: { rail: 'bg-error', chip: 'bg-error-muted', text: 'text-error' },
};

function getRoleTone(roleSlug: string) {
  return ROLE_TONE[roleSlug] ?? DEFAULT_ROLE_TONE;
}

// ---------------------------------------------------------------------------
// Status dot styles
// ---------------------------------------------------------------------------

export const STATUS_DOT: Record<SopStepStatus, string> = {
  pending: 'bg-text-muted',
  active: 'animate-pulse bg-info',
  completed: 'bg-success',
  failed: 'bg-error',
};

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
  const roleTone = getRoleTone(step.role_slug);
  const depsCount = step.dependencies.length;

  const borderClass = selected
    ? 'border-border-focus shadow-overlay'
    : 'border-border-default hover:border-border-strong hover:shadow-overlay';

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onStepClick(step.step_id)}
      className={`relative h-sop-dag-node w-sop-dag-node items-stretch overflow-hidden rounded-lg border bg-surface-elevated p-0 text-left transition-all ${editMode ? 'cursor-move' : 'cursor-pointer'} ${borderClass}`}
    >
      {/* Left color bar */}
      <div className={cn('w-1 shrink-0', roleTone.rail)} />

      {/* Content */}
      <div className="flex-1 min-w-0 p-3 flex flex-col gap-1.5">
        {/* Top row: status dot + label + deps chip + role badge */}
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
          <span className="flex-1 truncate text-sm font-semibold text-text-primary">
            {step.label}
          </span>
          {depsCount > 0 && (
            <span className="shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-caption text-text-secondary">
              deps · {depsCount}
            </span>
          )}
          {status === 'failed' && (
            <span className="shrink-0 rounded-full bg-error-muted px-1.5 py-0.5 text-caption font-semibold uppercase tracking-wide text-error">
              failed
            </span>
          )}
          {roleMissing && (
            <span className="shrink-0 rounded-full border border-warning/40 bg-warning-muted px-1.5 py-0.5 text-caption text-warning">
              ⚠ no {step.role_slug}
            </span>
          )}
          <span
            className={cn(
              'shrink-0 rounded-full px-1.5 py-0.5 text-caption',
              roleTone.chip,
              roleTone.text,
            )}
          >
            {step.role_slug}
          </span>
        </div>

        {/* Instruction excerpt — single line to make room for output_key subline */}
        <p className="line-clamp-1 flex-1 text-xs leading-relaxed text-text-secondary">
          {step.instruction}
        </p>

        {/* Output key */}
        <p className="truncate font-mono text-caption text-text-muted">→ {step.output_key}</p>
      </div>
    </Button>
  );
});
