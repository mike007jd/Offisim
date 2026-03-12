import { Pencil } from 'lucide-react';
import type { AgentState } from '../../runtime/use-agent-states';
import { Badge, type BadgeProps } from '../ui/badge';
import { Card } from '../ui/card';

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
  onEditClick?: () => void;
}

export function AgentCard({ id, agent, isSelected, onClick, onEditClick }: AgentCardProps) {
  const variant = STATE_VARIANTS[agent.state] ?? 'secondary';

  return (
    <Card
      data-testid={`agent-card-${id}`}
      className={`p-3 cursor-pointer hover:bg-ocean-mid/30 transition-colors ${isSelected ? 'ring-2 ring-coral bg-ocean-mid/20' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-sand">{agent.name}</div>
          <div className="text-xs text-shell font-pixel-mono">
            {ROLE_LABELS[agent.role] ?? agent.role}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant={variant} className="text-[10px]">
            {agent.state}
          </Badge>
          {onEditClick && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditClick();
              }}
              className="p-1 rounded hover:bg-ocean-light/30 text-shell hover:text-sand transition-colors"
              aria-label={`Edit ${agent.name}`}
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
