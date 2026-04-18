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
  const dotColor = STATUS_DOTS[agent.state] ?? 'bg-slate-400';
  const roleLabel = ROLE_LABELS[agent.role] ?? agent.role;

  return (
    <div
      className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-slate-800/30"
      data-testid={`team-health-row-${id}`}
    >
      {/* Mini avatar + status dot */}
      <div className="relative flex-shrink-0">
        <div className="h-6 w-6 overflow-hidden rounded-full border border-white/10 bg-slate-800">
          <EmployeeAvatar agent={agent} size={24} className="h-full w-full object-cover" />
        </div>
        <div
          className={`absolute bottom-0 right-0 h-2 w-2 rounded-full border border-slate-900 ${dotColor}`}
        />
      </div>

      {/* Name + role */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-200 leading-none">{agent.name}</p>
        <p className="truncate text-[10px] text-slate-500 font-mono leading-none mt-0.5">
          {roleLabel}
        </p>
      </div>

      {/* State badge */}
      <Badge variant={variant} className="text-[10px] flex-shrink-0 px-1.5 py-0">
        {agent.state}
      </Badge>

      {/* Task indicator */}
      {agent.taskRunId && (
        <div
          className="h-1.5 w-1.5 rounded-full bg-emerald-500 flex-shrink-0 animate-pulse"
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
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
            <HeartPulse className="h-4 w-4" />
            Team Health
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {activeCount > 0 && (
              <Badge variant="success" className="text-[10px] px-1.5 py-0">
                {activeCount} active
              </Badge>
            )}
            {blockedCount > 0 && (
              <Badge variant="error" className="text-[10px] px-1.5 py-0">
                {blockedCount} blocked
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {agents.size === 0 ? (
          <p className="text-xs text-slate-400/50">No employees deployed yet.</p>
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
