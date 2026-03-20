import { Tabs, TabsContent, TabsList, TabsTrigger } from '@aics/ui-core';
import { Bell, Book, Database, LayoutDashboard, Terminal, Users } from 'lucide-react';
import { useAgentStates } from '../../runtime/use-agent-states';
import { EventLog } from '../events/EventLog';
import { Library } from '../library/Library';
import { OfficeEditor } from '../office/OfficeEditor';
import { PitchHall } from '../pitch/PitchHall';
import { TaskDashboard } from '../plan/TaskDashboard';
import { ServerRoom } from '../server-room/ServerRoom';

interface RightSidebarProps {
  onOpenDashboard?: () => void;
}

export function RightSidebar({ onOpenDashboard }: RightSidebarProps) {
  const agents = useAgentStates();

  const tabs = [
    { id: 'tasks', icon: Terminal, label: 'Tasks' },
    { id: 'outputs', icon: LayoutDashboard, label: 'Outputs' },
    { id: 'events', icon: Bell, label: 'Events' },
    { id: 'office', icon: Users, label: 'Office' },
    { id: 'server-room', icon: Database, label: 'Server' },
    { id: 'library', icon: Book, label: 'Library' },
  ];

  return (
    <Tabs defaultValue="events" className="flex h-full flex-col">
      {/* Tabs navigation */}
      <div className="flex border-b border-white/5 px-2 pt-2">
        <TabsList className="bg-transparent w-full justify-start gap-0 p-0">
          {tabs.map(tab => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="flex-1 py-4 px-1 text-[9px] font-black uppercase tracking-[0.1em] flex flex-col items-center space-y-2 data-[state=active]:text-blue-400 data-[state=active]:bg-transparent data-[state=inactive]:text-slate-500 hover:text-slate-300 rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 transition-all"
            >
              <tab.icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        <TabsContent value="tasks" className="mt-0"><TaskDashboard agents={agents} /></TabsContent>
        <TabsContent value="outputs" className="mt-0"><PitchHall /></TabsContent>
        <TabsContent value="events" className="mt-0"><EventLog /></TabsContent>
        <TabsContent value="office" className="mt-0"><OfficeEditor /></TabsContent>
        <TabsContent value="server-room" className="mt-0"><ServerRoom /></TabsContent>
        <TabsContent value="library" className="mt-0"><Library /></TabsContent>
      </div>

      {/* Bottom action */}
      <div className="p-4 border-t border-white/5 bg-black/40">
        <button className="cyber-button w-full flex items-center justify-center space-x-2" onClick={onOpenDashboard}>
          <LayoutDashboard className="w-4 h-4 text-blue-500" />
          <span>Executive Dashboard</span>
        </button>
      </div>
    </Tabs>
  );
}
