import {
  TABS_RETAIN_STATE_CLASS,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@offisim/ui-core';
import { MessageSquare, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { STAGE_META, usePipelineStage } from '../../hooks/usePipelineStage';
import { useOffisimRuntimeStatus } from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import { ActivityRail } from '../chat/ActivityRail';
import { useTourTarget } from '../onboarding/tour-context';
import { PitchHall } from '../pitch/PitchHall';
import { TaskDashboard } from '../plan/TaskDashboard';

interface RightSidebarProps {
  chatPanel: ReactNode;
  focusTasksToken?: number;
  requestChatToken?: number;
  /** Filter outputs to this thread only. Null shows all. */
  activeThreadId?: string | null;
}

type TaskSubTab = 'activity' | 'plan' | 'outputs';

const PILL_TRIGGER_BASE =
  'h-auto min-w-fit shrink-0 rounded-full border border-transparent text-slate-400 data-[state=active]:border-cyan-400/40 data-[state=active]:bg-cyan-400/10 data-[state=active]:text-cyan-100 hover:text-slate-200';
const MAIN_TAB_TRIGGER_CLASS = `${PILL_TRIGGER_BASE} gap-1.5 px-3 py-2 text-[11px]`;
const SUB_TAB_TRIGGER_CLASS = `${PILL_TRIGGER_BASE} px-3 py-1 text-[10px] uppercase tracking-[0.18em]`;

export function RightSidebar({
  chatPanel,
  focusTasksToken,
  requestChatToken,
  activeThreadId,
}: RightSidebarProps) {
  const agents = useAgentStates();
  const { stage } = usePipelineStage();
  const { isRunning } = useOffisimRuntimeStatus();
  const [activeTab, setActiveTab] = useState<'chat' | 'tasks'>('chat');
  const tasksTargetRef = useTourTarget('office:tasks-tab');
  const [taskSubTab, setTaskSubTab] = useState<TaskSubTab>('plan');

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
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-white/5 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Workspace</p>
          {workflowLabel && activeTab === 'tasks' && (
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-400">
              {workflowLabel}
            </span>
          )}
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'chat' | 'tasks')}
        className="flex min-h-[640px] min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="border-b border-white/5 px-2 pt-2">
          <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-0 bg-transparent p-0 pb-2">
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
          <Tabs
            value={taskSubTab}
            onValueChange={(value) => setTaskSubTab(value as TaskSubTab)}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div className="border-b border-white/5 px-2 pt-2">
              <TabsList className="flex h-auto w-full justify-start gap-1 rounded-none border-0 bg-transparent p-0 pb-2">
                <TabsTrigger value="activity" className={SUB_TAB_TRIGGER_CLASS}>
                  Activity
                </TabsTrigger>
                <TabsTrigger value="plan" className={SUB_TAB_TRIGGER_CLASS}>
                  Plan
                </TabsTrigger>
                <TabsTrigger value="outputs" className={SUB_TAB_TRIGGER_CLASS}>
                  Outputs
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent
              value="activity"
              forceMount
              className={cn(
                'mt-0 min-h-0 flex-1 overflow-y-auto custom-scrollbar px-3 pb-3 pt-3',
                TABS_RETAIN_STATE_CLASS,
              )}
            >
              <ActivityRail variant="full" />
            </TabsContent>
            <TabsContent
              value="plan"
              forceMount
              className={cn(
                'mt-0 min-h-0 flex-1 overflow-y-auto custom-scrollbar',
                TABS_RETAIN_STATE_CLASS,
              )}
            >
              <TaskDashboard agents={agents} />
            </TabsContent>
            <TabsContent
              value="outputs"
              forceMount
              className={cn(
                'mt-0 min-h-0 flex-1 overflow-y-auto custom-scrollbar',
                TABS_RETAIN_STATE_CLASS,
              )}
            >
              <PitchHall activeThreadId={activeThreadId} />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}
