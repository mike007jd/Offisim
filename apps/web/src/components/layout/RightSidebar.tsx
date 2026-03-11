import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { EventLog } from '../events/EventLog';
import { PitchHall } from '../pitch/PitchHall';
import { TaskDashboard } from '../plan/TaskDashboard';

export function RightSidebar() {
  return (
    <Tabs defaultValue="tasks" className="flex h-full flex-col">
      <TabsList className="mx-3 mt-2 shrink-0">
        <TabsTrigger value="tasks">Tasks</TabsTrigger>
        <TabsTrigger value="outputs">Outputs</TabsTrigger>
        <TabsTrigger value="events">Events</TabsTrigger>
      </TabsList>
      <TabsContent value="tasks" className="min-h-0 flex-1 overflow-y-auto">
        <TaskDashboard />
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
