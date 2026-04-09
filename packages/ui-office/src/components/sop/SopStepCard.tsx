import { Check, X } from 'lucide-react';

export type SopStepStatus = 'pending' | 'active' | 'completed' | 'failed' | 'design';

interface SopStepCardProps {
  label: string;
  roleSlug: string;
  status: SopStepStatus;
  onClick?: () => void;
}

const STATUS_ACCENT: Record<SopStepStatus, string> = {
  design: 'bg-slate-500/40',
  pending: 'bg-slate-400/30',
  active: 'bg-cyan-400',
  completed: 'bg-emerald-400',
  failed: 'bg-red-400',
};

const STATUS_RING: Record<SopStepStatus, string> = {
  design: 'border-white/[0.08]',
  pending: 'border-white/[0.08]',
  active: 'border-cyan-400/50 shadow-[0_0_12px_rgba(34,211,238,0.12)]',
  completed: 'border-emerald-400/40',
  failed: 'border-red-400/40',
};

const STATUS_BG: Record<SopStepStatus, string> = {
  design: 'bg-white/[0.02]',
  pending: 'bg-white/[0.02]',
  active: 'bg-cyan-500/[0.06]',
  completed: 'bg-emerald-500/[0.05]',
  failed: 'bg-red-500/[0.05]',
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

function StatusBadge({ status }: { status: SopStepStatus }) {
  if (status === 'completed') {
    return (
      <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-500/20">
        <Check className="w-3 h-3 text-emerald-400" />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500/20">
        <X className="w-3 h-3 text-red-400" />
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-cyan-500/20">
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
      </span>
    );
  }
  return null;
}

export function SopStepCard({ label, roleSlug, status, onClick }: SopStepCardProps) {
  return (
    <button
      type="button"
      className={`relative flex items-center gap-2.5 rounded-lg border pl-3.5 pr-3 py-2.5 text-left transition-all w-full min-w-[200px] max-w-[280px] ${STATUS_RING[status]} ${STATUS_BG[status]} ${onClick ? 'cursor-pointer hover:bg-white/[0.05]' : 'cursor-default'}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <div className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-full ${STATUS_ACCENT[status]}`} />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-slate-100 truncate leading-snug">{label}</p>
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500 truncate leading-snug mt-0.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${getRoleDotColor(roleSlug)}`} />
          {roleSlug}
        </p>
      </div>
      <StatusBadge status={status} />
    </button>
  );
}
