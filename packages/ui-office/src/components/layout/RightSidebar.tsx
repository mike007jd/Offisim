import { Tabs, TabsContent, TabsList, TabsTrigger } from '@aics/ui-core';
import { Bell, Book, Database, LayoutDashboard, Terminal, Users } from 'lucide-react';
import { useAgentStates } from '../../runtime/use-agent-states';
import { ZONES, resolveEmployeeZone } from '../../lib/zone-config';
import { EventLog } from '../events/EventLog';
import { Library } from '../library/Library';
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
    <Tabs defaultValue="events" className="flex h-full flex-col overflow-hidden">
      {/* Tabs navigation — icon-only to fit 280px */}
      <div className="flex border-b border-white/5 px-2 pt-2 overflow-hidden">
        <TabsList className="bg-transparent w-full justify-start gap-0 p-0">
          {tabs.map(tab => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              title={tab.label}
              className="flex-1 py-2.5 px-1 flex items-center justify-center data-[state=active]:text-blue-400 data-[state=active]:bg-transparent data-[state=inactive]:text-slate-500 hover:text-slate-300 rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 transition-all"
            >
              <tab.icon className="w-5 h-5" />
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
        <TabsContent value="tasks" className="mt-0"><TaskDashboard agents={agents} /></TabsContent>
        <TabsContent value="outputs" className="mt-0"><PitchHall /></TabsContent>
        <TabsContent value="events" className="mt-0"><EventLog /></TabsContent>
        <TabsContent value="office" className="mt-0 p-3">
          <OfficeSummaryPanel agents={agents} />
        </TabsContent>
        <TabsContent value="server-room" className="mt-0 p-3"><ServerRoom /></TabsContent>
        <TabsContent value="library" className="mt-0"><Library /></TabsContent>
      </div>

      {/* Bottom action */}
      <div className="p-3 border-t border-white/5 bg-black/40">
        <button
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-[11px] font-semibold text-slate-400 hover:bg-blue-500/15 hover:border-blue-500/40 hover:text-blue-300 transition-all"
          onClick={onOpenDashboard}
        >
          <LayoutDashboard className="w-4 h-4 text-blue-500" />
          <span>Dashboard</span>
        </button>
      </div>
    </Tabs>
  );
}

interface OfficeSummaryPanelProps {
  agents: Map<string, { name: string; role: string; state: string; workstationId?: string | null }>;
}

function OfficeSummaryPanel({ agents }: OfficeSummaryPanelProps) {
  const totalWorkstations = ZONES.reduce((sum, z) => sum + z.deskSlots, 0);
  const totalAgents = agents.size;

  // Count employees per zone
  const zoneCounts: Record<string, number> = {};
  for (const z of ZONES) zoneCounts[z.id] = 0;
  for (const [, agent] of agents) {
    const zoneId = resolveEmployeeZone(agent);
    if (zoneCounts[zoneId] !== undefined) {
      zoneCounts[zoneId]++;
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Quick stats */}
      <div className="p-3 rounded-md bg-white/3 border border-white/5">
        <p className="text-xs font-medium text-slate-400 mb-2">Overview</p>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Employees</span>
            <span className="text-sm font-medium text-slate-200">{totalAgents}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Workstations</span>
            <span className="text-sm font-medium text-slate-200">{totalWorkstations}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Utilization</span>
            <span className="text-sm font-medium text-slate-200">
              {totalWorkstations > 0 ? Math.round((totalAgents / totalWorkstations) * 100) : 0}%
            </span>
          </div>
        </div>
      </div>

      {/* Zone breakdown */}
      <div className="p-3 rounded-md bg-white/3 border border-white/5">
        <p className="text-xs font-medium text-slate-400 mb-2">Zones</p>
        <div className="flex flex-col gap-1.5">
          {ZONES.map(zone => {
            const count = zoneCounts[zone.id] ?? 0;
            const capacity = zone.deskSlots;
            const pct = capacity > 0 ? Math.round((count / capacity) * 100) : 0;

            return (
              <div key={zone.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: zone.accent }}
                    />
                    <span className="text-xs text-slate-200 truncate">{zone.label}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    {capacity > 0 ? (
                      <span className="text-[10px] text-slate-500">{count}/{capacity}</span>
                    ) : (
                      <span className="text-[10px] text-slate-600">{zone.spaceType}</span>
                    )}
                  </div>
                </div>
                {/* Utilization bar for zones with desks */}
                {capacity > 0 && (
                  <div className="h-1 w-full rounded-full bg-white/5 ml-4" style={{ width: 'calc(100% - 16px)' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(pct, 100)}%`,
                        backgroundColor: zone.accent,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
