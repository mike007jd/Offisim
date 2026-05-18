import { Badge, Card, CardContent, CardHeader, CardTitle, ScrollArea } from '@offisim/ui-core';
import { HeartPulse } from 'lucide-react';
import { ROLE_LABELS } from '../../lib/roles';
import { STATE_VARIANTS, STATUS_DOTS } from '../../lib/state-variants';
import { isEmployeeActive, isEmployeeBlocked } from '../../runtime/use-active-employee-count.js';
import type { AgentState } from '../../runtime/use-agent-states';
import { EmployeeAvatar } from '../shared/EmployeeAvatar';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TeamHealthCardProps {
  agents: Map<string, AgentState>;
}

// ---------------------------------------------------------------------------
// Row sub-component
// ---------------------------------------------------------------------------

function EmployeeHealthRow({ id, agent }: { id: string; agent: AgentState }) {
  const variant = STATE_VARIANTS[agent.state] ?? 'secondary';
  const dotColor = STATUS_DOTS[agent.state] ?? 'bg-text-muted';
  const roleLabel = ROLE_LABELS[agent.role] ?? agent.role;

  return (
    <div
      className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-hover"
      data-testid={`team-health-row-${id}`}
    >
      {/* Mini avatar + status dot */}
      <div className="relative flex-shrink-0">
        <div className="size-6 overflow-hidden rounded-full border border-border-subtle bg-surface-muted">
          <EmployeeAvatar agent={agent} size={24} className="h-full w-full object-cover" />
        </div>
        <div
          className={`absolute bottom-0 right-0 size-2 rounded-full border border-surface ${dotColor}`}
        />
      </div>

      {/* Name + role */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium leading-none text-text-primary">{agent.name}</p>
        <p className="mt-0.5 truncate font-mono text-caption leading-none text-text-muted">
          {roleLabel}
        </p>
      </div>

      {/* State badge */}
      <Badge variant={variant} className="flex-shrink-0 px-1.5 py-0 text-caption">
        {agent.state}
      </Badge>

      {/* Task indicator */}
      {agent.taskRunId && (
        <div
          className="size-1.5 flex-shrink-0 animate-pulse rounded-full bg-success"
          title="Active task"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TeamHealthCard
// ---------------------------------------------------------------------------

export function TeamHealthCard({ agents }: TeamHealthCardProps) {
  const activeCount = [...agents.values()].filter((a) => isEmployeeActive(a.state)).length;
  const blockedCount = [...agents.values()].filter((a) => isEmployeeBlocked(a.state)).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-text-muted">
            <HeartPulse className="size-4" />
            Team Health
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {activeCount > 0 && (
              <Badge variant="success" className="px-1.5 py-0 text-caption">
                {activeCount} active
              </Badge>
            )}
            {blockedCount > 0 && (
              <Badge variant="error" className="px-1.5 py-0 text-caption">
                {blockedCount} blocked
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {agents.size === 0 ? (
          <p className="text-xs text-text-muted">No employees deployed yet.</p>
        ) : (
          <ScrollArea className="max-h-56">
            <div className="flex flex-col gap-0.5">
              {[...agents.entries()].map(([id, agent]) => (
                <EmployeeHealthRow key={id} id={id} agent={agent} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
