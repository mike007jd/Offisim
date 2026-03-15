import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@aics/ui-core';
import { LayoutDashboard } from 'lucide-react';
import { useAgentStates } from '../../runtime/use-agent-states';
import { EventLog } from '../events/EventLog';
import { Library } from '../library/Library';
import { OfficeEditor } from '../office/OfficeEditor';
import { PitchHall } from '../pitch/PitchHall';
import { TaskDashboard } from '../plan/TaskDashboard';
import { ServerRoom } from '../server-room/ServerRoom';

interface RightSidebarProps {
  /** Callback to open the full-screen Boss Dashboard overlay. */
  onOpenDashboard?: () => void;
}

export function RightSidebar({ onOpenDashboard }: RightSidebarProps) {
  const agents = useAgentStates();

  return (
    <Tabs defaultValue="tasks" className="flex h-full flex-col">
      <TabsList className="mx-3 mt-2 shrink-0 flex-wrap">
        <TabsTrigger value="tasks">Tasks</TabsTrigger>
        <TabsTrigger value="outputs">Outputs</TabsTrigger>
        <TabsTrigger value="events">Events</TabsTrigger>
        <TabsTrigger value="office">Office</TabsTrigger>
        <TabsTrigger value="server-room">Server Room</TabsTrigger>
        <TabsTrigger value="library">Library</TabsTrigger>
      </TabsList>

      {/* Dashboard quick-toggle button — opens full-screen overlay */}
      <div className="mx-3 mt-1">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 text-xs text-shell/80 hover:text-pearl border-ocean-light"
          onClick={onOpenDashboard}
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          Boss Dashboard
        </Button>
      </div>

      <TabsContent value="tasks" className="min-h-0 flex-1 overflow-y-auto">
        <TaskDashboard agents={agents} />
      </TabsContent>
      <TabsContent value="outputs" className="min-h-0 flex-1 overflow-y-auto">
        <PitchHall />
      </TabsContent>
      <TabsContent value="events" className="min-h-0 flex-1 overflow-y-auto">
        <EventLog />
      </TabsContent>
      <TabsContent value="office" className="min-h-0 flex-1 overflow-y-auto">
        <OfficeEditor />
      </TabsContent>
      <TabsContent value="server-room" className="min-h-0 flex-1 overflow-y-auto">
        <ServerRoom />
      </TabsContent>
      <TabsContent value="library" className="min-h-0 flex-1 overflow-y-auto">
        <Library />
      </TabsContent>
    </Tabs>
  );
}
