import { Check, ChevronRight, X } from 'lucide-react';

export type SopStepStatus = 'pending' | 'active' | 'completed' | 'failed' | 'design';

interface SopStepCardProps {
  label: string;
  roleSlug: string;
  status: SopStepStatus;
  stepIndex: number;
  totalSteps: number;
  dependencyLabels?: string[];
  onClick?: () => void;
}

const STATUS_ACCENT: Record<SopStepStatus, string> = {
  design: 'bg-slate-500/40',
  pending: 'bg-slate-400/30',
  active: 'bg-cyan-400',
  completed: 'bg-emerald-400',
  failed: 'bg-red-400',
};

const STATUS_BG: Record<SopStepStatus, string> = {
  design: 'bg-white/[0.02]',
  pending: 'bg-white/[0.02]',
  active: 'bg-cyan-500/[0.04]',
  completed: 'bg-emerald-500/[0.03]',
  failed: 'bg-red-500/[0.03]',
};

const STATUS_BORDER: Record<SopStepStatus, string> = {
  design: 'border-white/[0.06]',
  pending: 'border-white/[0.06]',
  active: 'border-cyan-400/30',
  completed: 'border-emerald-400/20',
  failed: 'border-red-400/20',
};

const STATUS_LABEL: Record<SopStepStatus, { text: string; color: string }> = {
  design: { text: 'Draft', color: 'text-slate-500' },
  pending: { text: 'Pending', color: 'text-slate-400' },
  active: { text: 'Running', color: 'text-cyan-300' },
  completed: { text: 'Done', color: 'text-emerald-300' },
  failed: { text: 'Failed', color: 'text-red-300' },
};

const ROLE_DOT: Record<string, string> = {
  developer: 'bg-blue-400',
  engineer: 'bg-blue-400',
  frontend: 'bg-violet-400',
  backend: 'bg-indigo-400',
  fullstack: 'bg-blue-400',
  designer: 'bg-pink-400',
  pm: 'bg-amber-400',
  qa: 'bg-orange-400',
  manager: 'bg-amber-400',
  hr: 'bg-rose-400',
};

function getRoleDotColor(roleSlug: string): string {
  const key = roleSlug.toLowerCase().replace(/[-_\s]/g, '');
  for (const [prefix, color] of Object.entries(ROLE_DOT)) {
    if (key.includes(prefix)) return color;
  }
  return 'bg-slate-400';
}

function StatusIcon({ status }: { status: SopStepStatus }) {
  if (status === 'completed') return <Check className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === 'failed') return <X className="w-3.5 h-3.5 text-red-400" />;
  if (status === 'active') return <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />;
  return <span className="w-2 h-2 rounded-full bg-slate-600" />;
}

export function SopStepCard({
  label,
  roleSlug,
  status,
  stepIndex,
  totalSteps,
  dependencyLabels,
  onClick,
}: SopStepCardProps) {
  const sl = STATUS_LABEL[status];

  return (
    <button
      type="button"
      className={`relative flex items-center gap-4 w-full rounded-xl border px-5 py-4 text-left transition-all ${STATUS_BORDER[status]} ${STATUS_BG[status]} ${onClick ? 'cursor-pointer hover:bg-white/[0.04]' : 'cursor-default'}`}
      onClick={onClick}
      disabled={!onClick}
    >
      {/* Left accent bar */}
      <div className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full ${STATUS_ACCENT[status]}`} />

      {/* Step number */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.06] text-[13px] font-bold text-slate-300">
        {stepIndex + 1}
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-slate-100 truncate">{label}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="flex items-center gap-1.5 text-[12px] text-slate-400">
            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${getRoleDotColor(roleSlug)}`} />
            {roleSlug}
          </span>
          {dependencyLabels && dependencyLabels.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-slate-600">
              <ChevronRight className="w-3 h-3" />
              after {dependencyLabels.join(', ')}
            </span>
          )}
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-[12px] font-medium ${sl.color}`}>{sl.text}</span>
        <StatusIcon status={status} />
      </div>

      {/* Progress indicator */}
      <span className="text-[11px] text-slate-600 tabular-nums shrink-0">
        {stepIndex + 1}/{totalSteps}
      </span>
    </button>
  );
}
