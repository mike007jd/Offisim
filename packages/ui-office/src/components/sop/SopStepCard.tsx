import { Check, X } from 'lucide-react';

export type SopStepStatus = 'pending' | 'active' | 'completed' | 'failed' | 'design';

interface SopStepCardProps {
  label: string;
  roleSlug: string;
  status: SopStepStatus;
  onClick?: () => void;
}

const STATUS_RING: Record<SopStepStatus, string> = {
  design: 'border-white/10',
  pending: 'border-white/10',
  active: 'border-blue-400 ring-1 ring-blue-400/30 animate-pulse',
  completed: 'border-emerald-400/60',
  failed: 'border-red-400/60',
};

const STATUS_BG: Record<SopStepStatus, string> = {
  design: 'bg-white/[0.03]',
  pending: 'bg-white/[0.03]',
  active: 'bg-blue-500/[0.06]',
  completed: 'bg-emerald-500/[0.06]',
  failed: 'bg-red-500/[0.06]',
};

function StatusIndicator({ status }: { status: SopStepStatus }) {
  if (status === 'completed') {
    return <Check className="w-2.5 h-2.5 text-emerald-400" />;
  }
  if (status === 'failed') {
    return <X className="w-2.5 h-2.5 text-red-400" />;
  }
  if (status === 'active') {
    return <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />;
  }
  return null;
}

export function SopStepCard({ label, roleSlug, status, onClick }: SopStepCardProps) {
  return (
    <button
      type="button"
      className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition-colors min-w-[100px] max-w-[140px] ${STATUS_RING[status]} ${STATUS_BG[status]} ${onClick ? 'cursor-pointer hover:bg-white/[0.06]' : 'cursor-default'}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium text-slate-200 truncate leading-tight">{label}</p>
        <p className="text-[9px] text-slate-500 truncate leading-tight">{roleSlug}</p>
      </div>
      <StatusIndicator status={status} />
    </button>
  );
}
