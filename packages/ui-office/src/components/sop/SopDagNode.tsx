import type { SopStep } from '@offisim/shared-types';
import { Button, cn } from '@offisim/ui-core';
import { memo } from 'react';
import type { SopStepStatus } from './sop-dag-layout';

// ---------------------------------------------------------------------------
// Role color mapping
// ---------------------------------------------------------------------------

const DEFAULT_ROLE_TONE = {
  rail: 'bg-ink-4',
  chip: 'bg-surface-sunken',
  text: 'text-ink-3',
};

const ROLE_TONE: Record<string, { rail: string; chip: string; text: string }> = {
  developer: { rail: 'bg-accent', chip: 'bg-accent-surface', text: 'text-accent' },
  designer: { rail: 'bg-violet', chip: 'bg-violet-surface', text: 'text-violet' },
  pm: { rail: 'bg-warn', chip: 'bg-warn-surface', text: 'text-warn' },
  qa: { rail: 'bg-ok', chip: 'bg-ok-surface', text: 'text-ok' },
  devops: { rail: 'bg-danger', chip: 'bg-danger-surface', text: 'text-danger' },
};

function getRoleTone(roleSlug: string) {
  return ROLE_TONE[roleSlug] ?? DEFAULT_ROLE_TONE;
}

// ---------------------------------------------------------------------------
// Status dot styles
// ---------------------------------------------------------------------------

export const STATUS_DOT: Record<SopStepStatus, string> = {
  pending: 'bg-ink-4',
  active: 'animate-pulse bg-accent',
  completed: 'bg-ok',
  failed: 'bg-danger',
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
    ? 'border-accent-ring shadow-overlay'
    : 'border-line-soft hover:border-line-strong hover:shadow-overlay';

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onStepClick(step.step_id)}
      className={`relative h-sop-dag-node w-sop-dag-node items-stretch overflow-hidden rounded-r-md border bg-surface-1 p-0 text-left transition-all ${editMode ? 'cursor-move' : 'cursor-pointer'} ${borderClass}`}
    >
      {/* Left color bar */}
      <div className={cn('w-1 shrink-0', roleTone.rail)} />

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        {/* Top row: status dot + label + deps chip + role badge */}
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-2 shrink-0 rounded-r-pill ${STATUS_DOT[status]}`} />
          <span className="flex-1 truncate text-fs-sm font-semibold text-ink-1">{step.label}</span>
          {depsCount > 0 && (
            <span className="shrink-0 rounded-r-pill bg-surface-sunken px-1.5 py-0.5 text-fs-meta text-ink-3">
              deps · {depsCount}
            </span>
          )}
          {status === 'failed' && (
            <span className="shrink-0 rounded-r-pill bg-danger-surface px-1.5 py-0.5 text-fs-meta font-semibold uppercase tracking-wide text-danger">
              failed
            </span>
          )}
          {roleMissing && (
            <span className="shrink-0 rounded-r-pill border border-warn/40 bg-warn-surface px-1.5 py-0.5 text-fs-meta text-warn">
              ⚠ no {step.role_slug}
            </span>
          )}
          <span
            className={cn(
              'shrink-0 rounded-r-pill px-1.5 py-0.5 text-fs-meta',
              roleTone.chip,
              roleTone.text,
            )}
          >
            {step.role_slug}
          </span>
        </div>

        {/* Instruction excerpt — single line to make room for output_key subline */}
        <p className="line-clamp-1 flex-1 text-fs-sm leading-relaxed text-ink-3">
          {step.instruction}
        </p>

        {/* Output key */}
        <p className="truncate font-mono text-fs-meta text-ink-4">→ {step.output_key}</p>
      </div>
    </Button>
  );
});
