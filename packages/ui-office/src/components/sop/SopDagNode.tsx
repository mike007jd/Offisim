import type { SopStep } from '@offisim/shared-types';
import { memo } from 'react';
import type { SopStepStatus } from './sop-dag-layout';

// ---------------------------------------------------------------------------
// Role color mapping
// ---------------------------------------------------------------------------

const ROLE_COLORS: Record<string, string> = {
  developer: '#3b82f6',
  designer: '#a855f7',
  pm: '#f59e0b',
  qa: '#10b981',
  devops: '#ef4444',
  default: '#64748b',
};

function getRoleColor(roleSlug: string): string {
  return ROLE_COLORS[roleSlug] ?? ROLE_COLORS.default ?? '#64748b';
}

// ---------------------------------------------------------------------------
// Status dot styles
// ---------------------------------------------------------------------------

const STATUS_DOT: Record<SopStepStatus, string> = {
  pending: 'bg-slate-500',
  active: 'bg-blue-400 animate-pulse',
  completed: 'bg-emerald-400',
  failed: 'bg-red-400',
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
}

export const SopDagNode = memo(function SopDagNode({
  step,
  status,
  selected,
  editMode,
  onStepClick,
}: SopDagNodeProps) {
  const roleColor = getRoleColor(step.role_slug);

  const borderClass = selected
    ? 'border-blue-400/60 shadow-lg shadow-blue-400/20'
    : 'border-white/10 hover:border-white/20 hover:shadow-lg hover:shadow-white/5';

  return (
    <button
      type="button"
      onClick={() => onStepClick(step.step_id)}
      className={`relative flex w-[280px] h-[140px] rounded-lg overflow-hidden bg-slate-800/80 border transition-all ${editMode ? 'cursor-move' : 'cursor-pointer'} text-left ${borderClass}`}
    >
      {/* Left color bar */}
      <div className="w-1 shrink-0" style={{ backgroundColor: roleColor }} />

      {/* Content */}
      <div className="flex-1 min-w-0 p-3 flex flex-col gap-1.5">
        {/* Top row: status dot + label + role badge */}
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
          <span className="text-sm font-semibold text-white truncate flex-1">{step.label}</span>
          <span
            className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full text-white/80"
            style={{ backgroundColor: `${roleColor}33` }}
          >
            {step.role_slug}
          </span>
        </div>

        {/* Instruction excerpt */}
        <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed flex-1">
          {step.instruction}
        </p>
      </div>
    </button>
  );
});
