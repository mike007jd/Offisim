import { Tabs, TabsContent, TabsList, TabsTrigger } from '@aics/ui-core';
import { Bell, Book, Database, LayoutDashboard, Pencil, Terminal, Users } from 'lucide-react';
import { useAgentStates } from '../../runtime/use-agent-states';
import { ZONES } from '../../lib/zone-config';
import { EventLog } from '../events/EventLog';
import { Library } from '../library/Library';
import { PitchHall } from '../pitch/PitchHall';
import { TaskDashboard } from '../plan/TaskDashboard';
import { ServerRoom } from '../server-room/ServerRoom';

interface RightSidebarProps {
  onOpenDashboard?: () => void;
  onOpenOfficeEditor?: () => void;
}

export function RightSidebar({ onOpenDashboard, onOpenOfficeEditor }: RightSidebarProps) {
  const agents = useAgentStates();

  const tabs = [
    { id: 'tasks', icon: Terminal, label: 'Tasks' },
    { id: 'outputs', icon: LayoutDashboard, label: 'Outputs' },
    { id: 'events', icon: Bell, label: 'Events' },
    { id: 'office', icon: Users, label: 'Office' },
    { id: 'server-room', icon: Database, label: 'Server' },
    { id: 'library', icon: Book, label: 'Library' },
  ];

  const totalWorkstations = ZONES.reduce((sum, z) => sum + z.deskSlots, 0);
  const activeZones = ZONES.filter(z => z.deskSlots > 0).length;

  return (
    <Tabs defaultValue="events" className="flex h-full flex-col">
      {/* Tabs navigation */}
      <div className="flex border-b border-white/5 px-2 pt-2">
        <TabsList className="bg-transparent w-full justify-start gap-0 p-0">
          {tabs.map(tab => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="flex-1 py-2.5 px-1 text-xs font-semibold uppercase tracking-wide flex flex-col items-center space-y-1.5 data-[state=active]:text-blue-400 data-[state=active]:bg-transparent data-[state=inactive]:text-slate-500 hover:text-slate-300 rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 transition-all"
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
        <TabsContent value="office" className="mt-0">
          <OfficeSummaryPanel onOpenOfficeEditor={onOpenOfficeEditor} totalWorkstations={totalWorkstations} activeZones={activeZones} />
        </TabsContent>
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

interface OfficeSummaryPanelProps {
  onOpenOfficeEditor?: () => void;
  totalWorkstations: number;
  activeZones: number;
}

function OfficeSummaryPanel({ onOpenOfficeEditor, totalWorkstations, activeZones }: OfficeSummaryPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* Zone list */}
      <div className="p-3 rounded-md bg-white/3 border border-white/5">
        <p className="text-xs font-medium text-slate-400 mb-2">Zones</p>
        <div className="flex flex-col gap-1.5">
          {ZONES.map(zone => (
            <div key={zone.id} className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: zone.accent }}
                />
                <span className="text-xs text-slate-200 truncate">{zone.label}</span>
              </div>
              <span className="text-xs text-slate-500 flex-shrink-0 ml-2">{zone.spaceType}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick stats */}
      <div className="p-3 rounded-md bg-white/3 border border-white/5">
        <p className="text-xs font-medium text-slate-400 mb-2">Quick Stats</p>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Total workstations</span>
            <span className="text-sm font-medium text-slate-200">{totalWorkstations}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Active zones</span>
            <span className="text-sm font-medium text-slate-200">{activeZones}</span>
          </div>
        </div>
      </div>

      {/* Open Office Editor button */}
      <button
        className="w-full flex items-center justify-center gap-2 rounded-md bg-blue-600 hover:bg-blue-500 active:bg-blue-700 transition-colors px-3 py-2 text-sm font-medium text-white"
        onClick={onOpenOfficeEditor}
        disabled={!onOpenOfficeEditor}
      >
        <Pencil className="w-4 h-4" />
        Open Office Editor
      </button>
    </div>
  );
}
