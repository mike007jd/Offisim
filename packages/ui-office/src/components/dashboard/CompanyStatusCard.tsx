import { Badge, Card, CardContent, CardHeader, CardTitle, type BadgeProps } from '@aics/ui-core';
import type { AgentState } from '../../runtime/use-agent-states';

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

interface CompanyStatusCardProps {
  agents: Map<string, AgentState>;
}

export function CompanyStatusCard({ agents }: CompanyStatusCardProps) {
  // Count employees per state
  const stateCounts = new Map<string, number>();
  for (const agent of agents.values()) {
    stateCounts.set(agent.state, (stateCounts.get(agent.state) ?? 0) + 1);
  }

  // Sort: active states first, then alphabetical
  const sortedStates = [...stateCounts.entries()].sort(([a], [b]) => {
    const aActive = a !== 'idle';
    const bActive = b !== 'idle';
    if (aActive !== bActive) return aActive ? -1 : 1;
    return a.localeCompare(b);
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-pixel-display uppercase tracking-wider text-shell">
          Company Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        {agents.size === 0 ? (
          <div className="text-xs text-shell/60">No employees.</div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="text-xs text-shell/70 font-pixel-mono">
              {agents.size} employee{agents.size !== 1 ? 's' : ''}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sortedStates.map(([state, count]) => (
                <Badge
                  key={state}
                  variant={STATE_VARIANTS[state] ?? 'secondary'}
                  className="text-[10px]"
                >
                  {state}: {count}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
