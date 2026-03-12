import type { AgentState } from '../../runtime/use-agent-states';
import { useCostDashboard } from '../../hooks/useCostDashboard';
import { useTaskQueue } from '../../hooks/useTaskQueue';
import { CompanyStatusCard } from './CompanyStatusCard';
import { CostByModelCard } from './CostByModelCard';
import { CostOverviewCard } from './CostOverviewCard';
import { RecentActivityCard } from './RecentActivityCard';
import { TaskQueueCard } from './TaskQueueCard';

interface BossDashboardProps {
  agents: Map<string, AgentState>;
}

/**
 * Boss Dashboard — a 2-column grid showing cost tracking, task queue,
 * employee status, and recent activity.
 *
 * Designed as a toggleable panel within the right sidebar tabs.
 */
export function BossDashboard({ agents }: BossDashboardProps) {
  const cost = useCostDashboard();
  const queue = useTaskQueue();

  return (
    <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-2">
      <CostOverviewCard summary={cost.summary} loading={cost.loading} />
      <CompanyStatusCard agents={agents} />
      <CostByModelCard byModel={cost.byModel} loading={cost.loading} />
      <TaskQueueCard queue={queue} />
      <div className="lg:col-span-2">
        <RecentActivityCard />
      </div>
    </div>
  );
}
