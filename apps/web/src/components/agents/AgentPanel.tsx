import { useAgentStates } from '../../runtime/use-agent-states';
import { AgentCard } from './AgentCard';

export function AgentPanel() {
  const agents = useAgentStates();

  return (
    <div className="flex flex-col gap-2 p-3">
      <h2 className="font-pixel-display text-[8px] uppercase tracking-wider text-shell">Team</h2>
      {[...agents.entries()].map(([id, agent]) => (
        <AgentCard key={id} id={id} agent={agent} />
      ))}
    </div>
  );
}
