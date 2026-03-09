import { useAgentStates } from '../../runtime/use-agent-states';
import { AgentCard } from './AgentCard';

export function AgentPanel() {
  const agents = useAgentStates();

  return (
    <div className="flex flex-col gap-2 p-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        Team
      </h2>
      {[...agents.entries()].map(([id, agent]) => (
        <AgentCard key={id} id={id} agent={agent} />
      ))}
    </div>
  );
}
