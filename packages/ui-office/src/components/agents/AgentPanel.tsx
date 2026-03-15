import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@aics/ui-core';
import { ChevronDown, ClipboardList, Plus, Wrench, Zap } from 'lucide-react';
import { useState } from 'react';
import { useEmployeeEditor } from '../../hooks/useEmployeeEditor';
import { useEmployeeWorkshop } from '../../hooks/useEmployeeWorkshop';
import { useInterviewWizard } from '../../hooks/useInterviewWizard';
import { useAgentStates } from '../../runtime/use-agent-states';
import { EmployeeEditorDialog } from '../employees/EmployeeEditorDialog';
import { EmployeeWorkshop } from '../employees/EmployeeWorkshop';
import { InterviewWizard } from '../employees/InterviewWizard';
import { AgentCard } from './AgentCard';

interface AgentPanelProps {
  onSelectEmployee?: (employeeId: string) => void;
  selectedEmployeeId?: string | null;
}

export function AgentPanel({ onSelectEmployee, selectedEmployeeId }: AgentPanelProps) {
  const agents = useAgentStates();
  const editor = useEmployeeEditor();
  const workshop = useEmployeeWorkshop();
  const wizard = useInterviewWizard();
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <h2 className="font-pixel-display text-[8px] uppercase tracking-wider text-shell">Team</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <Plus className="h-3.5 w-3.5" />
              <ChevronDown className="h-2 w-2 ml-0.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => editor.openForCreate()}>
              <Zap className="h-3.5 w-3.5 mr-2" />
              Quick Create
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIsWizardOpen(true)}>
              <ClipboardList className="h-3.5 w-3.5 mr-2" />
              Interview Onboarding
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => workshop.open()}>
              <Wrench className="h-3.5 w-3.5 mr-2" />
              Workshop
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
      <EmployeeWorkshop {...workshop} />
      <InterviewWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        wizard={wizard}
      />
    </div>
  );
}
