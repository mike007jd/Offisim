import { Badge, Card, CardContent, CardHeader, CardTitle } from '@offisim/ui-core';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics';
import { STATE_VARIANTS } from '../../lib/state-variants';
import type { AgentState } from '../../runtime/use-agent-states';

interface CompanyStatusCardProps {
  agents: Map<string, AgentState>;
}

export function CompanyStatusCard({ agents }: CompanyStatusCardProps) {
  const { taskCompletionRate, bossInterventionRate } = useDashboardMetrics();

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
        <CardTitle className="text-sm uppercase tracking-wider text-ink-3">
          Company Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        {agents.size === 0 ? (
          <div className="text-xs text-ink-3/60">No employees.</div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="text-xs text-ink-3/70 font-mono">
              {agents.size} employee{agents.size !== 1 ? 's' : ''}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sortedStates.map(([state, count]) => (
                <Badge
                  key={state}
                  variant={STATE_VARIANTS[state] ?? 'secondary'}
                  className="text-fs-micro"
                >
                  {state}: {count}
                </Badge>
              ))}
            </div>
          </div>
        )}
        <div className="mt-2 flex flex-col gap-0.5 border-t border-line-soft pt-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-3/70">Completion</span>
            <span className="font-mono text-ok">{(taskCompletionRate * 100).toFixed(0)}%</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-3/70">Intervention</span>
            <span className="font-mono text-warn">{(bossInterventionRate * 100).toFixed(0)}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
