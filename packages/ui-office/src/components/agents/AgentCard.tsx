import { Badge, type BadgeProps } from '@aics/ui-core';
import { Wrench } from 'lucide-react';
import type { AgentState } from '../../runtime/use-agent-states';
import { DicebearAvatar } from '../shared/DicebearAvatar';

const STATE_VARIANTS: Record<string, BadgeProps['variant']> = {
  idle: 'secondary',
  assigned: 'info',
  thinking: 'info',
  executing: 'success',
  meeting: 'default',
  blocked: 'error',
  failed: 'error',
  waiting: 'warning',
};

const STATUS_DOTS: Record<string, string> = {
  idle: 'bg-slate-400',
  assigned: 'bg-blue-500',
  thinking: 'bg-blue-500',
  executing: 'bg-emerald-500',
  meeting: 'bg-purple-500',
  blocked: 'bg-red-500',
  failed: 'bg-red-500',
  waiting: 'bg-amber-500',
};

const ROLE_LABELS: Record<string, string> = {
  engineering_manager: 'Engineering Manager',
  developer: 'Developer',
  designer: 'Designer',
  pm: 'Product Manager',
  qa: 'QA Engineer',
  devops: 'DevOps Engineer',
  analyst: 'Analyst',
};

interface AgentCardProps {
  id: string;
  agent: AgentState;
  isSelected?: boolean;
  onClick?: () => void;
}

export function AgentCard({ id, agent, isSelected, onClick }: AgentCardProps) {
  const variant = STATE_VARIANTS[agent.state] ?? 'secondary';
  const dotColor = STATUS_DOTS[agent.state] ?? 'bg-slate-400';

  return (
    <div
      data-testid={`agent-card-${id}`}
      className={`bg-black/40 p-4 rounded-xl border cursor-pointer transition-all ${
        isSelected
          ? 'border-blue-500/40 bg-white/5 shadow-[0_0_15px_rgba(59,130,246,0.1)]'
          : 'border-white/5 hover:border-blue-500/40 hover:bg-white/5 hover:shadow-[0_0_15px_rgba(59,130,246,0.1)]'
      }`}
      onClick={onClick}
    >
      <div className="flex items-center space-x-3">
        {/* Avatar with status dot */}
        <div className="relative flex-shrink-0">
          <div className="w-11 h-11 rounded-full bg-slate-900 overflow-hidden border border-white/10">
            <DicebearAvatar seed={agent.name} size={44} className="w-full h-full object-cover" />
          </div>
          <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#02040a] ${dotColor}`} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-sm font-semibold text-slate-200 truncate">{agent.name}</span>
            <div className="flex items-center gap-1.5">
              <Badge variant={variant} className="text-[10px]">{agent.state}</Badge>
            </div>
          </div>
          <p className="text-xs text-slate-400 truncate font-mono flex items-center gap-1">
            {ROLE_LABELS[agent.role] ?? agent.role}
            <Wrench className="h-2.5 w-2.5 text-slate-700 inline flex-shrink-0" />
          </p>
        </div>
      </div>
    </div>
  );
}
