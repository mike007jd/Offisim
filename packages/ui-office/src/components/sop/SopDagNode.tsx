import type { SopStep } from '@offisim/shared-types';
import { memo } from 'react';
import type { SopStepStatus } from './sop-dag-layout';

// ---------------------------------------------------------------------------
// Role color mapping
// ---------------------------------------------------------------------------

const ROLE_COLORS: Record<string, string> = {
  developer: '#3b82f6', // raw-hex-allowed
  designer: '#a855f7', // raw-hex-allowed
  pm: '#f59e0b', // raw-hex-allowed
  qa: '#10b981', // raw-hex-allowed
  devops: '#ef4444', // raw-hex-allowed
  default: '#64748b', // raw-hex-allowed
};

function getRoleColor(roleSlug: string): string {
  return ROLE_COLORS[roleSlug] ?? ROLE_COLORS.default ?? '#64748b'; // raw-hex-allowed
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
  const roleColor = getRoleColor(step.role_slug);
  const depsCount = step.dependencies.length;

  const borderClass = selected
    ? 'border-border-focus shadow-overlay'
    : 'border-border-default hover:border-border-strong hover:shadow-overlay';

  return (
    <button
      type="button"
      onClick={() => onStepClick(step.step_id)}
      className={`relative flex h-[140px] w-[280px] overflow-hidden rounded-lg border bg-surface-elevated text-left transition-all ${editMode ? 'cursor-move' : 'cursor-pointer'} ${borderClass}`}
    >
      {/* Left color bar */}
      <div className="w-1 shrink-0" style={{ backgroundColor: roleColor }} />

      {/* Content */}
      <div className="flex-1 min-w-0 p-3 flex flex-col gap-1.5">
        {/* Top row: status dot + label + deps chip + role badge */}
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
          <span className="flex-1 truncate text-sm font-semibold text-text-primary">
            {step.label}
          </span>
          {depsCount > 0 && (
            <span className="shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] text-text-secondary">
              deps · {depsCount}
            </span>
          )}
          {status === 'failed' && (
            <span className="shrink-0 rounded-full bg-error-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-error">
              failed
            </span>
          )}
          {roleMissing && (
            <span className="shrink-0 rounded-full border border-warning/40 bg-warning-muted px-1.5 py-0.5 text-[10px] text-warning">
              ⚠ no {step.role_slug}
            </span>
          )}
          <span
            className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] text-text-primary"
            style={{ backgroundColor: `${roleColor}33` }}
          >
            {step.role_slug}
          </span>
        </div>

        {/* Instruction excerpt — single line to make room for output_key subline */}
        <p className="line-clamp-1 flex-1 text-xs leading-relaxed text-text-secondary">
          {step.instruction}
        </p>

        {/* Output key */}
        <p className="truncate font-mono text-[10px] text-text-muted">→ {step.output_key}</p>
      </div>
    </button>
  );
});
