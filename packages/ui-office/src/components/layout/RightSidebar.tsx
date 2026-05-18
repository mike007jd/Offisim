import {
  Button,
  TABS_RETAIN_STATE_CLASS,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@offisim/ui-core';
import { ClipboardList, Files, GitBranch, MessageSquare, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { usePlanStepStore } from '../../hooks/plan-step-store';
import { useDeliverables } from '../../hooks/useDeliverables';
import { STAGE_META, usePipelineStage } from '../../hooks/usePipelineStage';
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
  activeThreadId?: string | null;
  activeProjectId?: string | null;
  /** Thread switch must go through `updateWorkspaceState('office', …)` (SSOT). */
  onSelectThread?: (threadId: string) => void;
  kanbanCardCount?: number;
  kanbanOpen?: boolean;
  onToggleKanban?: () => void;
  gitSlot?: ReactNode;
  onSelectEmployee?: (employeeId: string) => void;
}

type RightSidebarTab = 'chat' | 'inspector' | 'tasks' | 'git';

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
  kanbanOpen = false,
  onToggleKanban,
  gitSlot,
  onSelectEmployee,
}: RightSidebarProps) {
  const agents = useAgentStates();
  const { stage } = usePipelineStage();
  const { isRunning } = useOffisimRuntimeStatus();
  const [activeTab, setActiveTab] = useState<RightSidebarTab>('chat');
  const projectSelectorRef = useTourTarget('office:project-selector');
  const tasksTargetRef = useTourTarget('office:tasks-tab');

  const planSteps = usePlanStepStore().steps;
  const deliverables = useDeliverables(activeThreadId ?? null);

  const hasPlan = planSteps.length > 0 || stage === 'planning';
  const hasOutputs = deliverables.length > 0;
  const hasInspectorContent =
    Boolean(projectSummarySlot) || Boolean(activeProjectId && onSelectThread) || hasOutputs;

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

  const workflowLabel = useMemo(() => {
    if (!stage && !isRunning) return null;
    if (!stage && isRunning) return 'Starting run';
    const activeStage = stage ?? 'boss';
    return STAGE_META[activeStage].chatLabel;
  }, [stage, isRunning]);

  return (
    <div className="box-border flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden bg-surface-elevated text-text-primary">
      <div className="box-border w-full min-w-0 max-w-full overflow-hidden border-b border-border-default px-3 py-2.5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <p className="text-[10px] uppercase tracking-[0.24em] text-text-secondary">Workspace</p>
          {workflowLabel && activeTab === 'tasks' && (
            <span className="rounded-full border border-border-subtle bg-surface-muted px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-text-muted">
              {workflowLabel}
            </span>
          )}
        </div>
        {activeProjectId && onSelectThread && onSelectEmployee ? (
          <div className="mt-2 min-w-0 max-w-full overflow-hidden">
            <WorkspaceSearch
              projectId={activeProjectId}
              onSelectThread={onSelectThread}
              onSelectEmployee={onSelectEmployee}
            />
          </div>
        ) : null}
        {projectSlot ? (
          <div className="mt-2 flex min-w-0 max-w-full items-center gap-2 overflow-hidden" ref={projectSelectorRef}>
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
              Project
            </span>
            <div className="min-w-0 max-w-full flex-1 overflow-hidden">{projectSlot}</div>
          </div>
        ) : null}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as RightSidebarTab)}
        className="flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden"
      >
        <div className="box-border w-full min-w-0 max-w-full overflow-hidden border-b border-border-default px-2 pt-2">
          <TabsList className="flex h-auto w-full min-w-0 max-w-full justify-start gap-1 overflow-x-auto rounded-none border-0 bg-transparent p-0 pb-2 text-text-secondary">
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
              value="inspector"
              title="Inspector"
              aria-label="Inspector"
              className={MAIN_TAB_TRIGGER_CLASS}
            >
              <Files className="h-4 w-4" />
              <span>Inspect</span>
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
            <TabsTrigger
              value="git"
              title="Git"
              aria-label="Git"
              className={MAIN_TAB_TRIGGER_CLASS}
            >
              <GitBranch className="h-4 w-4" />
              <span>Git</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="chat"
          forceMount
          className={cn(
            'mt-0 flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden',
            TABS_RETAIN_STATE_CLASS,
          )}
        >
          <div className="flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden">{chatPanel}</div>
        </TabsContent>

        <TabsContent
          value="inspector"
          forceMount
          className={cn(
            'mt-0 flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden',
            TABS_RETAIN_STATE_CLASS,
          )}
        >
          <div className="custom-scrollbar flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-y-auto overflow-x-hidden">
            {projectSummarySlot ? (
              <section className="border-b border-border-default px-3 py-3">
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Project
                </h3>
                {projectSummarySlot}
              </section>
            ) : null}

            {activeProjectId && onSelectThread ? (
              <section className="border-b border-border-default">
                <div className="px-3 py-3 pb-2">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                    Threads
                  </h3>
                </div>
                <ThreadList
                  projectId={activeProjectId}
                  selectedThreadId={activeThreadId ?? null}
                  onSelectThread={onSelectThread}
                />
              </section>
            ) : null}

            {hasOutputs ? (
              <section className="border-b border-border-default px-3 py-3">
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Outputs
                </h3>
                <PitchHall
                  activeThreadId={activeThreadId ?? null}
                  activeProjectId={activeProjectId ?? null}
                />
              </section>
            ) : null}

            {!hasInspectorContent ? (
              <div className="px-3 py-6 text-xs text-text-muted">
                Select a project to inspect files, threads, and outputs.
              </div>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent
          value="tasks"
          forceMount
          className={cn(
            'mt-0 flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden',
            TABS_RETAIN_STATE_CLASS,
          )}
        >
          <div className="custom-scrollbar flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-y-auto overflow-x-hidden">
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

            <section className="px-3 py-3">
              <div className="rounded-lg border border-border-subtle bg-surface-muted p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                      Board
                    </h3>
                    <p className="mt-1 text-[11px] text-text-muted">
                      {kanbanCardCount} cards in the project board
                    </p>
                  </div>
                  {onToggleKanban ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      data-kanban-toggle
                      className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                      onClick={onToggleKanban}
                      aria-expanded={kanbanOpen}
                    >
                      <ClipboardList className="h-3.5 w-3.5" />
                      <span>{kanbanOpen ? 'Hide' : 'Open'}</span>
                    </Button>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        </TabsContent>

        <TabsContent
          value="git"
          forceMount
          className={cn(
            'mt-0 flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden',
            TABS_RETAIN_STATE_CLASS,
          )}
        >
          {gitSlot ? (
            <div className="flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden">{gitSlot}</div>
          ) : (
            <div className="px-3 py-6 text-xs text-text-muted">
              Select a project with a local workspace folder to inspect Git changes.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
