import { Plus } from 'lucide-react';
import { useEmployeeEditor } from '../../hooks/useEmployeeEditor';
import { useAgentStates } from '../../runtime/use-agent-states';
import { EmployeeEditorDialog } from '../employees/EmployeeEditorDialog';
import { Button } from '../ui/button';
import { AgentCard } from './AgentCard';

interface AgentPanelProps {
  onSelectEmployee?: (employeeId: string) => void;
  selectedEmployeeId?: string | null;
}

export function AgentPanel({ onSelectEmployee, selectedEmployeeId }: AgentPanelProps) {
  const agents = useAgentStates();
  const editor = useEmployeeEditor();

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <h2 className="font-pixel-display text-[8px] uppercase tracking-wider text-shell">Team</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => editor.openForCreate()}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {[...agents.entries()].map(([id, agent]) => (
        <AgentCard
          key={id}
          id={id}
          agent={agent}
          isSelected={selectedEmployeeId === id}
          onClick={() => onSelectEmployee?.(id)}
          onEditClick={() => editor.openForEdit(id)}
        />
      ))}
      <EmployeeEditorDialog {...editor} />
    </div>
  );
}
