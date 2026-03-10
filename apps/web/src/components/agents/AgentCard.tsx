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
};

interface AgentCardProps {
  id: string;
  agent: AgentState;
}

export function AgentCard({ agent }: AgentCardProps) {
  const variant = STATE_VARIANTS[agent.state] ?? 'secondary';

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-sand">{agent.name}</div>
          <div className="text-xs text-shell font-pixel-mono">{ROLE_LABELS[agent.role] ?? agent.role}</div>
        </div>
        <Badge variant={variant} className="text-[10px]">
          {agent.state}
        </Badge>
      </div>
    </Card>
  );
}
