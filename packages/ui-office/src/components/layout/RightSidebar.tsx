import {
  Button,
  TABS_RETAIN_STATE_CLASS,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@offisim/ui-core';
import { ClipboardList, MessageSquare, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useDeliverables } from '../../hooks/useDeliverables';
import { STAGE_META, usePipelineStage } from '../../hooks/usePipelineStage';
import { usePlanStepStore } from '../../hooks/plan-step-store';
import { useOffisimRuntimeStatus } from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import { ActivityRail } from '../chat/ActivityRail';
import { useTourTarget } from '../onboarding/tour-context';
import { PitchHall } from '../pitch/PitchHall';
import { TaskDashboard } from '../plan/TaskDashboard';
import { ThreadList } from '../threads/ThreadList';
import { WorkspaceSearch } from '../workspace/WorkspaceSearch';

interface RightSidebarProps {
  chatPanel: ReactNode;
  projectSlot?: ReactNode;
  projectSummarySlot?: ReactNode;
  focusTasksToken?: number;
  requestChatToken?: number;
  /** Filter outputs to this thread only. Null shows all. */
  activeThreadId?: string | null;
  /** Active project id for the thread list subscription. */
  activeProjectId?: string | null;
  /** Thread switch handler — must call updateWorkspaceState('office', …). */
  onSelectThread?: (threadId: string) => void;
  /** Number of kanban cards. When > 0, render the Board chip. */
  kanbanCardCount?: number;
  /** Kanban tray rendered when the chip is expanded. */
  kanbanSlot?: ReactNode;
  /** Routes a workspace-search employee hit to the Personnel tab. */
  onSelectEmployee?: (employeeId: string) => void;
}

const PILL_TRIGGER_BASE =
  'h-auto min-w-fit shrink-0 rounded-full border border-transparent text-text-secondary data-[state=active]:border-border-focus data-[state=active]:bg-accent-muted data-[state=active]:text-accent-text hover:bg-surface-hover hover:text-text-primary';
const MAIN_TAB_TRIGGER_CLASS = `${PILL_TRIGGER_BASE} gap-1.5 px-3 py-2 text-[11px]`;

export function RightSidebar({
  chatPanel,
  projectSlot,
  projectSummarySlot,
  focusTasksToken,
  requestChatToken,
  activeThreadId,
  activeProjectId,
  onSelectThread,
  kanbanCardCount = 0,
  kanbanSlot,
  onSelectEmployee,
}: RightSidebarProps) {
  const agents = useAgentStates();
  const { stage } = usePipelineStage();
  const { isRunning } = useOffisimRuntimeStatus();
  const [activeTab, setActiveTab] = useState<'chat' | 'tasks'>('chat');
  const projectSelectorRef = useTourTarget('office:project-selector');
  const tasksTargetRef = useTourTarget('office:tasks-tab');

  const planSteps = usePlanStepStore().steps;
  const deliverables = useDeliverables(activeThreadId ?? null);
  const [kanbanOpen, setKanbanOpen] = useState(false);

  const hasPlan = planSteps.length > 0 || stage === 'planning';
  const hasOutputs = deliverables.length > 0;
  const hasKanban = kanbanCardCount > 0;

  useEffect(() => {
    if (focusTasksToken) {
      setActiveTab('tasks');
    }
  }, [focusTasksToken]);

  useEffect(() => {
    if (requestChatToken) {
      setActiveTab('chat');
    }
  }, [requestChatToken]);

  useEffect(() => {
    if (!hasKanban) setKanbanOpen(false);
  }, [hasKanban]);

  const workflowLabel = useMemo(() => {
    if (!stage && !isRunning) return null;
    if (!stage && isRunning) return 'Starting run';
    const activeStage = stage ?? 'boss';
    return STAGE_META[activeStage].chatLabel;
  }, [stage, isRunning]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface-elevated text-text-primary">
      <div className="border-b border-border-default px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] uppercase tracking-[0.24em] text-text-secondary">Workspace</p>
          {workflowLabel && activeTab === 'tasks' && (
            <span className="rounded-full border border-border-subtle bg-surface-muted px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-text-muted">
              {workflowLabel}
            </span>
          )}
        </div>
        {activeProjectId && onSelectThread && onSelectEmployee ? (
          <div className="mt-2">
            <WorkspaceSearch
              projectId={activeProjectId}
              onSelectThread={onSelectThread}
              onSelectEmployee={onSelectEmployee}
            />
          </div>
        ) : null}
        {projectSlot ? (
          <div className="mt-2 flex min-w-0 items-center gap-2" ref={projectSelectorRef}>
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
              Project
            </span>
            <div className="min-w-0 flex-1">{projectSlot}</div>
          </div>
        ) : null}
      </div>

      {projectSummarySlot ? (
        <div className="border-b border-border-default px-3 py-2.5">{projectSummarySlot}</div>
      ) : null}

      {activeProjectId && onSelectThread ? (
        <div className="border-b border-border-default">
          <ThreadList
            projectId={activeProjectId}
            selectedThreadId={activeThreadId ?? null}
            onSelectThread={onSelectThread}
          />
        </div>
      ) : null}

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'chat' | 'tasks')}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="border-b border-border-default px-2 pt-2">
          <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-0 bg-transparent p-0 pb-2 text-text-secondary">
            <TabsTrigger
              value="chat"
              title="Chat"
              aria-label="Chat"
              className={MAIN_TAB_TRIGGER_CLASS}
            >
              <MessageSquare className="h-4 w-4" />
              <span>Chat</span>
            </TabsTrigger>
            <TabsTrigger
              ref={tasksTargetRef}
              value="tasks"
              title="Tasks"
              aria-label="Tasks"
              className={MAIN_TAB_TRIGGER_CLASS}
            >
              <Terminal className="h-4 w-4" />
              <span>Tasks</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="chat"
          forceMount
          className={cn(
            'mt-0 flex min-h-0 flex-1 flex-col overflow-hidden',
            TABS_RETAIN_STATE_CLASS,
          )}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{chatPanel}</div>
        </TabsContent>

        <TabsContent
          value="tasks"
          forceMount
          className={cn(
            'mt-0 flex min-h-0 flex-1 flex-col overflow-hidden',
            TABS_RETAIN_STATE_CLASS,
          )}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto custom-scrollbar">
            <section className="border-b border-border-default px-3 py-3">
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                Activity
              </h3>
              <ActivityRail variant="full" />
            </section>

            {hasPlan ? (
              <section className="border-b border-border-default px-3 py-3">
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Plan
                </h3>
                <TaskDashboard agents={agents} />
              </section>
            ) : null}

            {hasOutputs ? (
              <section className="border-b border-border-default px-3 py-3">
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Outputs
                </h3>
                <PitchHall activeThreadId={activeThreadId ?? null} />
              </section>
            ) : null}

            {hasKanban ? (
              <section className="px-3 py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => setKanbanOpen((v) => !v)}
                  aria-expanded={kanbanOpen}
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                  <span>Board</span>
                  <span className="text-text-muted">{kanbanOpen ? '▴' : '▾'}</span>
                </Button>
                {kanbanOpen && kanbanSlot ? <div className="mt-2">{kanbanSlot}</div> : null}
              </section>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
