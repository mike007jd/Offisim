import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@aics/ui-core';
import { ClipboardList, Plus, Search, Users, Wrench, Zap } from 'lucide-react';
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-6 border-b border-white/5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-black uppercase tracking-[0.4em] text-slate-400 flex items-center space-x-2">
            <Users className="w-3 h-3" />
            <span>Personnel_Index</span>
          </h2>
          <span className="text-[10px] font-mono text-blue-500/60">{agents.size} NODES</span>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-600" />
          <input
            type="text"
            placeholder="SEARCH_UID..."
            className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-9 pr-4 text-[10px] font-mono focus:outline-none focus:border-blue-500/40 transition-all placeholder:text-slate-700 text-slate-300"
          />
        </div>
      </div>

      {/* Employee list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
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
      </div>

      {/* Bottom action */}
      <div className="p-4 border-t border-white/5 bg-black/40">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="cyber-button w-full flex items-center justify-center space-x-2 group">
              <Plus className="w-3 h-3 text-blue-400 group-hover:rotate-90 transition-transform" />
              <span>Deploy_New_Node</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
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

      <EmployeeEditorDialog {...editor} />
      <EmployeeWorkshop {...workshop} />
      <InterviewWizard isOpen={isWizardOpen} onClose={() => setIsWizardOpen(false)} wizard={wizard} />
    </div>
  );
}
