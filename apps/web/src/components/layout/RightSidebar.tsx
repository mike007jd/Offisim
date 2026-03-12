import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { BossDashboard } from '../dashboard/BossDashboard';
import { EventLog } from '../events/EventLog';
import { PitchHall } from '../pitch/PitchHall';
import { TaskDashboard } from '../plan/TaskDashboard';
import { useAgentStates } from '../../runtime/use-agent-states';

export function RightSidebar() {
  const agents = useAgentStates();

  return (
    <Tabs defaultValue="tasks" className="flex h-full flex-col">
      <TabsList className="mx-3 mt-2 shrink-0">
        <TabsTrigger value="tasks">Tasks</TabsTrigger>
        <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        <TabsTrigger value="outputs">Outputs</TabsTrigger>
        <TabsTrigger value="events">Events</TabsTrigger>
      </TabsList>
      <TabsContent value="tasks" className="min-h-0 flex-1 overflow-y-auto">
        <TaskDashboard agents={agents} />
      </TabsContent>
      <TabsContent value="dashboard" className="min-h-0 flex-1 overflow-y-auto">
        <BossDashboard agents={agents} />
      </TabsContent>
      <TabsContent value="outputs" className="min-h-0 flex-1 overflow-y-auto">
        <PitchHall />
      </TabsContent>
      <TabsContent value="events" className="min-h-0 flex-1 overflow-y-auto">
        <EventLog />
      </TabsContent>
    </Tabs>
  );
}
