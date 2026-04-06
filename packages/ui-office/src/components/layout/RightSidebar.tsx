import { Tabs, TabsContent, TabsList, TabsTrigger } from '@offisim/ui-core';
import {
  Bell,
  Book,
  Columns3,
  Database,
  GitBranch,
  LayoutDashboard,
  Store,
  Terminal,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAgentStates } from '../../runtime/use-agent-states';
import { EventLog } from '../events/EventLog';
import { Library } from '../library/Library';
import { MarketplacePanel } from '../marketplace/MarketplacePanel';
import { PitchHall } from '../pitch/PitchHall';
import { TaskDashboard } from '../plan/TaskDashboard';
import { ServerRoom } from '../server-room/ServerRoom';
import { SopPanel } from '../sop/SopPanel';

interface RightSidebarProps {
  onOpenDashboard?: () => void;
  /** When truthy, switch to the outputs tab. Increment/change value to re-trigger. */
  focusOutputsToken?: number;
  /** When truthy, open Kanban board as an overlay. */
  onOpenKanban?: () => void;
  /** Filter outputs to this thread only. Null shows all. */
  activeThreadId?: string | null;
  onOpenMarketplaceListing?: (listingId: string) => void;
  onStartMarketplaceInstall?: (listingId: string, version: string) => void;
}

export function RightSidebar({
  onOpenDashboard,
  focusOutputsToken,
  onOpenKanban,
  activeThreadId,
  onOpenMarketplaceListing,
  onStartMarketplaceInstall,
}: RightSidebarProps) {
  const agents = useAgentStates();
  const [activeTab, setActiveTab] = useState('events');

  // Switch to outputs tab whenever the parent signals a new deliverable
  useEffect(() => {
    if (focusOutputsToken) {
      setActiveTab('outputs');
    }
  }, [focusOutputsToken]);

  const tabs = [
    { id: 'tasks', icon: Terminal, label: 'Tasks' },
    { id: 'sops', icon: GitBranch, label: 'SOPs' },
    { id: 'outputs', icon: LayoutDashboard, label: 'Outputs' },
    { id: 'events', icon: Bell, label: 'Events' },
    { id: 'server-room', icon: Database, label: 'Server' },
    { id: 'library', icon: Book, label: 'Library' },
    { id: 'marketplace', icon: Store, label: 'Market' },
  ];

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className="flex h-full flex-col overflow-hidden"
    >
      <div className="border-b border-white/5 px-2 pt-2">
        <TabsList className="bg-transparent flex w-full justify-start gap-1 overflow-x-auto p-0 pb-2">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              title={tab.label}
              aria-label={tab.label}
              data-onboarding-target={tab.id === 'outputs' ? 'outputs-button' : undefined}
              className="h-auto min-w-fit shrink-0 gap-1.5 rounded-lg border border-transparent px-2.5 py-2 text-[11px] text-slate-400 data-[state=active]:border-blue-500/30 data-[state=active]:bg-blue-500/10 data-[state=active]:text-blue-300 hover:text-slate-200"
            >
              <tab.icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
        <TabsContent value="tasks" className="mt-0">
          <TaskDashboard agents={agents} />
        </TabsContent>
        <TabsContent value="sops" className="mt-0">
          <SopPanel />
        </TabsContent>
        <TabsContent value="outputs" className="mt-0">
          <PitchHall activeThreadId={activeThreadId} />
        </TabsContent>
        <TabsContent value="events" className="mt-0">
          <EventLog />
        </TabsContent>
        <TabsContent value="server-room" className="mt-0 p-3">
          <ServerRoom activeThreadId={activeThreadId ?? null} />
        </TabsContent>
        <TabsContent value="library" className="mt-0">
          <Library />
        </TabsContent>
        <TabsContent value="marketplace" className="mt-0 h-full">
          <MarketplacePanel
            onOpenListing={(listingId) => onOpenMarketplaceListing?.(listingId)}
            onStartInstall={(listingId, version) => onStartMarketplaceInstall?.(listingId, version)}
          />
        </TabsContent>
      </div>

      {/* Bottom actions */}
      <div className="p-3 border-t border-white/5 bg-black/40 flex gap-2">
        <button
          type="button"
          className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-[11px] font-semibold text-slate-400 hover:bg-blue-500/15 hover:border-blue-500/40 hover:text-blue-300 transition-all"
          onClick={onOpenKanban}
        >
          <Columns3 className="w-4 h-4 text-blue-500" />
          <span>Board</span>
        </button>
        <button
          type="button"
          className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-[11px] font-semibold text-slate-400 hover:bg-blue-500/15 hover:border-blue-500/40 hover:text-blue-300 transition-all"
          onClick={onOpenDashboard}
        >
          <LayoutDashboard className="w-4 h-4 text-blue-500" />
          <span>Dashboard</span>
        </button>
      </div>
    </Tabs>
  );
}
