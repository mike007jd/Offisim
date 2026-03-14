import { Badge, Card, CardContent, CardHeader, CardTitle, Tabs, TabsContent, TabsList, TabsTrigger, type BadgeProps } from '@aics/ui-core';
import type { TaskRunRow } from '@aics/core/browser';
import type { TaskQueueState } from '../../hooks/useTaskQueue';

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  active: 'success',
  queued: 'info',
  planned: 'secondary',
  pending: 'secondary',
  completed: 'default',
  failed: 'error',
  cancelled: 'warning',
};

function formatDuration(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 1000) return '<1s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function TaskRow({ task }: { task: TaskRunRow }) {
  const variant = STATUS_VARIANT[task.status] ?? 'secondary';
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-ocean-light bg-ocean-mid/10 px-2 py-1.5">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Badge variant={variant} className="text-[10px] shrink-0">
          {task.task_type}
        </Badge>
        <span className="text-xs text-sand font-pixel-mono truncate">
          {task.employee_id ?? 'unassigned'}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] text-shell/60 font-pixel-mono">
          {formatDuration(task.started_at)}
        </span>
        <Badge variant={variant} className="text-[9px]">
          {task.status}
        </Badge>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="text-xs text-shell/60 py-2 text-center">{message}</div>;
}

interface TaskQueueCardProps {
  queue: TaskQueueState;
}

export function TaskQueueCard({ queue }: TaskQueueCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-pixel-display uppercase tracking-wider text-shell">
          Task Queue
        </CardTitle>
      </CardHeader>
      <CardContent>
        {queue.loading ? (
          <div className="text-xs text-shell/60">Loading...</div>
        ) : (
          <Tabs defaultValue="active">
            <TabsList className="w-full">
              <TabsTrigger value="active" className="flex-1 text-[10px]">
                Active ({queue.activeTasks.length})
              </TabsTrigger>
              <TabsTrigger value="pending" className="flex-1 text-[10px]">
                Pending ({queue.pendingTasks.length})
              </TabsTrigger>
              <TabsTrigger value="completed" className="flex-1 text-[10px]">
                Done ({queue.recentCompleted.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="active" className="mt-2 flex flex-col gap-1">
              {queue.activeTasks.length === 0 ? (
                <EmptyState message="No active tasks." />
              ) : (
                queue.activeTasks.map((t) => <TaskRow key={t.task_run_id} task={t} />)
              )}
            </TabsContent>
            <TabsContent value="pending" className="mt-2 flex flex-col gap-1">
              {queue.pendingTasks.length === 0 ? (
                <EmptyState message="No pending tasks." />
              ) : (
                queue.pendingTasks.map((t) => <TaskRow key={t.task_run_id} task={t} />)
              )}
            </TabsContent>
            <TabsContent value="completed" className="mt-2 flex flex-col gap-1">
              {queue.recentCompleted.length === 0 ? (
                <EmptyState message="No completed tasks yet." />
              ) : (
                queue.recentCompleted.map((t) => <TaskRow key={t.task_run_id} task={t} />)
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
